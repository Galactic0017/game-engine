/* Cosmos BTD — TowerDefenseEngine game module for the GAME Engine Hub.
 *
 * Implements the IGameModule lifecycle the EngineHost requires:
 *   init(viewport, {bus, wallet, config, hero, player, onHud, onToast})
 *   destroy(), setHero(hero), getState()
 *
 * Rendering is 100% procedural Canvas 2D: no image files, so nothing can
 * break if an asset is missing. The background is pre-rendered once to
 * an offscreen canvas. Collisions use a spatial hash (64px cells) and
 * particles/projectiles come from fixed pools, so the loop holds 60 FPS
 * on ordinary hardware.
 *
 * Towers: Dart Archer, Cannon (splash), Sniper (hitscan, global range),
 * Frost Beam (slow), Plasma Mortar (long-range lobbed splash).
 * Targeting: first | last | strong | weak. Waves: 50, boss every 10.
 *
 * Heroes: an equipped hero is placed as a high-power unit. Pops near the
 * hero grant hero XP; hero level-ups are emitted on the bus
 * (game:hero_level_up) and the shell persists them via /api/heroes/add-xp.
 *
 * Anti-cheat: every run gets a sessionId + secret nonce. Each completed
 * wave produces a SHA-256 state hash over
 *   sessionId:wave:pops:heroXp:nonce
 * The shell submits the hash to /api/progress/secure, which recomputes
 * it server-side and enforces XP/wave rate caps. The hash is computed
 * with crypto.subtle when available; otherwise a cyrb53 fallback is used
 * and the report is marked hashAlgo:"fallback" (weaker evidence).
 *
 * This module never talks to a wallet, a server, or the DOM outside its
 * viewport. All cross-module communication goes through the event bus
 * and the onHud/onToast callbacks.
 */
(function (global) {
  'use strict';

  var W = 960, H = 600, TAU = Math.PI * 2;
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var dist = function (x1, y1, x2, y2) { return Math.hypot(x2 - x1, y2 - y1); };
  var seed = 987654321;
  function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }

  var TOWER_DEFS = {
    dart:   { name: 'Dart Archer',   key: '1', cost: 100, range: 112, rate: 0.45, dmg: 1, color: '#ffb703', desc: 'Fast darts, one target. Cannot crack lead.' },
    cannon: { name: 'Cannon',        key: '2', cost: 175, range: 125, rate: 1.15, dmg: 2, splash: 58, color: '#ff6b35', desc: 'Splash damage. Cracks lead. Shakes the screen.' },
    sniper: { name: 'Sniper',        key: '3', cost: 250, range: 999, rate: 1.45, dmg: 3, color: '#c792ea', desc: 'Global range. Instant beam. Cracks lead.' },
    frost:  { name: 'Frost Beam',    key: '4', cost: 150, range: 98,  rate: 0.90, dmg: 1, slow: 0.5, slowDur: 1.3, color: '#7bdff2', desc: 'Slows everything it touches.' },
    mortar: { name: 'Plasma Mortar', key: '5', cost: 350, range: 330, rate: 2.30, dmg: 4, splash: 82, color: '#00f6ff', desc: 'Long-range lobbed plasma. Huge splash. Cracks lead.' }
  };

  var BALLOON_TYPES = [
    { layers: 1, color: '#ff5a5a', dark: '#c62828', speed: 62,  reward: 6,  name: 'Red' },
    { layers: 2, color: '#4f8cff', dark: '#1d4ed8', speed: 70,  reward: 7,  name: 'Blue' },
    { layers: 3, color: '#3ddc5f', dark: '#15803d', speed: 78,  reward: 8,  name: 'Green' },
    { layers: 4, color: '#ffd166', dark: '#d97706', speed: 88,  reward: 9,  name: 'Gold' },
    { layers: 5, color: '#ff8fab', dark: '#db2777', speed: 112, reward: 11, name: 'Pink' },
    { layers: 6, color: '#c9ced6', dark: '#6b7280', speed: 56,  reward: 14, name: 'Lead', armored: true },
    { layers: 5, color: '#e8e8f0', dark: '#111827', speed: 96,  reward: 13, name: 'Zebra', splits: true }
  ];

  /* ---- Curved multi-lane track: Catmull-Rom spline, sampled to a polyline ---- */
  var CTRL = [[-40, 118], [140, 118], [222, 238], [182, 418], [362, 472], [522, 382], [542, 202], [700, 140], [862, 220], [822, 420], [1000, 420]];
  function catmull(p0, p1, p2, p3, t) {
    var t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }
  var pathPts = [];
  (function buildPath() {
    for (var i = 0; i < CTRL.length - 1; i++) {
      var p0 = CTRL[Math.max(0, i - 1)], p1 = CTRL[i], p2 = CTRL[i + 1], p3 = CTRL[Math.min(CTRL.length - 1, i + 2)];
      for (var j = 0; j < 24; j++) {
        var t = j / 24;
        pathPts.push([catmull(p0[0], p1[0], p2[0], p3[0], t), catmull(p0[1], p1[1], p2[1], p3[1], t)]);
      }
    }
    pathPts.push(CTRL[CTRL.length - 1].slice());
  })();
  var pathLen = [], totalLen = 0;
  for (var pi = 0; pi < pathPts.length; pi++) {
    if (pi > 0) totalLen += dist(pathPts[pi - 1][0], pathPts[pi - 1][1], pathPts[pi][0], pathPts[pi][1]);
    pathLen.push(totalLen);
  }
  function pointAt(d) {
    d = clamp(d, 0, totalLen);
    var lo = 0, hi = pathLen.length - 1;
    while (lo < hi) { var m = (lo + hi) >> 1; if (pathLen[m] < d) lo = m + 1; else hi = m; }
    var i = Math.max(1, lo), a = pathPts[i - 1], b = pathPts[i], seg = pathLen[i] - pathLen[i - 1] || 1, t = (d - pathLen[i - 1]) / seg;
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
  }
  function distToPath(x, y) {
    var best = 1e9;
    for (var i = 0; i < pathPts.length - 1; i++) {
      var ax = pathPts[i][0], ay = pathPts[i][1], bx = pathPts[i + 1][0], by = pathPts[i + 1][1];
      var dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1, t = clamp(((x - ax) * dx + (y - ay) * dy) / L2, 0, 1);
      best = Math.min(best, dist(x, y, ax + dx * t, ay + dy * t));
    }
    return best;
  }

  /* ---- Hash helpers (anti-cheat state hash) ---- */
  function cyrb53(str, seedNum) {
    var h1 = 0xdeadbeef ^ seedNum, h2 = 0x41c6ce57 ^ seedNum;
    for (var i = 0; i < str.length; i++) {
      var ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16) + (h1 >>> 0).toString(16);
  }
  function randomHex(n) {
    var out = '';
    for (var i = 0; i < n; i++) out += Math.floor(Math.random() * 16).toString(16);
    return out;
  }
  async function sha256Hex(text) {
    try {
      if (global.crypto && global.crypto.subtle && global.crypto.subtle.digest) {
        var buf = await global.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      }
    } catch (e) { /* fall through to cyrb53 */ }
    return 'fallback:' + cyrb53(text, 0);
  }

  /* ---- Background: pre-rendered once ---- */
  function paintBackground() {
    var bg = document.createElement('canvas'); bg.width = W; bg.height = H;
    var b = bg.getContext('2d');
    var g = b.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#3f9e4d'); g.addColorStop(0.55, '#2f8a3e'); g.addColorStop(1, '#2a7d38');
    b.fillStyle = g; b.fillRect(0, 0, W, H);
    for (var i = 0; i < 2600; i++) { b.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.06)'; b.fillRect(rnd() * W, rnd() * H, 2, 2); }
    for (i = 0; i < 900; i++) { var gx = rnd() * W, gy = rnd() * H; b.strokeStyle = 'rgba(20,80,30,.5)'; b.lineWidth = 1; b.beginPath(); b.moveTo(gx, gy); b.lineTo(gx + (rnd() - 0.5) * 5, gy - 4 - rnd() * 4); b.stroke(); }
    for (i = 0; i < 46; i++) { var fx = rnd() * W, fy = rnd() * H; b.fillStyle = ['#ffd166', '#ff8fab', '#ffffff', '#c792ea'][i % 4]; b.beginPath(); b.arc(fx, fy, 2.4, 0, TAU); b.fill(); }
    // pond
    b.save(); b.beginPath(); b.ellipse(128, 492, 86, 44, 0, 0, TAU); b.clip();
    var wg = b.createLinearGradient(0, 448, 0, 536); wg.addColorStop(0, '#7bdff2'); wg.addColorStop(1, '#1d6fb8');
    b.fillStyle = wg; b.fillRect(30, 440, 200, 110);
    for (i = 0; i < 26; i++) { b.strokeStyle = 'rgba(255,255,255,' + (0.12 + rnd() * 0.25) + ')'; b.lineWidth = 1.5; b.beginPath(); b.ellipse(128, 492, rnd() * 76 + 8, rnd() * 30 + 4, 0, rnd() * TAU, rnd() * TAU + 1.2); b.stroke(); }
    b.restore();
    b.strokeStyle = '#c9a86a'; b.lineWidth = 5; b.beginPath(); b.ellipse(128, 492, 86, 44, 0, 0, TAU); b.stroke();
    // gravel path
    b.lineCap = 'round'; b.lineJoin = 'round';
    var stroke = function (w, col) { b.strokeStyle = col; b.lineWidth = w; b.beginPath(); b.moveTo(pathPts[0][0], pathPts[0][1]); pathPts.forEach(function (p) { b.lineTo(p[0], p[1]); }); b.stroke(); };
    stroke(46, 'rgba(0,0,0,.28)'); stroke(40, '#b8a284'); stroke(36, '#cbb693');
    for (i = 0; i < 900; i++) { var d = rnd() * totalLen, pt = pointAt(d), a = rnd() * TAU, r = rnd() * 15; b.fillStyle = rnd() > 0.5 ? '#a08b66' : '#d8c6a2'; b.beginPath(); b.arc(pt[0] + Math.cos(a) * r, pt[1] + Math.sin(a) * r, 1.4 + rnd() * 1.6, 0, TAU); b.fill(); }
    stroke(4, 'rgba(255,255,255,.16)');
    b.fillStyle = '#ff5a5a'; b.font = 'bold 13px Arial'; b.textAlign = 'center'; b.fillText('START', 52, 84);
    b.fillStyle = '#ffd166'; b.fillText('★ FINISH', 872, 388);
    // trees + rocks (kept clear of the path by fixed placement)
    [[76, 306], [392, 108], [640, 528], [884, 84], [306, 548], [700, 540], [472, 566], [908, 540], [52, 214], [560, 72]].forEach(function (pos) {
      var x = pos[0], y = pos[1];
      b.fillStyle = 'rgba(0,0,0,.28)'; b.beginPath(); b.ellipse(x + 6, y + 8, 30, 10, 0, 0, TAU); b.fill();
      b.fillStyle = '#6b4a2b'; b.fillRect(x - 4, y - 2, 8, 18);
      var tg = b.createRadialGradient(x - 8, y - 26, 4, x, y - 18, 30); tg.addColorStop(0, '#6fdc7a'); tg.addColorStop(1, '#1e6b2e');
      b.fillStyle = tg; b.beginPath(); b.arc(x, y - 20, 26, 0, TAU); b.fill();
    });
    [[250, 540], [640, 84], [830, 540], [430, 520], [180, 556]].forEach(function (pos) {
      var x = pos[0], y = pos[1];
      var rg = b.createLinearGradient(x - 16, y - 12, x + 16, y + 10); rg.addColorStop(0, '#c9ced6'); rg.addColorStop(1, '#6b7280');
      b.fillStyle = rg; b.beginPath(); b.moveTo(x - 18, y + 6); b.lineTo(x - 8, y - 12); b.lineTo(x + 10, y - 10); b.lineTo(x + 18, y + 6); b.closePath(); b.fill();
    });
    return bg;
  }

  /* ---- Synthesized audio (Web Audio, muted + torn down on destroy) ---- */
  function makeAudio() {
    var AC = null, muted = false;
    function audio() {
      if (muted) return null;
      if (!AC) { try { AC = new (global.AudioContext || global.webkitAudioContext)(); } catch (e) { return null; } }
      if (AC && AC.state === 'suspended') AC.resume();
      return AC;
    }
    function tone(f0, f1, dur, type, vol, when) {
      var ac = audio(); if (!ac) return;
      var t = ac.currentTime + (when || 0), o = ac.createOscillator(), g = ac.createGain();
      o.type = type || 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
      g.gain.setValueAtTime(vol || 0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + dur + 0.02);
    }
    function noise(dur, vol, fc) {
      var ac = audio(); if (!ac) return;
      var n = Math.floor(ac.sampleRate * dur), buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      var s = ac.createBufferSource(); s.buffer = buf;
      var f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = fc || 900;
      var g = ac.createGain(); g.gain.value = vol || 0.2;
      s.connect(f); f.connect(g); g.connect(ac.destination); s.start();
    }
    return {
      unlock: function () { audio(); },
      mute: function () { muted = true; },
      close: function () { muted = true; try { if (AC) AC.close(); } catch (e) {} AC = null; },
      pop: function () { noise(0.07, 0.22, 2600); tone(720, 180, 0.09, 'triangle', 0.14); },
      shoot: function () { tone(900, 300, 0.06, 'square', 0.05); },
      cannon: function () { noise(0.28, 0.3, 320); tone(120, 40, 0.25, 'sine', 0.25); },
      sniper: function () { tone(1600, 220, 0.14, 'sawtooth', 0.08); noise(0.05, 0.1, 4000); },
      frost: function () { tone(1400, 1900, 0.16, 'sine', 0.07); },
      coin: function () { tone(880, 880, 0.07, 'sine', 0.08); tone(1320, 1320, 0.09, 'sine', 0.08, 0.06); },
      clear: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, f, 0.14, 'triangle', 0.1, i * 0.09); }); },
      leak: function () { tone(220, 90, 0.3, 'sawtooth', 0.14); },
      place: function () { tone(420, 640, 0.1, 'triangle', 0.1); },
      over: function () { [400, 320, 240, 160].forEach(function (f, i) { tone(f, f, 0.22, 'sawtooth', 0.11, i * 0.14); }); }
    };
  }

  /* ---- Engine state ---- */
  function createState(opts) {
    return {
      opts: opts || {},
      canvas: null, ctx: null, bg: null,
      running: false, destroyed: false, rafId: 0, lastT: 0, time: 0,
      gold: 650, lives: 100, wave: 0, score: 0, pops: 0,
      balloons: [], towers: [], projectiles: [], beams: [], floaters: [],
      particles: [], spawnQueue: [], spawnTimer: 0, betweenWaves: true,
      speed: 1, autoStart: false, targeting: 'first', placing: null,
      selected: null, hero: null, heroPlaced: false, heroCd: 0, heroXp: 0,
      sessionId: null, sessionNonce: null, pendingReports: [],
      shake: 0, waveActive: false, won: false, lost: false,
      mouse: { x: -999, y: -999 },
      audio: makeAudio(),
      grid: new Map()
    };
  }
  var CELL = 64;
  function gridKey(cx, cy) { return cx + ',' + cy; }
  function rebuildGrid(st) {
    st.grid.clear();
    for (var i = 0; i < st.balloons.length; i++) {
      var b = st.balloons[i];
      var k = gridKey(Math.floor(b.x / CELL), Math.floor(b.y / CELL));
      var arr = st.grid.get(k); if (!arr) { arr = []; st.grid.set(k, arr); }
      arr.push(b);
    }
  }
  function nearby(st, x, y, r) {
    var out = [], x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL), y0 = Math.floor((y - r) / CELL), y1 = Math.floor((y + r) / CELL);
    for (var cx = x0; cx <= x1; cx++) for (var cy = y0; cy <= y1; cy++) {
      var arr = st.grid.get(gridKey(cx, cy));
      if (arr) for (var i = 0; i < arr.length; i++) out.push(arr[i]);
    }
    return out;
  }
  function spawnParticle(st, x, y, color, n, speed) {
    for (var i = 0; i < (n || 8); i++) {
      if (st.particles.length > 400) st.particles.shift();
      var a = Math.random() * TAU, s = (speed || 90) * (0.4 + Math.random() * 0.9);
      st.particles.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.35 + Math.random() * 0.35, max: 0.7, color: color, size: 2 + Math.random() * 3 });
    }
  }
  function floater(st, x, y, text, color) { st.floaters.push({ x: x, y: y, text: text, color: color || '#ffd166', life: 0.9 }); }

  function waveComposition(w) {
    var list = [];
    var push = function (type, n) { for (var i = 0; i < n; i++) list.push(type); };
    if (w <= 5) { push(0, 6 + w * 2); if (w >= 3) push(1, w); }
    else if (w <= 12) { push(0, 8); push(1, 6 + w); push(2, w - 3); if (w >= 8) push(3, w - 6); }
    else if (w <= 25) { push(1, 8); push(2, 10 + w); push(3, w - 8); push(4, Math.floor(w / 2)); if (w >= 18) push(5, 2 + Math.floor(w / 6)); if (w >= 20) push(6, 1 + Math.floor(w / 8)); }
    else { push(2, 14); push(3, 14); push(4, 10); push(5, 6); push(6, 3 + Math.floor(w / 6)); }
    if (w % 10 === 0) list.push(-1); // boss blimp
    return list;
  }
  function startWave(st) {
    if (st.waveActive || st.won || st.lost) return;
    st.wave++;
    st.spawnQueue = waveComposition(st.wave);
    st.spawnTimer = 0.4;
    st.waveActive = true; st.betweenWaves = false;
    floater(st, W / 2, 60, 'WAVE ' + st.wave, '#00f6ff');
    emitHud(st);
  }
  function spawnBalloon(st, typeIdx) {
    if (typeIdx === -1) {
      var pt = pointAt(0);
      st.balloons.push({ boss: true, x: pt[0], y: pt[1], dist: 0, layers: 60, maxLayers: 60, r: 34, speed: 26, reward: 250, wob: Math.random() * TAU, slowUntil: 0, slowF: 1, armored: false, type: BALLOON_TYPES[3] });
      return;
    }
    var t = BALLOON_TYPES[typeIdx], p2 = pointAt(0);
    st.balloons.push({ boss: false, x: p2[0], y: p2[1], dist: 0, layers: t.layers, maxLayers: t.layers, r: 11 + t.layers * 1.5, speed: t.speed * (1 + st.wave * 0.012), reward: t.reward, wob: Math.random() * TAU, slowUntil: 0, slowF: 1, armored: !!t.armored, splits: !!t.splits, type: t });
  }
  function damageBalloon(st, b, dmg, sourceTower) {
    if (b.dead) return;
    var heroNear = st.heroPlaced && st.hero && dist(b.x, b.y, st.hero.x, st.hero.y) < 170;
    if (b.armored && sourceTower && sourceTower.kind === 'dart') return; // darts cannot crack lead
    if (b.boss) { b.layers -= dmg; st.pops += dmg; if (b.layers <= 0) { b.dead = true; st.gold += b.reward; st.score += 500; spawnParticle(st, b.x, b.y, '#ffd166', 26, 160); floater(st, b.x, b.y, '+' + b.reward + 'g', '#ffd166'); st.audio.coin(); } return; }
    b.layers -= dmg; st.pops += dmg;
    if (b.layers <= 0) {
      b.dead = true; st.gold += b.reward; st.score += 10;
      spawnParticle(st, b.x, b.y, b.type.color, 10, 110);
      if (heroNear) st.heroXp += 2;
      if (b.splits) { for (var i = 0; i < 2; i++) { var nb = { boss: false, x: b.x + (i ? 8 : -8), y: b.y, dist: b.dist, layers: 2, maxLayers: 2, r: 14, speed: b.speed * 1.15, reward: 7, wob: Math.random() * TAU, slowUntil: 0, slowF: 1, armored: false, splits: false, type: BALLOON_TYPES[1] }; st.balloons.push(nb); } }
      st.audio.pop();
    } else {
      b.r = 11 + b.layers * 1.5;
      spawnParticle(st, b.x, b.y, b.type.color, 4, 70);
    }
  }
  function splashDamage(st, x, y, radius, dmg, sourceTower) {
    var targets = nearby(st, x, y, radius + 20);
    for (var i = 0; i < targets.length; i++) { var b = targets[i]; if (!b.dead && dist(b.x, b.y, x, y) <= radius + b.r) damageBalloon(st, b, dmg, sourceTower); }
    spawnParticle(st, x, y, '#ff9e00', 14, 130);
  }
  function pickTarget(st, tower) {
    var inRange = [];
    var cands = nearby(st, tower.x, tower.y, tower.range + 40);
    for (var i = 0; i < cands.length; i++) { var b = cands[i]; if (!b.dead && dist(b.x, b.y, tower.x, tower.y) <= tower.range + b.r) inRange.push(b); }
    if (!inRange.length) return null;
    var mode = st.targeting;
    if (mode === 'last') return inRange.reduce(function (a, b) { return b.dist < a.dist ? b : a; });
    if (mode === 'strong') return inRange.reduce(function (a, b) { return (b.layers > a.layers || (b.layers === a.layers && b.dist > a.dist)) ? b : a; });
    if (mode === 'weak') return inRange.reduce(function (a, b) { return (b.layers < a.layers || (b.layers === a.layers && b.dist < a.dist)) ? b : a; });
    return inRange.reduce(function (a, b) { return b.dist > a.dist ? b : a; }); // first
  }
  function fireTower(st, tower, target) {
    var def = TOWER_DEFS[tower.kind];
    tower.angle = Math.atan2(target.y - tower.y, target.x - tower.x);
    tower.flash = 0.12;
    if (tower.kind === 'sniper') {
      st.beams.push({ x1: tower.x, y1: tower.y - 14, x2: target.x, y2: target.y, life: 0.12, color: def.color });
      damageBalloon(st, target, tower.dmg, tower); st.audio.sniper();
    } else if (tower.kind === 'frost') {
      st.beams.push({ x1: tower.x, y1: tower.y - 10, x2: target.x, y2: target.y, life: 0.18, color: def.color });
      target.slowUntil = st.time + (def.slowDur || 1.3); target.slowF = def.slow || 0.5;
      damageBalloon(st, target, tower.dmg, tower); st.audio.frost();
    } else if (tower.kind === 'mortar') {
      if (st.projectiles.length < 128) st.projectiles.push({ kind: 'mortar', x: tower.x, y: tower.y - 16, tx: target.x, ty: target.y, t: 0, dur: 0.7, dmg: tower.dmg, splash: def.splash, source: tower });
      st.audio.cannon();
    } else if (tower.kind === 'cannon') {
      if (st.projectiles.length < 128) st.projectiles.push({ kind: 'shell', x: tower.x, y: tower.y - 12, tx: target.x, ty: target.y, t: 0, dur: 0.35, dmg: tower.dmg, splash: def.splash, source: tower });
      st.audio.cannon(); st.shake = Math.max(st.shake, 4);
    } else {
      if (st.projectiles.length < 128) {
        var ang = tower.angle;
        st.projectiles.push({ kind: 'dart', x: tower.x, y: tower.y - 12, vx: Math.cos(ang) * 560, vy: Math.sin(ang) * 560, life: 0.8, dmg: tower.dmg, source: tower });
      }
      st.audio.shoot();
    }
  }
  function heroPowerMult(hero) { if (!hero) return 1; return 1 + ((hero.level || 1) - 1) * 0.08 + ((hero.xp || 0) / 4000); }
  function update(st, dt) {
    st.time += dt;
    if (st.heroCd > 0) st.heroCd -= dt;
    if (st.shake > 0) st.shake = Math.max(0, st.shake - dt * 18);
    // spawning
    if (st.spawnQueue.length) {
      st.spawnTimer -= dt;
      if (st.spawnTimer <= 0) { spawnBalloon(st, st.spawnQueue.shift()); st.spawnTimer = st.wave >= 20 ? 0.35 : 0.55; }
    }
    // balloons move
    for (var i = 0; i < st.balloons.length; i++) {
      var b = st.balloons[i];
      if (b.dead) continue;
      var f = (st.time < b.slowUntil) ? b.slowF : 1;
      b.dist += b.speed * f * dt;
      if (b.dist >= totalLen) {
        b.dead = true; b.leaked = true;
        var dmg = b.boss ? 25 : b.layers;
        st.lives -= dmg; st.shake = Math.max(st.shake, 8); st.audio.leak();
        floater(st, W - 90, 400, '-' + dmg + ' HP', '#ff5a5a');
        if (st.lives <= 0) { st.lives = 0; st.lost = true; st.audio.over(); emitHud(st); }
        continue;
      }
      var pt = pointAt(b.dist); b.x = pt[0]; b.y = pt[1]; b.wob += dt * 6;
    }
    rebuildGrid(st);
    // towers fire
    for (i = 0; i < st.towers.length; i++) {
      var t = st.towers[i];
      t.cd -= dt; if (t.flash > 0) t.flash -= dt;
      if (t.cd > 0) continue;
      var target = pickTarget(st, t);
      if (target) { fireTower(st, t, target); t.cd = t.rate; }
    }
    // hero fires (same targeting rules, high power)
    if (st.heroPlaced && st.hero) {
      var h = st.hero;
      h.cd = (h.cd || 0) - dt;
      if (h.cd <= 0) {
        var fake = { x: h.x, y: h.y, range: h.range || 150, kind: 'hero' };
        var ht = pickTarget(st, fake);
        if (ht) {
          var dmg = Math.max(1, Math.round((h.basePower || 16) / 8 * heroPowerMult(h)));
          damageBalloon(st, ht, dmg, null);
          st.beams.push({ x1: h.x, y1: h.y, x2: ht.x, y2: ht.y, life: 0.1, color: h.color || '#ffd166' });
          h.cd = 0.8;
        }
      }
    }
    // projectiles
    for (i = st.projectiles.length - 1; i >= 0; i--) {
      var pr = st.projectiles[i];
      if (pr.kind === 'dart') {
        pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.life -= dt;
        var hit = null, near = nearby(st, pr.x, pr.y, 26);
        for (var j = 0; j < near.length; j++) { if (!near[j].dead && dist(pr.x, pr.y, near[j].x, near[j].y) <= near[j].r + 4) { hit = near[j]; break; } }
        if (hit) { damageBalloon(st, hit, pr.dmg, pr.source); st.projectiles.splice(i, 1); continue; }
        if (pr.life <= 0 || pr.x < -20 || pr.x > W + 20 || pr.y < -20 || pr.y > H + 20) st.projectiles.splice(i, 1);
      } else {
        pr.t += dt / pr.dur;
        if (pr.t >= 1) {
          splashDamage(st, pr.tx, pr.ty, pr.splash, pr.dmg, pr.source);
          if (pr.kind === 'mortar') st.shake = Math.max(st.shake, 5);
          st.projectiles.splice(i, 1);
        }
      }
    }
    // beams / floaters / particles
    for (i = st.beams.length - 1; i >= 0; i--) { st.beams[i].life -= dt; if (st.beams[i].life <= 0) st.beams.splice(i, 1); }
    for (i = st.floaters.length - 1; i >= 0; i--) { st.floaters[i].life -= dt; st.floaters[i].y -= 34 * dt; if (st.floaters[i].life <= 0) st.floaters.splice(i, 1); }
    for (i = st.particles.length - 1; i >= 0; i--) { var pa = st.particles[i]; pa.life -= dt; pa.x += pa.vx * dt; pa.y += pa.vy * dt; pa.vx *= 0.94; pa.vy *= 0.94; if (pa.life <= 0) st.particles.splice(i, 1); }
    // cleanup + wave end
    st.balloons = st.balloons.filter(function (b) { return !b.dead; });
    if (st.waveActive && !st.spawnQueue.length && !st.balloons.length && !st.lost) {
      st.waveActive = false; st.betweenWaves = true;
      var bonus = 60 + st.wave * 8; st.gold += bonus; st.score += 50;
      st.audio.clear();
      floater(st, W / 2, 90, 'WAVE CLEAR  +' + bonus + 'g', '#3ddc5f');
      reportWave(st);
      if (st.wave >= 50) { st.won = true; st.audio.clear(); }
      else if (st.autoStart) startWave(st);
      emitHud(st);
    }
    emitHudThrottled(st, dt);
  }
  function emitHud(st) { if (st.opts.onHud) st.opts.onHud(getHud(st)); }
  var _hudAcc = 0;
  function emitHudThrottled(st, dt) { _hudAcc += dt; if (_hudAcc > 0.25) { _hudAcc = 0; emitHud(st); } }
  function getHud(st) {
    return { gold: st.gold, lives: st.lives, wave: st.wave, score: st.score, pops: st.pops, waveActive: st.waveActive, betweenWaves: st.betweenWaves, won: st.won, lost: st.lost, heroXp: st.heroXp, towers: st.towers.length, speed: st.speed, autoStart: st.autoStart, targeting: st.targeting, placing: st.placing };
  }
  // Anti-cheat wave report: hash over sessionId:wave:pops:heroXp:nonce.
  // Computed async so it never blocks the game loop; the shell submits
  // it to /api/progress/secure, which recomputes the same hash.
  async function reportWave(st) {
    try {
      var payload = { sessionId: st.sessionId, wave: st.wave, score: st.score, pops: st.pops, heroXp: st.heroXp };
      if (st.sessionId && st.sessionNonce) {
        var text = st.sessionId + ':' + st.wave + ':' + st.pops + ':' + st.heroXp + ':' + st.sessionNonce;
        payload.stateHash = await sha256Hex(text);
        payload.hashAlgo = payload.stateHash.indexOf('fallback:') === 0 ? 'fallback' : 'sha256';
      }
      if (st.opts.bus) st.opts.bus.emit('game:wave_completed', st.wave, { score: st.score, pops: st.pops, heroXp: st.heroXp, gold: st.gold });
      if (st.opts.onWaveReport) st.opts.onWaveReport(payload);
    } catch (e) { /* reporting must never break gameplay */ }
  }

  /* ---- Drawing ---- */
  function drawBalloon(ctx, b, time) {
    var wob = Math.sin(b.wob) * 2.2;
    var x = b.x, y = b.y + wob;
    if (b.boss) {
      ctx.save(); ctx.translate(x, y);
      ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(4, 22, 40, 9, 0, 0, TAU); ctx.fill();
      var g = ctx.createLinearGradient(0, -30, 0, 30); g.addColorStop(0, '#5b6470'); g.addColorStop(0.5, '#2b3240'); g.addColorStop(1, '#141a24');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, 46, 28, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ff5a5a'; ctx.beginPath(); ctx.ellipse(0, 0, 30, 18, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.ellipse(-14, -8, 8, 5, -0.4, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 13px Arial'; ctx.textAlign = 'center'; ctx.fillText('BOSS ' + b.layers, 0, 5);
      ctx.fillStyle = '#ff5a5a'; ctx.fillRect(-40, 34, 80, 6);
      ctx.fillStyle = '#3ddc5f'; ctx.fillRect(-40, 34, 80 * (b.layers / b.maxLayers), 6);
      ctx.restore(); return;
    }
    var t = b.type;
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(2, b.r * 0.9, b.r * 0.8, 4, 0, 0, TAU); ctx.fill();
    var g2 = ctx.createRadialGradient(-b.r * 0.35, -b.r * 0.4, 2, 0, 0, b.r * 1.2);
    g2.addColorStop(0, '#ffffff'); g2.addColorStop(0.25, t.color); g2.addColorStop(1, t.dark);
    ctx.fillStyle = g2; ctx.beginPath(); ctx.ellipse(0, 0, b.r * 0.82, b.r, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, b.r); ctx.quadraticCurveTo(2, b.r + 8, 0, b.r + 12); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.ellipse(-b.r * 0.3, -b.r * 0.4, b.r * 0.24, b.r * 0.16, -0.5, 0, TAU); ctx.fill();
    if (b.armored) { ctx.strokeStyle = '#6b7280'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(0, 0, b.r * 0.82, b.r, 0, 0, TAU); ctx.stroke(); ctx.fillStyle = '#fff'; ctx.font = 'bold 9px Arial'; ctx.textAlign = 'center'; ctx.fillText('LEAD', 0, 3); }
    else if (b.layers > 1) { ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center'; ctx.fillText(String(b.layers), 0, 4); }
    if (st_slow(b, time)) { ctx.strokeStyle = 'rgba(123,223,242,.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(0, 0, b.r + 3, b.r + 4, 0, 0, TAU); ctx.stroke(); }
    ctx.restore();
  }
  function st_slow(b, time) { return time < b.slowUntil; }
  function drawTower(ctx, t, time) {
    var def = TOWER_DEFS[t.kind];
    ctx.save(); ctx.translate(t.x, t.y);
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(3, 10, 18, 6, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#3a4356'; ctx.beginPath(); ctx.arc(0, 4, 16, 0, TAU); ctx.fill();
    ctx.strokeStyle = def.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 4, 16, 0, TAU); ctx.stroke();
    ctx.save(); ctx.rotate(t.angle || 0);
    ctx.fillStyle = def.color;
    if (t.kind === 'cannon' || t.kind === 'mortar') { ctx.fillRect(0, -5, 24, 10); ctx.fillStyle = '#202634'; ctx.fillRect(18, -6, 8, 12); }
    else if (t.kind === 'sniper') { ctx.fillRect(0, -2, 30, 4); ctx.fillStyle = '#202634'; ctx.fillRect(26, -3, 6, 6); }
    else if (t.kind === 'frost') { ctx.fillRect(0, -6, 20, 12); ctx.fillStyle = '#e8fbff'; ctx.fillRect(16, -3, 6, 6); }
    else { ctx.fillRect(0, -3, 20, 6); ctx.fillStyle = '#202634'; ctx.fillRect(16, -4, 5, 8); }
    ctx.restore();
    ctx.fillStyle = def.color; ctx.beginPath(); ctx.arc(0, -2, 8, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-2, -4, 2.5, 0, TAU); ctx.fill();
    if (t.flash > 0) { ctx.fillStyle = 'rgba(255,240,180,.95)'; ctx.beginPath(); ctx.arc(Math.cos(t.angle || 0) * 26, -2 + Math.sin(t.angle || 0) * 26, 6, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#fff'; ctx.font = 'bold 10px Arial'; ctx.textAlign = 'center';
    for (var u = 0; u < t.level; u++) ctx.fillText('★', -12 + u * 12, 22);
    ctx.restore();
  }
  function draw(st) {
    var ctx = st.ctx;
    ctx.save();
    if (st.shake > 0) ctx.translate((Math.random() - 0.5) * st.shake, (Math.random() - 0.5) * st.shake);
    ctx.drawImage(st.bg, 0, 0);
    // placement ghost + range ring
    if (st.placing && st.mouse.x >= 0) {
      var def = TOWER_DEFS[st.placing];
      var ok = distToPath(st.mouse.x, st.mouse.y) > 34 && st.mouse.x > 20 && st.mouse.x < W - 20 && st.mouse.y > 20 && st.mouse.y < H - 20;
      ctx.strokeStyle = ok ? 'rgba(61,220,95,.8)' : 'rgba(255,90,90,.8)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(st.mouse.x, st.mouse.y, def.range, 0, TAU); ctx.stroke();
      ctx.fillStyle = ok ? 'rgba(61,220,95,.25)' : 'rgba(255,90,90,.25)';
      ctx.beginPath(); ctx.arc(st.mouse.x, st.mouse.y, 16, 0, TAU); ctx.fill();
    }
    if (st.selected) { var sel = st.selected; ctx.strokeStyle = '#00f6ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sel.x, sel.y, sel.range || 150, 0, TAU); ctx.stroke(); ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(sel.x, sel.y, 20, 0, TAU); ctx.stroke(); }
    for (var i = 0; i < st.balloons.length; i++) drawBalloon(ctx, st.balloons[i], st.time);
    for (i = 0; i < st.towers.length; i++) drawTower(ctx, st.towers[i], st.time);
    if (st.heroPlaced && st.hero) {
      var h = st.hero;
      ctx.save(); ctx.translate(h.x, h.y);
      ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(2, 12, 18, 6, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = h.color || '#ffd166'; ctx.beginPath(); ctx.arc(0, 0, 15, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 15, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#111'; ctx.font = 'bold 13px Arial'; ctx.textAlign = 'center'; ctx.fillText('★', 0, 5);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 10px Arial'; ctx.fillText('Lv ' + (h.level || 1), 0, 30);
      ctx.restore();
    }
    // projectiles
    for (i = 0; i < st.projectiles.length; i++) {
      var pr = st.projectiles[i];
      if (pr.kind === 'dart') { ctx.save(); ctx.translate(pr.x, pr.y); ctx.rotate(Math.atan2(pr.vy, pr.vx)); ctx.fillStyle = '#ffe8a3'; ctx.fillRect(-7, -1.5, 14, 3); ctx.restore(); }
      else { var tt = Math.min(1, pr.t), mx = pr.x + (pr.tx - pr.x) * tt, my = pr.y + (pr.ty - pr.y) * tt - Math.sin(tt * Math.PI) * 70; ctx.fillStyle = pr.kind === 'mortar' ? '#00f6ff' : '#ff6b35'; ctx.beginPath(); ctx.arc(mx, my, pr.kind === 'mortar' ? 7 : 5, 0, TAU); ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.beginPath(); ctx.arc(pr.tx, pr.ty, 8, 0, TAU); ctx.stroke(); }
    }
    for (i = 0; i < st.beams.length; i++) { var bm = st.beams[i]; ctx.strokeStyle = bm.color; ctx.globalAlpha = Math.max(0, bm.life / 0.18); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(bm.x1, bm.y1); ctx.lineTo(bm.x2, bm.y2); ctx.stroke(); ctx.globalAlpha = 1; }
    for (i = 0; i < st.particles.length; i++) { var pa = st.particles[i]; ctx.globalAlpha = Math.max(0, pa.life / pa.max); ctx.fillStyle = pa.color; ctx.beginPath(); ctx.arc(pa.x, pa.y, pa.size, 0, TAU); ctx.fill(); }
    ctx.globalAlpha = 1;
    for (i = 0; i < st.floaters.length; i++) { var fl = st.floaters[i]; ctx.globalAlpha = Math.min(1, fl.life); ctx.fillStyle = fl.color; ctx.font = 'bold 16px Arial'; ctx.textAlign = 'center'; ctx.fillText(fl.text, fl.x, fl.y); }
    ctx.globalAlpha = 1;
    if (st.won || st.lost) {
      ctx.fillStyle = 'rgba(5,8,20,.72)'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = st.won ? '#3ddc5f' : '#ff5a5a'; ctx.font = 'bold 44px Arial'; ctx.textAlign = 'center';
      ctx.fillText(st.won ? '🏆 YOU WIN — 50 WAVES!' : '💥 GAME OVER', W / 2, H / 2 - 10);
      ctx.fillStyle = '#fff'; ctx.font = '18px Arial';
      ctx.fillText('Score ' + st.score + '  •  Pops ' + st.pops + '  •  Gold ' + st.gold, W / 2, H / 2 + 26);
      ctx.fillStyle = '#9fb4d8'; ctx.font = '14px Arial';
      ctx.fillText('Press R to restart, or switch games in the sidebar.', W / 2, H / 2 + 52);
    }
    ctx.restore();
  }
  /* ---- Input + lifecycle ---- */
  function loop(st, now) {
    if (st.destroyed) return;
    st.rafId = (typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame(function (t) { loop(st, t); }) : setTimeout(function () { loop(st, Date.now()); }, 16));
    var dt = 0.016;
    if (st.lastT) dt = Math.min(0.05, Math.max(0, (now - st.lastT) / 1000));
    st.lastT = now;
    if (st.running && !st.won && !st.lost) {
      for (var s = 0; s < st.speed; s++) update(st, dt);
    }
    draw(st);
  }
  function canvasPos(st, ev) {
    var r = st.canvas.getBoundingClientRect();
    return { x: (ev.clientX - r.left) * (W / r.width), y: (ev.clientY - r.top) * (H / r.height) };
  }
  function tryPlace(st, x, y) {
    var def = TOWER_DEFS[st.placing];
    if (!def) return false;
    if (st.gold < def.cost) { if (st.opts.onToast) st.opts.onToast('Not enough gold: ' + def.name + ' costs ' + def.cost + 'g.', 'warn'); return false; }
    if (distToPath(x, y) <= 34) { if (st.opts.onToast) st.opts.onToast('Too close to the path.', 'warn'); return false; }
    for (var i = 0; i < st.towers.length; i++) if (dist(x, y, st.towers[i].x, st.towers[i].y) < 30) { if (st.opts.onToast) st.opts.onToast('Too close to another tower.', 'warn'); return false; }
    st.gold -= def.cost;
    st.towers.push({ kind: st.placing, x: x, y: y, range: def.range, rate: def.rate, dmg: def.dmg, color: def.color, cd: 0, angle: 0, flash: 0, level: 1 });
    st.audio.place(); st.placing = null; emitHud(st);
    return true;
  }
  function init(viewport, opts) {
    opts = opts || {};
    var st = createState(opts);
    st.sessionId = opts.sessionId || null;
    st.sessionNonce = opts.sessionNonce || null;
    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    canvas.style.width = '100%'; canvas.style.maxWidth = W + 'px'; canvas.style.display = 'block';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Cosmos BTD game board');
    viewport.innerHTML = '';
    viewport.appendChild(canvas);
    st.canvas = canvas; st.ctx = canvas.getContext('2d');
    st.bg = paintBackground();
    if (opts.hero) { st.hero = opts.hero; }
    if (opts.bus) opts.bus.emit('game:start', 'cosmos-btd', opts.hero ? [opts.hero.id] : []);
    var onMove = function (ev) { var pos = canvasPos(st, ev); st.mouse = pos; };
    var onClick = function (ev) {
      st.audio.unlock();
      var pos = canvasPos(st, ev);
      if (st.placing) { tryPlace(st, pos.x, pos.y); return; }
      if (st.hero && !st.heroPlaced) {
        if (distToPath(pos.x, pos.y) <= 34) { if (opts.onToast) opts.onToast('Hero cannot stand on the path.', 'warn'); return; }
        st.heroPlaced = true; st.hero.x = pos.x; st.hero.y = pos.y; st.hero.range = 150; st.hero.cd = 0;
        if (opts.onToast) opts.onToast(st.hero.name + ' placed!', 'ok');
        emitHud(st); return;
      }
      var found = null;
      for (var i = 0; i < st.towers.length; i++) if (dist(pos.x, pos.y, st.towers[i].x, st.towers[i].y) < 22) found = st.towers[i];
      st.selected = found;
      if (found && opts.onTowerSelect) opts.onTowerSelect(found);
      emitHud(st);
    };
    var onKey = function (ev) {
      if (ev.key === ' ') { ev.preventDefault(); if (!st.waveActive && !st.won && !st.lost) startWave(st); }
      else if (ev.key === 'Escape') { st.placing = null; st.selected = null; emitHud(st); }
      else if (ev.key === 'r' || ev.key === 'R') { reset(st); }
      else if (ev.key >= '1' && ev.key <= '5') { var kinds = Object.keys(TOWER_DEFS); setPlacing(st, kinds[Number(ev.key) - 1]); }
    };
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    st._listeners = { onMove: onMove, onClick: onClick, onKey: onKey };
    st.running = true; st.lastT = 0;
    st.rafId = (typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame(function (t) { loop(st, t); }) : setTimeout(function () { loop(st, Date.now()); }, 16));
    emitHud(st);
    var api = {
      state: st,
      setPlacing: function (kind) { setPlacing(st, kind); },
      setHero: function (hero) { st.hero = hero; st.heroPlaced = false; },
      setSession: function (sessionId, nonce) { st.sessionId = sessionId; st.sessionNonce = nonce; },
      setTargeting: function (m) { if (['first', 'last', 'strong', 'weak'].indexOf(m) >= 0) { st.targeting = m; emitHud(st); } },
      setSpeed: function (s) { st.speed = clamp(Math.round(s) || 1, 1, 3); emitHud(st); },
      setAutoStart: function (v) { st.autoStart = !!v; emitHud(st); },
      startWave: function () { startWave(st); },
      pause: function () { st.running = false; emitHud(st); },
      resume: function () { st.running = true; emitHud(st); },
      upgradeSelected: function () { upgradeSelected(st); },
      sellSelected: function () { sellSelected(st); },
      heroAbility: function () { heroAbility(st); },
      getState: function () { return { gold: st.gold, lives: st.lives, wave: st.wave, score: st.score, pops: st.pops, heroXp: st.heroXp, towers: st.towers.length, won: st.won, lost: st.lost, sessionId: st.sessionId }; },
      getHud: function () { return getHud(st); },
      destroy: function () { destroy(st); }
    };
    st._api = api;
    return api;
  }
  function setPlacing(st, kind) {
    if (!kind || !TOWER_DEFS[kind]) { st.placing = null; }
    else st.placing = kind;
    st.selected = null; emitHud(st);
  }
  function upgradeSelected(st) {
    var t = st.selected; if (!t || t.level >= 4) return false;
    var cost = 80 + t.level * 60;
    if (st.gold < cost) { if (st.opts.onToast) st.opts.onToast('Upgrade costs ' + cost + 'g.', 'warn'); return false; }
    st.gold -= cost; t.level++; t.dmg += 1; t.range += 10; t.rate = Math.max(0.25, t.rate * 0.9);
    st.audio.coin(); emitHud(st); return true;
  }
  function sellSelected(st) {
    var t = st.selected; if (!t) return false;
    var def = TOWER_DEFS[t.kind];
    st.gold += Math.floor(def.cost * 0.7);
    st.towers.splice(st.towers.indexOf(t), 1); st.selected = null; emitHud(st); return true;
  }
  function heroAbility(st) {
    if (!st.heroPlaced || !st.hero) { if (st.opts.onToast) st.opts.onToast('Place your hero first (click the board).', 'warn'); return false; }
    if (st.heroCd > 0) { if (st.opts.onToast) st.opts.onToast('Hero ability recharging: ' + Math.ceil(st.heroCd) + 's.', 'warn'); return false; }
    var h = st.hero;
    st.heroCd = 12;
    if (h.id === 'astra') { splashDamage(st, h.x, h.y, 170, 6, null); floater(st, h.x, h.y - 30, 'NOVA BURST!', '#ffd166'); }
    else if (h.id === 'lyra') { var near = nearby(st, h.x, h.y, 190); for (var i = 0; i < near.length; i++) { near[i].slowUntil = st.time + 3; near[i].slowF = 0.35; } floater(st, h.x, h.y - 30, 'ION SLOW!', '#7bdff2'); }
    else if (h.id === 'koda') { st.lives = Math.min(100, st.lives + 10); floater(st, h.x, h.y - 30, '+10 SHIELD', '#90ee90'); }
    else if (h.id === 'nova7') { var fake = { x: h.x, y: h.y, range: 999, kind: 'hero' }; var tgt = pickTarget(st, fake); if (tgt) { damageBalloon(st, tgt, 10, null); st.beams.push({ x1: h.x, y1: h.y, x2: tgt.x, y2: tgt.y, life: 0.2, color: '#ff8fab' }); } floater(st, h.x, h.y - 30, 'RAIL SHOT!', '#ff8fab'); }
    else if (h.id === 'vex') { var bosses = st.balloons.filter(function (b) { return b.boss; }); for (i = 0; i < bosses.length; i++) damageBalloon(st, bosses[i], 8, null); floater(st, h.x, h.y - 30, 'VOID STRIKE!', '#c792ea'); }
    else { for (i = 0; i < st.towers.length; i++) { var tw = st.towers[i]; if (dist(tw.x, tw.y, h.x, h.y) < 180) tw.dmg += 1; } floater(st, h.x, h.y - 30, 'KEEPER AURA!', '#e0e0e0'); }
    st.audio.clear(); emitHud(st); return true;
  }
  function reset(st) {
    var keep = { gold: 650, lives: 100, wave: 0, score: 0, pops: 0, heroXp: 0 };
    st.gold = keep.gold; st.lives = keep.lives; st.wave = keep.wave; st.score = keep.score; st.pops = keep.pops; st.heroXp = keep.heroXp;
    st.balloons = []; st.towers = []; st.projectiles = []; st.beams = []; st.floaters = []; st.particles = [];
    st.spawnQueue = []; st.waveActive = false; st.betweenWaves = true; st.won = false; st.lost = false; st.heroPlaced = false; st.selected = null; st.placing = null;
    emitHud(st);
  }
  function destroy(st) {
    st.destroyed = true; st.running = false;
    if (typeof cancelAnimationFrame !== 'undefined') { try { cancelAnimationFrame(st.rafId); } catch (e) {} }
    else { try { clearTimeout(st.rafId); } catch (e) {} }
    if (st.canvas && st._listeners) { st.canvas.removeEventListener('mousemove', st._listeners.onMove); st.canvas.removeEventListener('click', st._listeners.onClick); }
    if (st._listeners) document.removeEventListener('keydown', st._listeners.onKey);
    if (st.audio) st.audio.close();
    if (st.opts.bus) st.opts.bus.emit('game:ended', 'cosmos-btd', { score: st.score, wave: st.wave });
  }

  var manifest = { id: 'cosmos-btd', name: 'Cosmos BTD', version: '1.0.0', description: 'Bloons-style tower defense: 50 waves, 5 towers, heroes, targeting, 1x-3x speed.', entry: 'btd.js', canvas: true, maxWaves: 50 };

  global.CosmosBTD = { manifest: manifest, init: init, TOWER_DEFS: TOWER_DEFS, BALLOON_TYPES: BALLOON_TYPES, _createState: createState };
})(typeof window !== 'undefined' ? window : globalThis);

/* Cosmos BTD — TowerDefenseEngine game module for the GAME Engine Hub.
 *
 * Implements the IGameModule lifecycle the EngineHost requires:
 *   init(viewport, {bus, wallet, config, hero, player, onHud, onToast})
 *   destroy(), setHero(hero), getState()
 *
 * Rendering: real image sprites (battlefield photo, monster/tower/hero
 * art from public/assets/sprites) with a full procedural fallback, so
 * nothing breaks if an asset is missing. The background is pre-rendered
 * once to an offscreen canvas. Post-processing (Pillar 1): bloom glow
 * pass, dynamic 2D lighting, vignette + danger pulse, tilt-shift depth
 * bands, animated water shader on the pond. Particles are a pooled
 * system with kinds (spark/smoke/ring/splash) and wind.
 *
 * Architecture (Pillar 2): entities live in a small ECS - component
 * tables (position/health/path/combat/render/lifetime) hold references
 * to the same objects the game arrays iterate, and systems
 * (Movement/Combat/Projectile/Particle/Spike) query those tables.
 * Collision uses a spatial hash (64px cells). Physics runs on a fixed
 * 60Hz timestep with an accumulator; balloon rendering interpolates
 * between physics steps so motion stays smooth on 60/120/144Hz screens.
 * Assets load through a central AssetManager queue with pre-decode.
 *
 * Towers (7): Dart Archer, Cannon (splash), Sniper (hitscan, global
 * range), Frost Beam (slow), Plasma Mortar (lobbed splash), Tesla Coil
 * (chain lightning, sees camo), Spike Factory (contact spike piles).
 * Targeting: first | last | strong | weak. Waves: 50 + endless mode,
 * boss every 10 (shielded from wave 30). Enemies: camo, fortified,
 * regen, splitting, armored lead.
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
    sniper: { name: 'Sniper',        key: '3', cost: 250, range: 999, rate: 1.45, dmg: 3, color: '#c792ea', camo: true, desc: 'Global range. Instant beam. Cracks lead. Sees camo.' },
    frost:  { name: 'Frost Beam',    key: '4', cost: 150, range: 98,  rate: 0.90, dmg: 1, slow: 0.5, slowDur: 1.3, color: '#7bdff2', desc: 'Slows everything it touches.' },
    mortar: { name: 'Plasma Mortar', key: '5', cost: 350, range: 330, rate: 2.30, dmg: 4, splash: 82, color: '#00f6ff', desc: 'Long-range lobbed plasma. Huge splash. Cracks lead.' },
    tesla:  { name: 'Tesla Coil',     key: '6', cost: 300, range: 140, rate: 1.10, dmg: 2, chains: 3, color: '#facc15', camo: true, desc: 'Chain lightning hits 3. Sees camo.' },
    spikes: { name: 'Spike Factory', key: '7', cost: 220, range: 90,  rate: 0.80, dmg: 1, color: '#94a3b8', desc: 'Drops spikes that pop on contact.' }
  };

  /* ---- Batch 6 (Pillar 4): branching upgrade trees ----
   * Each tower may commit to ONE branch (locked on first choice) with
   * up to 3 branch points. Speed: faster shots + range. Power: more
   * damage + bigger splash (via splashBonus, applied in fireTower).
   * Branch upgrades are separate from the linear Lv1-5 upgrades, so
   * existing upgrade costs are unchanged. At Lv4/Lv5 a tower is
   * Evolved/Ascended: larger sprite + evolution ring in drawTower. */
  var BRANCH_DEFS = {
    speed: { name: 'Rapid Fire', desc: 'Faster shots, wider range', max: 3 },
    power: { name: 'Heavy Impact', desc: 'More damage, bigger splash', max: 3 }
  };
  function branchUpgradeCostFor(t, branch) {
    if (!t || !BRANCH_DEFS[branch]) return null;
    var lv = (t.paths && t.paths[branch]) || 0;
    if (lv >= BRANCH_DEFS[branch].max) return null;
    if (t.branch && t.branch !== branch) return null;
    return 100 + lv * 70;
  }
  function evolutionFor(t) { if (!t) return null; return t.level >= 5 ? 'Ascended' : t.level >= 4 ? 'Evolved' : null; }
  function branchOptionsFor(t) {
    if (!t) return [];
    return Object.keys(BRANCH_DEFS).map(function (b) {
      return { branch: b, name: BRANCH_DEFS[b].name, desc: BRANCH_DEFS[b].desc, level: (t.paths && t.paths[b]) || 0, max: BRANCH_DEFS[b].max, cost: branchUpgradeCostFor(t, b), locked: !!(t.branch && t.branch !== b) };
    });
  }

  /* ---- Batch 6 (Pillar 4): hero commander gear ----
   * Two equipment slots (weapon/charm). Gear is a plain catalog here;
   * no server persistence in this batch — the shell keeps the equipped
   * hero, gear applies inside the run only. */
  var HERO_GEAR = {
    'ion-blade': { slot: 'weapon', name: 'Ion Blade', dmgBonus: 1, rangeBonus: 0 },
    'rail-lance': { slot: 'weapon', name: 'Rail Lance', dmgBonus: 2, rangeBonus: 0 },
    'void-charm': { slot: 'charm', name: 'Void Charm', dmgBonus: 0, rangeBonus: 30 },
    'keeper-medal': { slot: 'charm', name: 'Keeper Medal', dmgBonus: 0, rangeBonus: 20 }
  };
  function heroGearBonus(h) {
    var b = { dmg: 0, range: 0 };
    if (!h || !h.equipment) return b;
    Object.keys(h.equipment).forEach(function (slot) {
      var g = HERO_GEAR[h.equipment[slot]];
      if (g) { b.dmg += g.dmgBonus || 0; b.range += g.rangeBonus || 0; }
    });
    return b;
  }
  /* Ability tiers unlock with run level: Lv1-2 tier 1, Lv3-4 tier 2,
   * Lv5+ tier 3 (stronger effect, shorter cooldown in heroAbility). */
  function heroAbilityTier(h) { var lv = (h && h.level) || 1; return Math.min(3, 1 + Math.floor((lv - 1) / 2)); }

  var BALLOON_TYPES = [
    { layers: 1, color: '#ff5a5a', dark: '#c62828', speed: 62,  reward: 6,  name: 'Red', sprite: 'monster-1' },
    { layers: 2, color: '#4f8cff', dark: '#1d4ed8', speed: 70,  reward: 7,  name: 'Blue', sprite: 'monster-2' },
    { layers: 3, color: '#3ddc5f', dark: '#15803d', speed: 78,  reward: 8,  name: 'Green', sprite: 'monster-3' },
    { layers: 4, color: '#ffd166', dark: '#d97706', speed: 88,  reward: 9,  name: 'Gold', sprite: 'monster-4' },
    { layers: 5, color: '#ff8fab', dark: '#db2777', speed: 112, reward: 11, name: 'Pink', sprite: 'monster-5' },
    { layers: 6, color: '#c9ced6', dark: '#6b7280', speed: 56,  reward: 14, name: 'Lead', armored: true, sprite: 'monster-3' },
    { layers: 5, color: '#e8e8f0', dark: '#111827', speed: 96,  reward: 13, name: 'Zebra', splits: true, sprite: 'monster-2' },
    { layers: 3, color: '#1f2937', dark: '#000000', speed: 84,  reward: 10, name: 'Camo', camo: true, sprite: 'monster-5' },
    { layers: 8, color: '#78350f', dark: '#451a03', speed: 48,  reward: 18, name: 'Fortified', fortified: true, sprite: 'monster-4' },
    { layers: 4, color: '#f472b6', dark: '#be185d', speed: 80,  reward: 10, name: 'Regen', regen: true, sprite: 'monster-1' }
  ];

  /* ---- Image sprites (procedural fallback when assets are missing) ---- */
  var SPRITES = {};
  var TOWER_SPRITES = { dart: 'tower-validator', cannon: 'tower-railgun', sniper: 'tower-nova', frost: 'tower-cryo', mortar: 'tower-ion', tesla: 'tower-nova', spikes: 'tower-validator' };
  var HERO_SPRITES = { astra: 'hero-astra', lyra: 'hero-lyra', koda: 'hero-koda', nova7: 'hero-nova7', vex: 'hero-vex', orin: 'hero-orin' };
  function spriteReady(img) { return !!(img && img.complete && img.naturalWidth > 0); }
  /* ---- Asset pipeline: central load queue, pre-decode, one retry ---- */
  var AssetManager = {
    total: 0, loaded: 0, failed: 0, queue: [],
    enqueue: function (key, src) { this.queue.push({ key: key, src: src, tries: 0 }); this.total++; },
    loadAll: function (onProgress, onDone) {
      var self = this;
      if (typeof Image === 'undefined' || typeof document === 'undefined') { if (onDone) onDone(); return; }
      var pending = self.queue.length;
      if (!pending) { if (onDone) onDone(); return; }
      self.queue.forEach(function (item) {
        var img = new Image();
        img.onload = function () {
          var done = function () { SPRITES[item.key] = img; self.loaded++; if (onProgress) onProgress(self.loaded, self.total); if (--pending === 0 && onDone) onDone(); };
          if (img.decode) { try { var pr = img.decode(); if (pr && pr.then) pr.then(done, done); else done(); } catch (e) { done(); } } else done();
        };
        img.onerror = function () {
          if (item.tries < 1) { item.tries++; img.src = item.src; return; }
          self.failed++; if (onProgress) onProgress(self.loaded, self.total); if (--pending === 0 && onDone) onDone();
        };
        img.src = item.src;
      });
    },
    get: function (key) { return SPRITES[key] || null; }
  };
  function loadSprites(onReady) {
    AssetManager.queue = []; AssetManager.total = 0; AssetManager.loaded = 0; AssetManager.failed = 0;
    AssetManager.enqueue('bg', 'assets/sprites/battlefield.jpg');
    BALLOON_TYPES.forEach(function (t) { AssetManager.enqueue(t.sprite, 'assets/sprites/' + t.sprite + '.png'); });
    Object.keys(TOWER_SPRITES).forEach(function (k) { var f = TOWER_SPRITES[k]; AssetManager.enqueue(f, 'assets/sprites/' + f + '.png'); });
    Object.keys(HERO_SPRITES).forEach(function (k) { var f = HERO_SPRITES[k]; AssetManager.enqueue(f, 'assets/sprites/' + f + '.png'); });
    AssetManager.loadAll(null, onReady);
  }

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

  /* ---- Batch 6 (Pillar 4): adaptive pathfinding + hazards ----
   * The track stays the Catmull-Rom spline above. On top of it:
   * (a) two terrain hazard zones centred ON the spline slow balloons
   *     and trigger a lateral detour while the balloon is inside;
   * (b) every 10th wave balloons take a wide "high road" lateral
   *     offset that bulges mid-track. Offsets are stored per balloon
   *     (b.ox/b.oy) so drawBalloon renders the same detoured position
   *     the physics uses. This is not A* or tower avoidance: towers
   *     may not be placed within 34px of the path, so no reroute
   *     around towers is needed. */
  var HAZARDS = (function () {
    var c1 = pointAt(totalLen * 0.38), c2 = pointAt(totalLen * 0.72);
    return [
      { x: c1[0], y: c1[1], r: 58, kind: 'mud', slow: 0.55 },
      { x: c2[0], y: c2[1], r: 58, kind: 'bramble', slow: 0.7 }
    ];
  })();
  function hazardAt(x, y) {
    var factor = 1, hz = null;
    for (var i = 0; i < HAZARDS.length; i++) {
      var h = HAZARDS[i];
      if (dist(x, y, h.x, h.y) <= h.r) { if (h.slow < factor) factor = h.slow; hz = h; }
    }
    return { factor: factor, hazard: hz };
  }
  function routeOffset(distAlong, wave) {
    if (!wave || wave % 10 !== 0) return 0;
    return Math.sin((distAlong / totalLen) * Math.PI) * 18;
  }

  /* ---- Batch 6 (Pillar 4): weather ----
   * Global state, not per-balloon. Storm: lightning strikes near a
   * random tower every 2s. Blizzard: all balloons slowed to 70%.
   * Auto-triggered at wave start on every 5th wave (storm) / 10th
   * wave (blizzard); also settable via api.setWeather for tests. */
  var WEATHER_KINDS = ['clear', 'storm', 'blizzard'];
  function weatherSlowFactor(st) { return (st.weather && st.weather.kind === 'blizzard') ? 0.7 : 1; }
  function setWeather(st, kind, seconds) {
    if (WEATHER_KINDS.indexOf(kind) < 0) return false;
    st.weather = { kind: kind, until: st.time + (seconds || 8), strikeT: 0 };
    if (kind !== 'clear') floater(st, W / 2, 40, kind === 'storm' ? '⛈ THUNDERSTORM!' : '❄ BLIZZARD!', kind === 'storm' ? '#ffd166' : '#7bdff2');
    emitHud(st);
    return true;
  }
  function lightningStrike(st) {
    var x, y;
    if (st.towers.length) { var t = st.towers[Math.floor(Math.random() * st.towers.length)]; x = t.x; y = t.y; }
    else if (st.balloons.length) { var b = st.balloons[Math.floor(Math.random() * st.balloons.length)]; x = b.x; y = b.y; }
    else return;
    splashDamage(st, x, y, 70, 3, null);
    addLight(st, x, y, 130, '#fff7ae', 0.25, 1);
    spawnParticle(st, x, y, '#fff7ae', 10, 120, 'spark');
    addShake(st, 5);
    floater(st, x, y - 30, 'LIGHTNING!', '#fff7ae');
  }
  function updateWeather(st, dt) {
    var w = st.weather;
    if (!w || w.kind === 'clear') return;
    if (st.time >= w.until) { st.weather = { kind: 'clear', until: 0, strikeT: 0 }; floater(st, W / 2, 40, 'Weather clears', '#9fb4d8'); emitHud(st); return; }
    if (w.kind === 'storm') { w.strikeT -= dt; if (w.strikeT <= 0) { w.strikeT = 2; lightningStrike(st); } }
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
    var bgImg = SPRITES.bg;
    if (spriteReady(bgImg)) { b.drawImage(bgImg, 0, 0, W, H); b.fillStyle = 'rgba(6,10,22,.55)'; b.fillRect(0, 0, W, H); }
    var g = b.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(63,158,77,.55)'); g.addColorStop(0.55, 'rgba(47,138,62,.55)'); g.addColorStop(1, 'rgba(42,125,56,.55)');
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
    var AC = null, muted = false, master = 1;
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
      g.gain.setValueAtTime((vol || 0.12) * master, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + dur + 0.02);
    }
    function noise(dur, vol, fc) {
      var ac = audio(); if (!ac) return;
      var n = Math.floor(ac.sampleRate * dur), buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      var s = ac.createBufferSource(); s.buffer = buf;
      var f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = fc || 900;
      var g = ac.createGain(); g.gain.value = (vol || 0.2) * master;
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
      over: function () { [400, 320, 240, 160].forEach(function (f, i) { tone(f, f, 0.22, 'sawtooth', 0.11, i * 0.14); }); },
      spike: function () { tone(340, 160, 0.07, 'square', 0.07); },
      zap: function () { tone(1800, 300, 0.12, 'sawtooth', 0.07); noise(0.04, 0.08, 5000); },
      setVolume: function (v) { master = clamp(v, 0, 1); }
    };
  }

  /* ---- Engine state ---- */
  function createState(opts) {
    return {
      opts: opts || {},
      canvas: null, ctx: null, bg: null,
      running: false, destroyed: false, rafId: 0, lastT: 0, time: 0,
      gold: 650, lives: 100, wave: 0, score: 0, pops: 0, endless: false, challenge: false, paused: false, quality: 'high', shakeOn: true, fps: 0, _fpsN: 0, _fpsT: 0,
      balloons: [], towers: [], projectiles: [], beams: [], floaters: [], spikes: [],
      particles: [], spawnQueue: [], spawnTimer: 0, betweenWaves: true,
      speed: 1, autoStart: false, targeting: 'first', placing: null,
      selected: null, hoverTower: null, hero: null, heroPlaced: false, heroCd: 0, heroXp: 0,
      fpsTarget: 60, particleDensity: 'high', motionBlur: false, displayScale: 'auto', _lastFrameT: 0,
      sessionId: null, sessionNonce: null, pendingReports: [],
      shake: 0, waveActive: false, won: false, lost: false,
      mouse: { x: -999, y: -999 },
      audio: makeAudio(),
      grid: new Map(), ecs: createECS(),
      lights: [], acc: 0, alpha: 1, windX: 0, postfx: true, dof: true,
      gridQueries: 0, glowCv: null, glowCtx: null, sceneCv: null, sceneCtx: null, blurCv: null, blurCtx: null, vigCv: null,
      weather: { kind: 'clear', until: 0, strikeT: 0 }, reroutes: 0, hazardSlows: 0
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
    if (st) st.gridQueries = (st.gridQueries || 0) + 1;
    var out = [], x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL), y0 = Math.floor((y - r) / CELL), y1 = Math.floor((y + r) / CELL);
    for (var cx = x0; cx <= x1; cx++) for (var cy = y0; cy <= y1; cy++) {
      var arr = st.grid.get(gridKey(cx, cy));
      if (arr) for (var i = 0; i < arr.length; i++) out.push(arr[i]);
    }
    return out;
  }
  /* ---- ECS: entities + component tables + systems (Pillar 2) ----
   * Component tables hold references to the same objects the game
   * arrays iterate, so there is one source of truth. Systems query
   * the tables; the render-order lists (st.balloons, st.towers, ...)
   * stay as plain arrays for draw order. */
  function createECS() {
    return { nextId: 1, entities: {}, position: {}, velocity: {}, health: {}, path: {}, combat: {}, render: {}, lifetime: {}, light: {} };
  }
  function ecsAdd(st, kind, comps) {
    var id = st.ecs.nextId++;
    st.ecs.entities[id] = { id: id, kind: kind, alive: true };
    var names = Object.keys(comps || {});
    for (var i = 0; i < names.length; i++) st.ecs[names[i]][id] = comps[names[i]];
    return id;
  }
  function ecsRemove(st, id) {
    delete st.ecs.entities[id];
    var tables = ['position', 'velocity', 'health', 'path', 'combat', 'render', 'lifetime', 'light'];
    for (var i = 0; i < tables.length; i++) delete st.ecs[tables[i]][id];
  }
  function ecsQuery(st, table) { return st.ecs[table]; }
  /* Pillar 3 (ECS remainder): component tables are the single iteration
   * source for systems. ecsEntitiesOfKind returns the live objects in
   * registration order from the tables; the plain arrays (st.balloons,
   * st.towers) remain render-order lists, kept in sync by the same
   * ecsAdd/ecsRemove calls. */
  function ecsEntitiesOfKind(st, kind) {
    var out = [], ids = Object.keys(st.ecs.entities);
    for (var i = 0; i < ids.length; i++) {
      var e = st.ecs.entities[ids[i]];
      if (!e || e.kind !== kind) continue;
      var obj = st.ecs.position[ids[i]] || st.ecs.combat[ids[i]] || st.ecs.render[ids[i]];
      if (obj) out.push(obj);
    }
    return out;
  }
  function upgradeCostFor(t) { return t.level >= 5 ? null : 80 + t.level * 60; }
  /* Branch upgrade (Batch 6): locks the tower to one branch, applies
   * the branch bonus, and returns false when unaffordable, locked, or
   * maxed. Requires tower level 2+ so the choice follows investment. */
  function upgradeBranchSelected(st, branch) {
    var t = st.selected;
    if (!t || !BRANCH_DEFS[branch]) return false;
    if (t.level < 2) { if (st.opts.onToast) st.opts.onToast('Reach tower level 2 to choose a branch.', 'warn'); return false; }
    var cost = branchUpgradeCostFor(t, branch);
    if (cost == null) return false;
    if (st.gold < cost) { if (st.opts.onToast) st.opts.onToast('Branch upgrade costs ' + cost + 'g.', 'warn'); return false; }
    st.gold -= cost;
    t.branch = branch;
    t.paths = t.paths || { speed: 0, power: 0 };
    t.paths[branch] = (t.paths[branch] || 0) + 1;
    if (branch === 'speed') { t.rate = Math.max(0.22, t.rate * 0.88); t.range += 6; }
    else { t.dmg += 1; t.splashBonus = (t.splashBonus || 0) + 12; }
    floater(st, t.x, t.y - 30, BRANCH_DEFS[branch].name + ' ' + t.paths[branch] + '!', '#c792ea');
    st.audio.coin(); emitHud(st); return true;
  }
  function effectivenessFor(t, def) {
    var dps = t.dmg / Math.max(0.22, t.rate);
    var fast = clamp(Math.round(t.rate <= 0.5 ? 92 : t.rate <= 0.9 ? 78 : t.rate <= 1.2 ? 64 : 48) + (def.splash ? 8 : 0), 0, 100);
    var armored = (t.kind === 'cannon' || t.kind === 'mortar' || t.kind === 'sniper') ? 95 : t.kind === 'tesla' ? 70 : t.kind === 'spikes' ? 60 : t.kind === 'frost' ? 55 : 15;
    var camo = t.canSeeCamo ? 95 : 10;
    var boss = clamp(Math.round(dps * 10 + (def.splash ? 25 : 0)), 0, 100);
    return { fast: fast, armored: armored, camo: camo, boss: boss };
  }
  /* Inspection payload for the shell's stat card: current stats, the
   * next upgrade step, sell refund, and tactical effectiveness. */
  function towerInspect(st, t) {
    if (!t) return null;
    var def = TOWER_DEFS[t.kind]; if (!def) return null;
    var cost = upgradeCostFor(t);
    return {
      kind: t.kind, name: def.name, level: t.level, maxed: !!t.maxed,
      dmg: t.dmg, range: Math.round(t.range), rate: t.rate, cost: def.cost,
      upgradeCost: cost,
      nextDmg: t.level >= 5 ? t.dmg : (t.level === 4 ? t.dmg + 2 : t.dmg + 1),
      nextRange: t.level >= 5 ? Math.round(t.range) : Math.round(t.range + (t.level === 4 ? 15 : 10)),
      sellRefund: Math.floor(def.cost * 0.7),
      effectiveness: effectivenessFor(t, def),
      branch: t.branch || null,
      branchLevel: t.branch ? ((t.paths && t.paths[t.branch]) || 0) : 0,
      evolution: evolutionFor(t),
      branchOptions: branchOptionsFor(t)
    };
  }

  /* ---- Particle system: pooled, kinds, wind (Pillar 1) ---- */
  function spawnParticle(st, x, y, color, n, speed, kind) {
    if (st.quality === 'low') return;
    var densityMul = st.particleDensity === 'low' ? 0.35 : st.particleDensity === 'med' ? 0.65 : 1;
    n = Math.max(1, Math.ceil((n || 8) * densityMul));
    var cap = st.particleDensity === 'low' ? 150 : 400;
    kind = kind || 'spark';
    for (var i = 0; i < (n || 8); i++) {
      if (st.particles.length > cap) { var old = st.particles.shift(); if (old && old.ecsId) ecsRemove(st, old.ecsId); }
      var a = Math.random() * TAU, s = (speed || 90) * (0.4 + Math.random() * 0.9);
      var p = { x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.35 + Math.random() * 0.35, max: 0.7, color: color, size: 2 + Math.random() * 3, kind: kind, grow: 22 };
      if (kind === 'smoke') { p.life = 0.6 + Math.random() * 0.5; p.max = p.life; p.size = 6 + Math.random() * 6; p.vy -= 30; }
      if (kind === 'ring') { p.life = 0.35; p.max = 0.35; p.size = 6; p.vx = 0; p.vy = 0; p.grow = 150; }
      if (kind === 'splash') { p.life = 0.4 + Math.random() * 0.3; p.max = p.life; }
      p.ecsId = ecsAdd(st, 'particle', { position: p, velocity: p, lifetime: p, render: p });
      st.particles.push(p);
    }
  }
  /* Floating combat text: kinds carry size/life; FxSystem gives them
   * upward velocity + gravity and fades them out (drawOverlays). */
  function floater(st, x, y, text, color, opts) {
    opts = opts || {};
    var kind = opts.kind || 'info';
    var fl = { x: x, y: y, text: text, color: color || '#ffd166', life: kind === 'crit' ? 1.1 : 0.9, vy: kind === 'crit' ? -95 : -70, size: kind === 'crit' ? 22 : kind === 'coin' ? 14 : 16, kind: kind };
    fl.ecsId = ecsAdd(st, 'floater', { position: fl, render: fl, lifetime: fl });
    st.floaters.push(fl);
  }
  function addBeam(st, b) { b.ecsId = ecsAdd(st, 'beam', { render: b, lifetime: b }); st.beams.push(b); return b; }
  function addShake(st, amt) { st.shake = Math.max(st.shake, amt); }
  function addLight(st, x, y, radius, color, life, intensity) {
    if (st.lights.length > 24) { var oldL = st.lights.shift(); if (oldL && oldL.ecsId) ecsRemove(st, oldL.ecsId); }
    var l = { x: x, y: y, radius: radius, color: color, life: life, max: life, intensity: intensity || 1 };
    l.ecsId = ecsAdd(st, 'light', { position: l, light: l, lifetime: l });
    st.lights.push(l);
    return l;
  }

  function waveComposition(w) {
    var list = [];
    var push = function (type, n) { for (var i = 0; i < n; i++) list.push(type); };
    if (w <= 5) { push(0, 6 + w * 2); if (w >= 3) push(1, w); }
    else if (w <= 12) { push(0, 8); push(1, 6 + w); push(2, w - 3); if (w >= 8) push(3, w - 6); if (w >= 6) push(7, w - 4); }
    else if (w <= 25) { push(1, 8); push(2, 10 + w); push(3, w - 8); push(4, Math.floor(w / 2)); if (w >= 18) push(5, 2 + Math.floor(w / 6)); if (w >= 20) push(6, 1 + Math.floor(w / 8)); if (w >= 10) push(9, Math.floor(w / 3)); if (w >= 14) push(8, 2 + Math.floor(w / 7)); push(7, 3); }
    else { push(2, 14); push(3, 14); push(4, 10); push(5, 6); push(6, 3 + Math.floor(w / 6)); push(7, 6); push(8, 4); push(9, 6); }
    if (w % 10 === 0) list.push(-1); // boss blimp
    return list;
  }
  function startWave(st) {
    if (st.waveActive || st.won || st.lost) return;
    st.wave++;
    st.spawnQueue = waveComposition(st.wave);
    st.spawnTimer = 0.4;
    st.waveActive = true; st.betweenWaves = false;
    if (st.wave % 10 === 0) setWeather(st, 'blizzard', 8);
    else if (st.wave % 5 === 0) setWeather(st, 'storm', 8);
    floater(st, W / 2, 60, 'WAVE ' + st.wave, '#00f6ff');
    emitHud(st);
  }
  function spawnBalloon(st, typeIdx) {
    if (typeIdx === -1) {
      var pt = pointAt(0);
      st.balloons.push({ boss: true, x: pt[0], y: pt[1], dist: 0, prevDist: 0, layers: 60, maxLayers: 60, r: 34, speed: 26, reward: 250, wob: Math.random() * TAU, slowUntil: 0, slowF: 1, armored: false, shieldUntil: st.wave >= 30 ? st.time + 5 : 0, sprite: 'monster-4', type: BALLOON_TYPES[3] });
      var bb0 = st.balloons[st.balloons.length - 1]; bb0.ecsId = ecsAdd(st, 'balloon', { position: bb0, health: bb0, path: bb0, render: bb0 });
      return;
    }
    var t = BALLOON_TYPES[typeIdx], p2 = pointAt(0);
    st.balloons.push({ boss: false, x: p2[0], y: p2[1], dist: 0, prevDist: 0, layers: t.layers, maxLayers: t.layers, r: 11 + t.layers * 1.5, speed: t.speed * (1 + st.wave * 0.012), reward: t.reward, wob: Math.random() * TAU, slowUntil: 0, slowF: 1, armored: !!t.armored, splits: !!t.splits, camo: !!t.camo, fortified: !!t.fortified, regen: !!t.regen, regenT: 0, sprite: t.sprite, type: t });
    var bb1 = st.balloons[st.balloons.length - 1]; bb1.ecsId = ecsAdd(st, 'balloon', { position: bb1, health: bb1, path: bb1, render: bb1 });
  }
  function damageBalloon(st, b, dmg, sourceTower) {
    if (b.dead) return;
    if (b.shieldUntil && st.time < b.shieldUntil) return;
    if (b.fortified && !(sourceTower && (sourceTower.kind === 'cannon' || sourceTower.kind === 'mortar'))) dmg = Math.max(1, Math.ceil(dmg / 2));
    var heroNear = st.heroPlaced && st.hero && dist(b.x, b.y, st.hero.x, st.hero.y) < 170;
    if (b.armored && sourceTower && sourceTower.kind === 'dart') return; // darts cannot crack lead
    if (b.boss) { b.layers -= dmg; st.pops += dmg; if (b.layers <= 0) { b.dead = true; st.gold += b.reward; st.score += 500; spawnParticle(st, b.x, b.y, '#ffd166', 26, 160, 'spark'); spawnParticle(st, b.x, b.y, '#ffd166', 1, 10, 'ring'); spawnParticle(st, b.x, b.y, '#8a8f9c', 8, 60, 'smoke'); addLight(st, b.x, b.y, 160, '#ffd166', 0.4, 1); addShake(st, 7); floater(st, b.x, b.y, '+' + b.reward + 'g', '#ffd166', { kind: 'coin' }); st.audio.coin(); } return; }
    b.layers -= dmg; st.pops += dmg;
    if (b.layers <= 0) {
      b.dead = true; st.gold += b.reward; st.score += 10;
      if (st.floaters.length < 24) floater(st, b.x, b.y - 28, '+' + b.reward + 'g', '#ffd166', { kind: 'coin' });
      spawnParticle(st, b.x, b.y, b.type.color, 10, 110);
      if (heroNear) st.heroXp += 2;
      if (b.splits) { for (var i = 0; i < 2; i++) { var nb = { boss: false, x: b.x + (i ? 8 : -8), y: b.y, dist: b.dist, prevDist: b.dist, layers: 2, maxLayers: 2, r: 14, speed: b.speed * 1.15, reward: 7, wob: Math.random() * TAU, slowUntil: 0, slowF: 1, armored: false, splits: false, sprite: 'monster-2', type: BALLOON_TYPES[1] }; nb.ecsId = ecsAdd(st, 'balloon', { position: nb, health: nb, path: nb, render: nb }); st.balloons.push(nb); } }
      st.audio.pop();
    } else {
      b.r = 11 + b.layers * 1.5;
      spawnParticle(st, b.x, b.y, b.type.color, 4, 70);
      if (dmg >= 3 && st.floaters.length < 24) floater(st, b.x, b.y - 16, (dmg >= 5 ? 'CRIT -' : '-') + dmg, dmg >= 5 ? '#ffd166' : '#ffffff', { kind: dmg >= 5 ? 'crit' : 'damage' });
    }
  }
  function splashDamage(st, x, y, radius, dmg, sourceTower) {
    var targets = nearby(st, x, y, radius + 20);
    for (var i = 0; i < targets.length; i++) { var b = targets[i]; if (!b.dead && dist(b.x, b.y, x, y) <= radius + b.r) damageBalloon(st, b, dmg, sourceTower); }
    spawnParticle(st, x, y, '#ff9e00', 14, 130, 'spark');
    spawnParticle(st, x, y, '#8a8f9c', 5, 50, 'smoke');
    addLight(st, x, y, radius + 40, '#ff9e00', 0.3, 1);
  }
  function pickTarget(st, tower) {
    var inRange = [];
    var cands = nearby(st, tower.x, tower.y, tower.range + 40);
    for (var i = 0; i < cands.length; i++) { var b = cands[i]; if (!b.dead && dist(b.x, b.y, tower.x, tower.y) <= tower.range + b.r && (!b.camo || tower.canSeeCamo || tower.kind === 'hero')) inRange.push(b); }
    if (!inRange.length) return null;
    var mode = st.targeting;
    if (mode === 'last') return inRange.reduce(function (a, b) { return b.dist < a.dist ? b : a; });
    if (mode === 'strong') return inRange.reduce(function (a, b) { return (b.layers > a.layers || (b.layers === a.layers && b.dist > a.dist)) ? b : a; });
    if (mode === 'weak') return inRange.reduce(function (a, b) { return (b.layers < a.layers || (b.layers === a.layers && b.dist < a.dist)) ? b : a; });
    return inRange.reduce(function (a, b) { return b.dist > a.dist ? b : a; }); // first
  }
  function fireTower(st, tower, target) {
    var def = TOWER_DEFS[tower.kind];
    if (tower.kind === 'spikes') {
      if (st.spikes.length > 60) { var oldSp = st.spikes.shift(); if (oldSp && oldSp.ecsId) ecsRemove(st, oldSp.ecsId); }
      var a = Math.random() * TAU, rr = Math.random() * tower.range * 0.7;
      var spk0 = { x: tower.x + Math.cos(a) * rr, y: tower.y + Math.sin(a) * rr, life: 8, pops: 3, dmg: tower.dmg };
      spk0.ecsId = ecsAdd(st, 'spike', { position: spk0, render: spk0, lifetime: spk0 });
      st.spikes.push(spk0);
      tower.flash = 0.12; st.audio.spike(); return;
    }
    tower.angle = Math.atan2(target.y - tower.y, target.x - tower.x);
    tower.flash = 0.12;
    if (tower.kind === 'tesla') {
      var hit = [target], cur = target;
      for (var c = 0; c < (def.chains || 3) - 1; c++) {
        var nx = null, nd = 110, near = nearby(st, cur.x, cur.y, 110);
        for (var k = 0; k < near.length; k++) { var nb = near[k]; if (!nb.dead && hit.indexOf(nb) < 0) { var dd = dist(cur.x, cur.y, nb.x, nb.y); if (dd < nd) { nd = dd; nx = nb; } } }
        if (!nx) break;
        addBeam(st, { x1: cur.x, y1: cur.y, x2: nx.x, y2: nx.y, life: 0.14, color: def.color });
        damageBalloon(st, nx, Math.max(1, tower.dmg - c), tower);
        hit.push(nx); cur = nx;
      }
      addBeam(st, { x1: tower.x, y1: tower.y - 12, x2: target.x, y2: target.y, life: 0.14, color: def.color });
      damageBalloon(st, target, tower.dmg, tower); addLight(st, tower.x, tower.y - 12, 95, '#facc15', 0.14, 1); st.audio.zap(); return;
    }
    if (tower.kind === 'sniper') {
      addBeam(st, { x1: tower.x, y1: tower.y - 14, x2: target.x, y2: target.y, life: 0.12, color: def.color });
      damageBalloon(st, target, tower.dmg, tower); addLight(st, tower.x, tower.y - 14, 70, '#c792ea', 0.12, 1); st.audio.sniper();
    } else if (tower.kind === 'frost') {
      addBeam(st, { x1: tower.x, y1: tower.y - 10, x2: target.x, y2: target.y, life: 0.18, color: def.color });
      target.slowUntil = st.time + (def.slowDur || 1.3); target.slowF = def.slow || 0.5;
      damageBalloon(st, target, tower.dmg, tower); addLight(st, tower.x, tower.y - 10, 70, '#7bdff2', 0.16, 1); st.audio.frost();
    } else if (tower.kind === 'mortar') {
      if (st.projectiles.length < 128) { st.projectiles.push({ kind: 'mortar', x: tower.x, y: tower.y - 16, tx: target.x, ty: target.y, t: 0, dur: 0.7, dmg: tower.dmg, splash: (def.splash || 0) + (tower.splashBonus || 0), source: tower }); var prM = st.projectiles[st.projectiles.length - 1]; prM.ecsId = ecsAdd(st, 'projectile', { position: prM, velocity: prM, combat: prM, lifetime: prM, render: prM }); }
      addLight(st, tower.x, tower.y - 16, 70, '#00f6ff', 0.12, 1); st.audio.cannon();
    } else if (tower.kind === 'cannon') {
      if (st.projectiles.length < 128) { st.projectiles.push({ kind: 'shell', x: tower.x, y: tower.y - 12, tx: target.x, ty: target.y, t: 0, dur: 0.35, dmg: tower.dmg, splash: (def.splash || 0) + (tower.splashBonus || 0), source: tower }); var prS = st.projectiles[st.projectiles.length - 1]; prS.ecsId = ecsAdd(st, 'projectile', { position: prS, velocity: prS, combat: prS, lifetime: prS, render: prS }); }
      addLight(st, tower.x, tower.y - 12, 70, '#ff9e00', 0.12, 1); st.audio.cannon(); addShake(st, 4);
    } else {
      if (st.projectiles.length < 128) {
        var ang = tower.angle;
        st.projectiles.push({ kind: 'dart', x: tower.x, y: tower.y - 12, vx: Math.cos(ang) * 560, vy: Math.sin(ang) * 560, life: 0.8, dmg: tower.dmg, source: tower });
        var prD = st.projectiles[st.projectiles.length - 1]; prD.ecsId = ecsAdd(st, 'projectile', { position: prD, velocity: prD, combat: prD, lifetime: prD, render: prD });
      }
      st.audio.shoot();
    }
  }
  function heroPowerMult(hero) { if (!hero) return 1; return 1 + ((hero.level || 1) - 1) * 0.08 + ((hero.xp || 0) / 4000); }
  /* ---- Engine systems (ECS queries over component tables) ---- */
  function MovementSystem(st, dt) {
    var balloons = ecsEntitiesOfKind(st, 'balloon');
    var wSlow = weatherSlowFactor(st);
    for (var i = 0; i < balloons.length; i++) {
      var b = balloons[i];
      if (b.dead) continue;
      var f = (st.time < b.slowUntil) ? b.slowF : 1;
      if (b.regen && !b.boss && b.layers < b.maxLayers) { b.regenT += dt; if (b.regenT >= 2) { b.regenT = 0; b.layers++; b.r = 11 + b.layers * 1.5; } }
      b.prevDist = b.dist;
      b.dist += b.speed * f * wSlow * dt;
      if (b.dist >= totalLen) {
        b.dead = true; b.leaked = true;
        var dmg = b.boss ? 25 : b.layers;
        st.lives -= dmg; addShake(st, 8); st.audio.leak();
        spawnParticle(st, W - 90, 400, '#7bdff2', 8, 90, 'splash');
        floater(st, W - 90, 400, '-' + dmg + ' HP', '#ff5a5a');
        if (st.lives <= 0) { st.lives = 0; st.lost = true; st.audio.over(); emitHud(st); }
        continue;
      }
      var pt = pointAt(b.dist);
      /* Batch 6: hazard slow + detour, wave-variant route offset.
       * The slow factor applies to the NEXT step's movement (f was
       * computed above from the previous position's slow); the
       * hazard entry below is evaluated at the new position so the
       * detour renders immediately. Detour direction uses the
       * balloon's travel direction (previous position -> new point). */
      var hz = hazardAt(pt[0], pt[1]);
      if (hz.factor < 1) {
        b.slowF = Math.min(b.slowF || 1, hz.factor); b.slowUntil = st.time + 0.25;
        if (!b.inHazard) {
          b.inHazard = true; st.hazardSlows++;
          st.reroutes++;
          b.detourUntil = st.time + 1.2;
          b.detourSign = ((b.ecsId || 0) % 2 === 0) ? 1 : -1;
        }
      } else b.inHazard = false;
      var px = b.x, py = b.y;
      var tx = pt[0] - (px == null ? pt[0] : px), ty = pt[1] - (py == null ? pt[1] : py);
      var tl = Math.hypot(tx, ty) || 1;
      var perX = -ty / tl, perY = tx / tl;
      var off = routeOffset(b.dist, st.wave) + ((st.time < (b.detourUntil || 0)) ? 14 * (b.detourSign || 1) : 0);
      b.ox = perX * off; b.oy = perY * off;
      b.x = pt[0] + b.ox; b.y = pt[1] + b.oy; b.wob += dt * 6;
    }
    rebuildGrid(st);
  }
  function SpikeSystem(st, dt) {
    for (var i = st.spikes.length - 1; i >= 0; i--) { var sp = st.spikes[i]; sp.life -= dt; if (sp.life <= 0 || sp.pops <= 0) { if (sp.ecsId) ecsRemove(st, sp.ecsId); st.spikes.splice(i, 1); } }
    for (i = 0; i < st.balloons.length; i++) { var bb = st.balloons[i]; if (bb.dead) continue; for (var si = 0; si < st.spikes.length; si++) { var spp = st.spikes[si]; if (dist(bb.x, bb.y, spp.x, spp.y) <= bb.r + 10) { damageBalloon(st, bb, spp.dmg, null); spp.pops--; if (spp.pops <= 0) break; } } }
  }
  function CombatSystem(st, dt) {
    var towers = ecsEntitiesOfKind(st, 'tower');
    for (var i = 0; i < towers.length; i++) {
      var t = towers[i];
      t.cd -= dt; if (t.flash > 0) t.flash -= dt;
      if (t.cd > 0) continue;
      if (t.kind === 'spikes') { fireTower(st, t, null); t.cd = t.rate; continue; }
      var target = pickTarget(st, t);
      if (target) { fireTower(st, t, target); t.cd = t.rate; }
    }
    if (st.heroPlaced && st.hero) {
      var h = st.hero;
      h.cd = (h.cd || 0) - dt;
      if (h.cd <= 0) {
        var gb = heroGearBonus(h);
        var fake = { x: h.x, y: h.y, range: (h.range || 150) + gb.range, kind: 'hero' };
        var ht = pickTarget(st, fake);
        if (ht) {
          var wasDead = !!ht.dead;
          var dmg = Math.max(1, Math.round((h.basePower || 16) / 8 * heroPowerMult(h)) + gb.dmg);
          damageBalloon(st, ht, dmg, null);
          if (!wasDead && ht.dead) { st.heroXp += 3; h.kills = (h.kills || 0) + 1; }
          addBeam(st, { x1: h.x, y1: h.y, x2: ht.x, y2: ht.y, life: 0.1, color: h.color || '#ffd166' });
          h.cd = 0.8;
        }
      }
    }
  }
  function ProjectileSystem(st, dt) {
    for (var i = st.projectiles.length - 1; i >= 0; i--) {
      var pr = st.projectiles[i];
      if (pr.kind === 'dart') {
        pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.life -= dt;
        var hit = null, near = nearby(st, pr.x, pr.y, 26);
        for (var j = 0; j < near.length; j++) { if (!near[j].dead && dist(pr.x, pr.y, near[j].x, near[j].y) <= near[j].r + 4) { hit = near[j]; break; } }
        if (hit) { damageBalloon(st, hit, pr.dmg, pr.source); if (pr.ecsId) ecsRemove(st, pr.ecsId); st.projectiles.splice(i, 1); continue; }
        if (pr.life <= 0 || pr.x < -20 || pr.x > W + 20 || pr.y < -20 || pr.y > H + 20) { if (pr.ecsId) ecsRemove(st, pr.ecsId); st.projectiles.splice(i, 1); }
      } else {
        pr.t += dt / pr.dur;
        if (pr.t >= 1) {
          splashDamage(st, pr.tx, pr.ty, pr.splash, pr.dmg, pr.source);
          addLight(st, pr.tx, pr.ty, pr.splash + 50, pr.kind === 'mortar' ? '#00f6ff' : '#ff9e00', 0.3, 1);
          if (pr.kind === 'mortar') addShake(st, 6);
          if (pr.ecsId) ecsRemove(st, pr.ecsId);
          st.projectiles.splice(i, 1);
        }
      }
    }
  }
  function FxSystem(st, dt) {
    var i;
    for (i = st.beams.length - 1; i >= 0; i--) { var bm = st.beams[i]; bm.life -= dt; if (bm.life <= 0) { if (bm.ecsId) ecsRemove(st, bm.ecsId); st.beams.splice(i, 1); } }
    for (i = st.floaters.length - 1; i >= 0; i--) { var fl = st.floaters[i]; fl.life -= dt; fl.vy = (fl.vy == null ? -70 : fl.vy) + 160 * dt; fl.y += fl.vy * dt; if (fl.life <= 0) { if (fl.ecsId) ecsRemove(st, fl.ecsId); st.floaters.splice(i, 1); } }
    for (i = st.particles.length - 1; i >= 0; i--) {
      var pa = st.particles[i]; pa.life -= dt;
      var grav = pa.kind === 'smoke' ? -30 : (pa.kind === 'splash' ? 320 : 260);
      pa.vy += grav * dt;
      pa.vx += st.windX * dt * (pa.kind === 'smoke' ? 1.6 : 0.4);
      pa.x += pa.vx * dt; pa.y += pa.vy * dt;
      var drag = pa.kind === 'smoke' ? 0.98 : 0.94; pa.vx *= drag; pa.vy *= drag;
      if (pa.kind === 'smoke' || pa.kind === 'ring') pa.size += (pa.grow || 20) * dt;
      if (pa.life <= 0) { if (pa.ecsId) ecsRemove(st, pa.ecsId); st.particles.splice(i, 1); }
    }
    for (i = st.lights.length - 1; i >= 0; i--) { var li = st.lights[i]; li.life -= dt; if (li.life <= 0) { if (li.ecsId) ecsRemove(st, li.ecsId); st.lights.splice(i, 1); } }
  }
  function stepPhysics(st, dt) {
    st.time += dt;
    st.windX = Math.sin(st.time * 0.4) * 14;
    /* Batch 6: hero commander patrol — the hero walks the spline
     * back and forth instead of standing at its placed spot. */
    if (st.heroPlaced && st.hero && st.hero.patrol) {
      st.hero.patrolDist = (st.hero.patrolDist || 0) + 42 * dt * (st.hero.patrolDir || 1);
      if (st.hero.patrolDist >= totalLen) { st.hero.patrolDist = totalLen; st.hero.patrolDir = -1; }
      if (st.hero.patrolDist <= 0) { st.hero.patrolDist = 0; st.hero.patrolDir = 1; }
      var hp = pointAt(st.hero.patrolDist); st.hero.x = hp[0]; st.hero.y = hp[1];
    }
    updateWeather(st, dt);
    if (st.heroCd > 0) st.heroCd -= dt;
    if (st.shake > 0) st.shake = Math.max(0, st.shake - dt * 18);
    // spawning
    if (st.spawnQueue.length) {
      st.spawnTimer -= dt;
      if (st.spawnTimer <= 0) { spawnBalloon(st, st.spawnQueue.shift()); st.spawnTimer = st.wave >= 20 ? 0.35 : 0.55; }
    }
    MovementSystem(st, dt);
    SpikeSystem(st, dt);
    CombatSystem(st, dt);
    ProjectileSystem(st, dt);
    FxSystem(st, dt);
    // hero levels up inside the run from hero XP (100 XP = +1 level)
    if (st.heroPlaced && st.hero) { var runLv = 1 + Math.floor(st.heroXp / 100); if (runLv > (st.hero.level || 1)) { st.hero.level = runLv; floater(st, st.hero.x, st.hero.y - 34, 'HERO LV ' + runLv + '!', '#ffd166'); st.audio.clear(); } }
    // cleanup + wave end
    for (var i = 0; i < st.balloons.length; i++) if (st.balloons[i].dead && st.balloons[i].ecsId) ecsRemove(st, st.balloons[i].ecsId);
    st.balloons = st.balloons.filter(function (b) { return !b.dead; });
    if (st.waveActive && !st.spawnQueue.length && !st.balloons.length && !st.lost) {
      st.waveActive = false; st.betweenWaves = true;
      var interest = Math.min(50, Math.floor(st.gold * 0.05));
      var bonus = 60 + st.wave * 8 + interest; st.gold += bonus; st.score += 50;
      st.audio.clear();
      floater(st, W / 2, 90, 'WAVE CLEAR  +' + bonus + 'g', '#3ddc5f');
      reportWave(st);
      if (st.wave >= 50 && !st.endless) { st.won = true; st.audio.clear(); }
      else if (st.autoStart) startWave(st);
      emitHud(st);
    }
    emitHudThrottled(st, dt);
  }
  function wavePreview(w) {
    var comp = waveComposition(w), counts = {};
    comp.forEach(function (t) { var name = t === -1 ? 'BOSS' : BALLOON_TYPES[t].name; counts[name] = (counts[name] || 0) + 1; });
    return Object.keys(counts).map(function (k) { return counts[k] + 'x ' + k; }).join(', ');
  }
  function emitHud(st) { if (st.opts.onHud) st.opts.onHud(getHud(st)); }
  var _hudAcc = 0;
  function emitHudThrottled(st, dt) { _hudAcc += dt; if (_hudAcc > 0.25) { _hudAcc = 0; emitHud(st); } }
  function getHud(st) {
    return { gold: st.gold, lives: st.lives, wave: st.wave, score: st.score, pops: st.pops, waveActive: st.waveActive, betweenWaves: st.betweenWaves, won: st.won, lost: st.lost, heroXp: st.heroXp, towers: st.towers.length, speed: st.speed, autoStart: st.autoStart, targeting: st.targeting, placing: st.placing, paused: st.paused, endless: st.endless, challenge: st.challenge, fps: st.fps, nextWave: wavePreview(st.wave + 1), spikes: st.spikes.length, heroLevel: (st.hero && st.hero.level) || 0, heroTier: heroAbilityTier(st.hero), heroKills: (st.hero && st.hero.kills) || 0, heroPatrol: !!(st.hero && st.hero.patrol), heroGear: (st.hero && st.hero.equipment) || null, weather: (st.weather && st.weather.kind) || 'clear', weatherLeft: st.weather ? Math.max(0, st.weather.until - st.time) : 0, reroutes: st.reroutes || 0, hazardSlows: st.hazardSlows || 0, particles: st.particles.length, lights: st.lights.length, gridCells: st.grid.size, gridQueries: st.gridQueries, ecsEntities: Object.keys(st.ecs.entities).length, assetsLoaded: AssetManager.loaded, assetsTotal: AssetManager.total, inspect: towerInspect(st, st.selected || st.hoverTower), ecsMode: 'tables', fpsTarget: st.fpsTarget, particleDensity: st.particleDensity, motionBlur: st.motionBlur, displayScale: st.displayScale };
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
  function drawBalloon(ctx, b, time, alpha) {
    var wob = Math.sin(b.wob) * 2.2;
    var rd = lerp(b.prevDist == null ? b.dist : b.prevDist, b.dist, alpha == null ? 1 : alpha);
    var rp = pointAt(rd);
    var x = rp[0] + (b.ox || 0), y = rp[1] + (b.oy || 0) + wob;
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
      if (b.shieldUntil && time < b.shieldUntil) { ctx.strokeStyle = '#00f6ff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(0, 0, 50, 32, 0, 0, TAU); ctx.stroke(); }
      ctx.restore(); return;
    }
    var t = b.type;
    var spr = SPRITES[b.sprite];
    if (spriteReady(spr)) {
      ctx.save(); ctx.translate(x, y);
      var sz = b.r * 2.8;
      ctx.drawImage(spr, -sz / 2, -sz / 2, sz, sz);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center'; ctx.fillText(String(b.layers), 0, -sz / 2 - 4);
      if (st_slow(b, time)) { ctx.strokeStyle = 'rgba(123,223,242,.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, sz / 2 + 3, 0, TAU); ctx.stroke(); }
      if (b.camo) { ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.font = 'bold 8px Arial'; ctx.fillText('CAMO', 0, sz / 2 + 10); }
      ctx.restore(); return;
    }
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
    var spr = SPRITES[TOWER_SPRITES[t.kind]];
    var evo = evolutionFor(t);
    if (spriteReady(spr)) {
      ctx.save(); ctx.translate(t.x, t.y);
      ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(3, 10, 18, 6, 0, 0, TAU); ctx.fill();
      var sz = t.level >= 5 ? 60 : t.level >= 4 ? 52 : 44;
      ctx.drawImage(spr, -sz / 2, -sz / 2, sz, sz);
      if (t.maxed) { ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 24, 0, TAU); ctx.stroke(); }
      if (evo) { ctx.strokeStyle = evo === 'Ascended' ? '#c792ea' : '#00f6ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 28, 0, TAU); ctx.stroke(); ctx.fillStyle = '#fff'; ctx.font = 'bold 9px Arial'; ctx.textAlign = 'center'; ctx.fillText(evo.toUpperCase(), 0, -30); }
      ctx.fillStyle = '#fff'; ctx.font = 'bold 10px Arial'; ctx.textAlign = 'center';
      for (var u = 0; u < t.level; u++) ctx.fillText('★', -12 + u * 12, 26);
      ctx.restore(); return;
    }
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
  function drawScene(ctx, st) {
    ctx.drawImage(st.bg, 0, 0);
    drawWater(ctx, st);
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
    for (var i = 0; i < st.balloons.length; i++) drawBalloon(ctx, st.balloons[i], st.time, st.alpha);
    for (i = 0; i < st.towers.length; i++) drawTower(ctx, st.towers[i], st.time);
    for (i = 0; i < st.spikes.length; i++) { var spk = st.spikes[i]; ctx.fillStyle = '#c9ced6'; ctx.beginPath(); ctx.moveTo(spk.x, spk.y - 6); ctx.lineTo(spk.x - 6, spk.y + 5); ctx.lineTo(spk.x + 6, spk.y + 5); ctx.closePath(); ctx.fill(); }
    if (st.heroPlaced && st.hero) {
      var h = st.hero;
      ctx.save(); ctx.translate(h.x, h.y);
      ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(2, 12, 18, 6, 0, 0, TAU); ctx.fill();
      var hspr = SPRITES[HERO_SPRITES[h.defId]];
      if (spriteReady(hspr)) { ctx.save(); ctx.beginPath(); ctx.arc(0, 0, 15, 0, TAU); ctx.clip(); ctx.drawImage(hspr, -15, -17, 30, 34); ctx.restore(); }
      else { ctx.fillStyle = h.color || '#ffd166'; ctx.beginPath(); ctx.arc(0, 0, 15, 0, TAU); ctx.fill(); }
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 15, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#111'; ctx.font = 'bold 13px Arial'; ctx.textAlign = 'center'; ctx.fillText('★', 0, 5);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 10px Arial'; ctx.fillText('Lv ' + (h.level || 1), 0, 30);
      if (h.patrol) { ctx.fillStyle = '#7bdff2'; ctx.font = 'bold 9px Arial'; ctx.fillText('PATROL', 0, 42); }
      ctx.restore();
    }
    // projectiles
    for (i = 0; i < st.projectiles.length; i++) {
      var pr = st.projectiles[i];
      if (pr.kind === 'dart') { ctx.save(); ctx.translate(pr.x, pr.y); ctx.rotate(Math.atan2(pr.vy, pr.vx)); if (st.motionBlur) { ctx.strokeStyle = 'rgba(255,232,163,.55)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-28, 0); ctx.lineTo(7, 0); ctx.stroke(); } ctx.fillStyle = '#ffe8a3'; ctx.fillRect(-7, -1.5, 14, 3); ctx.restore(); }
      else { var tt = Math.min(1, pr.t), mx = pr.x + (pr.tx - pr.x) * tt, my = pr.y + (pr.ty - pr.y) * tt - Math.sin(tt * Math.PI) * 70; ctx.fillStyle = pr.kind === 'mortar' ? '#00f6ff' : '#ff6b35'; ctx.beginPath(); ctx.arc(mx, my, pr.kind === 'mortar' ? 7 : 5, 0, TAU); ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.beginPath(); ctx.arc(pr.tx, pr.ty, 8, 0, TAU); ctx.stroke(); }
    }
    for (i = 0; i < st.beams.length; i++) { var bm = st.beams[i]; ctx.strokeStyle = bm.color; ctx.globalAlpha = Math.max(0, bm.life / 0.18); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(bm.x1, bm.y1); ctx.lineTo(bm.x2, bm.y2); ctx.stroke(); if (st.motionBlur) { ctx.globalAlpha = Math.max(0, bm.life / 0.18) * 0.35; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(bm.x1, bm.y1); ctx.lineTo(bm.x2, bm.y2); ctx.stroke(); } ctx.globalAlpha = 1; }
    for (i = 0; i < st.particles.length; i++) {
      var pa = st.particles[i];
      var paA = Math.max(0, pa.life / pa.max);
      if (pa.kind === 'ring') { ctx.globalAlpha = paA * 0.9; ctx.strokeStyle = pa.color; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(pa.x, pa.y, pa.size, 0, TAU); ctx.stroke(); }
      else if (pa.kind === 'smoke') { ctx.globalAlpha = paA * 0.35; ctx.fillStyle = pa.color; ctx.beginPath(); ctx.arc(pa.x, pa.y, pa.size, 0, TAU); ctx.fill(); }
      else { ctx.globalAlpha = paA; ctx.fillStyle = pa.color; ctx.beginPath(); ctx.arc(pa.x, pa.y, pa.size, 0, TAU); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
  }
  function drawOverlays(ctx, st) {
    if (st.weather && st.weather.kind !== 'clear') {
      ctx.fillStyle = st.weather.kind === 'storm' ? '#ffd166' : '#7bdff2'; ctx.font = 'bold 13px Arial'; ctx.textAlign = 'left';
      ctx.fillText((st.weather.kind === 'storm' ? '⛈ STORM ' : '❄ BLIZZARD ') + Math.ceil(Math.max(0, st.weather.until - st.time)) + 's', 12, 22);
    }
    for (var i = 0; i < st.floaters.length; i++) { var fl = st.floaters[i]; ctx.globalAlpha = Math.max(0, Math.min(1, fl.life / 0.3)); ctx.fillStyle = fl.color; ctx.font = 'bold ' + (fl.size || 16) + 'px Arial'; ctx.textAlign = 'center'; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 3; if (ctx.strokeText) ctx.strokeText(fl.text, fl.x, fl.y); ctx.fillText(fl.text, fl.x, fl.y); }
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
    if (st.paused) { ctx.fillStyle = 'rgba(5,8,20,.6)'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#fff'; ctx.font = 'bold 36px Arial'; ctx.textAlign = 'center'; ctx.fillText('PAUSED', W / 2, H / 2); ctx.font = '16px Arial'; ctx.fillText('Press P to resume', W / 2, H / 2 + 30); }
  }
  /* ---- Post-processing pipeline (Pillar 1) ---- */
  function drawWater(ctx, st) {
    ctx.save(); ctx.beginPath(); ctx.ellipse(128, 492, 86, 44, 0, 0, TAU); ctx.clip();
    var t = st.time;
    for (var i = 0; i < 3; i++) {
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.18 + i * 0.08) + ')'; ctx.lineWidth = 2;
      ctx.beginPath();
      for (var x = 50; x <= 210; x += 8) { var y = 492 + Math.sin(x * 0.09 + t * 2.2 + i * 1.7) * (5 + i * 3) + (i - 1) * 14; if (x === 50) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.stroke();
    }
    var gx = 128 + Math.sin(t * 0.7) * 52;
    ctx.fillStyle = 'rgba(255,255,240,.5)'; ctx.beginPath(); ctx.ellipse(gx, 482, 20, 6, -0.3, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 2;
    if (ctx.setLineDash) ctx.setLineDash([10, 8]);
    ctx.lineDashOffset = -t * 18; ctx.beginPath(); ctx.ellipse(128, 492, 86, 44, 0, 0, TAU); ctx.stroke();
    if (ctx.setLineDash) ctx.setLineDash([]);
    ctx.restore();
  }
  function drawLighting(ctx, st) {
    if (st.quality !== 'high') return;
    ctx.save();
    ctx.fillStyle = 'rgba(4,6,18,.30)'; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'destination-out';
    var punch = function (x, y, r, a) { var g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(0,0,0,' + a + ')'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); };
    var i, l;
    for (i = 0; i < st.lights.length; i++) { l = st.lights[i]; punch(l.x, l.y, l.radius, 0.85 * l.intensity * (l.life / l.max)); }
    punch(W / 2, H / 2, 420, 0.35);
    if (st.heroPlaced && st.hero) punch(st.hero.x, st.hero.y, 110, 0.7);
    ctx.globalCompositeOperation = 'lighter';
    for (i = 0; i < st.lights.length; i++) { l = st.lights[i]; var g2 = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.radius); g2.addColorStop(0, l.color); g2.addColorStop(1, 'rgba(0,0,0,0)'); ctx.globalAlpha = 0.35 * (l.life / l.max) * l.intensity; ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(l.x, l.y, l.radius, 0, TAU); ctx.fill(); }
    ctx.restore(); ctx.globalAlpha = 1;
  }
  function drawGlow(ctx, st) {
    if (st.quality !== 'high' || !st.glowCtx) return;
    var g = st.glowCtx, i;
    g.save(); g.clearRect(0, 0, 480, 300); g.scale(0.5, 0.5);
    for (i = 0; i < st.beams.length; i++) { var bm = st.beams[i]; g.strokeStyle = bm.color; g.globalAlpha = Math.max(0, bm.life / 0.18); g.lineWidth = 7; g.beginPath(); g.moveTo(bm.x1, bm.y1); g.lineTo(bm.x2, bm.y2); g.stroke(); }
    for (i = 0; i < st.lights.length; i++) { var l = st.lights[i]; var gr = g.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.radius); gr.addColorStop(0, l.color); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.globalAlpha = 0.5 * (l.life / l.max); g.fillStyle = gr; g.beginPath(); g.arc(l.x, l.y, l.radius, 0, TAU); g.fill(); }
    for (i = 0; i < st.particles.length; i++) { var pa = st.particles[i]; if (pa.kind !== 'ring') continue; g.strokeStyle = pa.color; g.globalAlpha = Math.max(0, pa.life / pa.max) * 0.8; g.lineWidth = 4; g.beginPath(); g.arc(pa.x, pa.y, pa.size, 0, TAU); g.stroke(); }
    g.restore(); g.globalAlpha = 1;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.6; ctx.drawImage(st.glowCv, 0, 0, W, H); ctx.drawImage(st.glowCv, -3, -2, W, H); ctx.restore(); ctx.globalAlpha = 1;
  }
  function drawVignette(ctx, st) {
    if (!st.vigCv) return;
    ctx.drawImage(st.vigCv, 0, 0);
    if (st.lives <= 20 && !st.won && !st.lost && st.lives > 0) {
      var a = 0.18 + 0.14 * Math.sin(st.time * 4);
      var g = ctx.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.72);
      g.addColorStop(0, 'rgba(255,30,30,0)'); g.addColorStop(1, 'rgba(255,30,30,' + a + ')');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
  }
  function draw(st) {
    var useFx = st.quality === 'high' && st.postfx;
    var ctx = st.ctx;
    var sceneCtx = ctx, sceneCv = null;
    if (useFx && st.sceneCtx) { sceneCv = st.sceneCv; sceneCtx = st.sceneCtx; }
    sceneCtx.save();
    if (st.shake > 0 && st.shakeOn) sceneCtx.translate((Math.random() - 0.5) * st.shake, (Math.random() - 0.5) * st.shake);
    drawScene(sceneCtx, st);
    if (sceneCv) { drawGlow(sceneCtx, st); drawLighting(sceneCtx, st); }
    sceneCtx.restore();
    if (sceneCv) {
      ctx.save(); ctx.drawImage(sceneCv, 0, 0);
      if (st.dof && st.blurCtx) {
        var b = st.blurCtx;
        b.save(); b.clearRect(0, 0, 240, 150);
        try { b.filter = 'blur(2px)'; } catch (e) {}
        b.drawImage(sceneCv, 0, 0, 240, 150);
        try { b.filter = 'none'; } catch (e) {}
        b.restore();
        ctx.drawImage(st.blurCv, 0, 0, 240, 30, 0, 0, W, 118);
        ctx.drawImage(st.blurCv, 0, 120, 240, 30, 0, H - 118, W, 118);
        var fg = ctx.createLinearGradient(0, 118, 0, 176); fg.addColorStop(0, 'rgba(0,0,0,.28)'); fg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = fg; ctx.fillRect(0, 118, W, 58);
        var fg2 = ctx.createLinearGradient(0, H - 176, 0, H - 118); fg2.addColorStop(0, 'rgba(0,0,0,0)'); fg2.addColorStop(1, 'rgba(0,0,0,.28)');
        ctx.fillStyle = fg2; ctx.fillRect(0, H - 176, W, 58);
      }
      ctx.restore();
    }
    drawVignette(ctx, st);
    drawOverlays(ctx, st);
  }
  /* ---- Input + lifecycle ---- */
  var STEP = 1 / 60;
  /* Retina/HiDPI display scaling: raise the canvas backing store while
   * keeping the 960x600 logical coordinate space. Guarded for the VM
   * harness, whose stub context has no setTransform. */
  function applyDisplayScale(st) {
    var f = st.displayScale === 'auto' ? (typeof devicePixelRatio !== 'undefined' ? Math.min(2, devicePixelRatio || 1) : 1) : (parseFloat(st.displayScale) || 1);
    f = Math.min(2, Math.max(1, f));
    if (st.canvas) { st.canvas.width = Math.round(W * f); st.canvas.height = Math.round(H * f); }
    if (st.ctx && st.ctx.setTransform) st.ctx.setTransform(f, 0, 0, f, 0, 0);
  }
  function loop(st, now) {
    if (st.destroyed) return;
    st.rafId = (typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame(function (t) { loop(st, t); }) : setTimeout(function () { loop(st, Date.now()); }, 16));
    /* FPS target pacing: below 60, skip frames so physics+draw run at
     * the target rate (rAF is already scheduled above, so the queue
     * keeps flowing). 120 is a cap only — the display refresh limits it. */
    if (st.fpsTarget && st.fpsTarget < 60 && st._lastFrameT && (now - st._lastFrameT) < (1000 / st.fpsTarget - 1)) return;
    st._lastFrameT = now;
    var dt = 0.016;
    if (st.lastT) dt = Math.min(0.1, Math.max(0, (now - st.lastT) / 1000));
    st.lastT = now;
    st._fpsN++; st._fpsT += dt; if (st._fpsT >= 0.5) { st.fps = Math.round(st._fpsN / st._fpsT); st._fpsN = 0; st._fpsT = 0; }
    if (st.running && !st.paused && !st.won && !st.lost) {
      st.acc += dt * st.speed;
      var steps = 0;
      while (st.acc >= STEP && steps < 5) { stepPhysics(st, STEP); st.acc -= STEP; steps++; }
      if (steps === 5) st.acc = 0; // drop backlog: never spiral
      st.alpha = clamp(st.acc / STEP, 0, 1);
    } else { st.alpha = 1; st.acc = 0; }
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
    st.towers.push({ kind: st.placing, x: x, y: y, range: def.range, rate: def.rate, dmg: def.dmg, color: def.color, cd: 0, angle: 0, flash: 0, level: 1, canSeeCamo: !!def.camo, maxed: false, branch: null, paths: { speed: 0, power: 0 }, splashBonus: 0, evolved: false });
    var tw0 = st.towers[st.towers.length - 1]; tw0.ecsId = ecsAdd(st, 'tower', { position: tw0, combat: tw0, render: tw0 });
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
    applyDisplayScale(st);
    var mkCv = function (w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    st.glowCv = mkCv(480, 300); st.glowCtx = st.glowCv.getContext('2d');
    st.sceneCv = mkCv(W, H); st.sceneCtx = st.sceneCv.getContext('2d');
    st.blurCv = mkCv(240, 150); st.blurCtx = st.blurCv.getContext('2d');
    st.vigCv = mkCv(W, H);
    var vg = st.vigCv.getContext('2d');
    var vgr = vg.createRadialGradient(W / 2, H / 2, H * 0.34, W / 2, H / 2, H * 0.75);
    vgr.addColorStop(0, 'rgba(0,0,0,0)'); vgr.addColorStop(1, 'rgba(0,0,0,.38)');
    vg.fillStyle = vgr; vg.fillRect(0, 0, W, H);
    st.bg = paintBackground();
    loadSprites(function () { st.bg = paintBackground(); });
    if (opts.hero) { st.hero = opts.hero; }
    if (opts.bus) opts.bus.emit('game:start', 'cosmos-btd', opts.hero ? [opts.hero.id] : []);
    var onMove = function (ev) {
      var pos = canvasPos(st, ev); st.mouse = pos;
      var prevHover = st.hoverTower; st.hoverTower = null;
      if (!st.placing) for (var i = 0; i < st.towers.length; i++) if (dist(pos.x, pos.y, st.towers[i].x, st.towers[i].y) < 22) { st.hoverTower = st.towers[i]; break; }
      if (st.hoverTower !== prevHover) emitHud(st);
    };
    var onClick = function (ev) {
      st.audio.unlock();
      var pos = canvasPos(st, ev);
      if (st.placing) { tryPlace(st, pos.x, pos.y); return; }
      if (st.hero && !st.heroPlaced) {
        if (distToPath(pos.x, pos.y) <= 34) { if (opts.onToast) opts.onToast('Hero cannot stand on the path.', 'warn'); return; }
        st.heroPlaced = true; st.hero.x = pos.x; st.hero.y = pos.y; st.hero.range = 150; st.hero.cd = 0;
        st.hero.patrol = !!st.hero.patrol; st.hero.patrolDist = 0; st.hero.patrolDir = 1; st.hero.kills = st.hero.kills || 0;
        st.hero.equipment = st.hero.equipment || { weapon: null, charm: null };
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
      else if (ev.key === 'p' || ev.key === 'P') { st.paused = !st.paused; emitHud(st); }
      else if (ev.key >= '1' && ev.key <= '7') { var kinds = Object.keys(TOWER_DEFS); setPlacing(st, kinds[Number(ev.key) - 1]); }
    };
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('click', onClick);
    var onTouch = function (ev) { if (ev.touches && ev.touches[0]) { if (ev.preventDefault) ev.preventDefault(); var tt = ev.touches[0]; onClick({ clientX: tt.clientX, clientY: tt.clientY }); } };
    canvas.addEventListener('touchstart', onTouch);
    document.addEventListener('keydown', onKey);
    st._listeners = { onMove: onMove, onClick: onClick, onKey: onKey, onTouch: onTouch };
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
      setPaused: function (v) { st.paused = !!v; emitHud(st); },
      setEndless: function (v) { st.endless = !!v; emitHud(st); },
      setChallenge: function (v) { st.challenge = !!v; if (st.challenge && st.wave === 0 && !st.waveActive) { st.gold = 100; st.lives = 20; } emitHud(st); },
      setQuality: function (q) { st.quality = q === 'low' ? 'low' : 'high'; },
      setPostFx: function (v) { st.postfx = v !== false; },
      setDof: function (v) { st.dof = v !== false; },
      setFpsTarget: function (v) { st.fpsTarget = [30, 60, 120].indexOf(Number(v)) >= 0 ? Number(v) : 60; },
      setParticleDensity: function (v) { st.particleDensity = ['low', 'med', 'high'].indexOf(v) >= 0 ? v : 'high'; },
      setMotionBlur: function (v) { st.motionBlur = v !== false; },
      setDisplayScale: function (v) { st.displayScale = ['auto', '1', '1.5', '2'].indexOf(String(v)) >= 0 ? String(v) : 'auto'; applyDisplayScale(st); },
      setVolume: function (v) { if (st.audio && st.audio.setVolume) st.audio.setVolume(v); },
      upgradeSelected: function () { return upgradeSelected(st); },
      upgradeBranch: function (branch) { return upgradeBranchSelected(st, branch); },
      sellSelected: function () { return sellSelected(st); },
      heroAbility: function () { return heroAbility(st); },
      setHeroPatrol: function (v) { if (st.hero) st.hero.patrol = !!v; emitHud(st); },
      equipHero: function (itemId) { return equipHero(st, itemId); },
      setWeather: function (kind, seconds) { return setWeather(st, kind, seconds); },
      getState: function () { return { gold: st.gold, lives: st.lives, wave: st.wave, score: st.score, pops: st.pops, heroXp: st.heroXp, towers: st.towers.length, spikes: st.spikes.length, endless: st.endless, paused: st.paused, won: st.won, lost: st.lost, sessionId: st.sessionId, weather: (st.weather && st.weather.kind) || 'clear', heroTier: heroAbilityTier(st.hero), heroKills: (st.hero && st.hero.kills) || 0, reroutes: st.reroutes || 0, hazardSlows: st.hazardSlows || 0 }; },
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
    var t = st.selected; if (!t || t.level >= 5) return false;
    var cost = 80 + t.level * 60;
    if (st.gold < cost) { if (st.opts.onToast) st.opts.onToast('Upgrade costs ' + cost + 'g.', 'warn'); return false; }
    st.gold -= cost; t.level++;
    t.evolved = t.level >= 4;
    if (t.level >= 5) { t.dmg += 2; t.range += 15; t.rate = Math.max(0.22, t.rate * 0.85); t.maxed = true; }
    else { t.dmg += 1; t.range += 10; t.rate = Math.max(0.25, t.rate * 0.9); }
    st.audio.coin(); emitHud(st); return true;
  }
  function sellSelected(st) {
    var t = st.selected; if (!t) return false;
    var def = TOWER_DEFS[t.kind];
    st.gold += Math.floor(def.cost * 0.7);
    if (t.ecsId) ecsRemove(st, t.ecsId);
    st.towers.splice(st.towers.indexOf(t), 1); st.selected = null; emitHud(st); return true;
  }
  function equipHero(st, itemId) {
    var h = st.hero; if (!h) return false;
    var g = HERO_GEAR[itemId]; if (!g) return false;
    h.equipment = h.equipment || { weapon: null, charm: null };
    h.equipment[g.slot] = itemId;
    emitHud(st); return true;
  }
  function heroAbility(st) {
    if (!st.heroPlaced || !st.hero) { if (st.opts.onToast) st.opts.onToast('Place your hero first (click the board).', 'warn'); return false; }
    if (st.heroCd > 0) { if (st.opts.onToast) st.opts.onToast('Hero ability recharging: ' + Math.ceil(st.heroCd) + 's.', 'warn'); return false; }
    var h = st.hero;
    var tier = heroAbilityTier(h);
    st.heroCd = tier >= 3 ? 7 : tier >= 2 ? 9 : 12;
    if (h.id === 'astra') { splashDamage(st, h.x, h.y, 170, 4 + 2 * tier, null); floater(st, h.x, h.y - 30, 'NOVA BURST T' + tier + '!', '#ffd166'); }
    else if (h.id === 'lyra') { var near = nearby(st, h.x, h.y, 190); for (var i = 0; i < near.length; i++) { near[i].slowUntil = st.time + 2 + tier; near[i].slowF = 0.35; } floater(st, h.x, h.y - 30, 'ION SLOW T' + tier + '!', '#7bdff2'); }
    else if (h.id === 'koda') { st.lives = Math.min(100, st.lives + 10 * tier); floater(st, h.x, h.y - 30, '+' + (10 * tier) + ' SHIELD', '#90ee90'); }
    else if (h.id === 'nova7') { var fake = { x: h.x, y: h.y, range: 999, kind: 'hero' }; var tgt = pickTarget(st, fake); if (tgt) { damageBalloon(st, tgt, 6 + 4 * tier, null); addBeam(st, { x1: h.x, y1: h.y, x2: tgt.x, y2: tgt.y, life: 0.2, color: '#ff8fab' }); } floater(st, h.x, h.y - 30, 'RAIL SHOT T' + tier + '!', '#ff8fab'); }
    else if (h.id === 'vex') { var bosses = st.balloons.filter(function (b) { return b.boss; }); for (i = 0; i < bosses.length; i++) damageBalloon(st, bosses[i], 4 + 4 * tier, null); floater(st, h.x, h.y - 30, 'VOID STRIKE T' + tier + '!', '#c792ea'); }
    else { for (i = 0; i < st.towers.length; i++) { var tw = st.towers[i]; if (dist(tw.x, tw.y, h.x, h.y) < 180) tw.dmg += 1; } floater(st, h.x, h.y - 30, 'KEEPER AURA T' + tier + '!', '#e0e0e0'); }
    st.audio.clear(); emitHud(st); return true;
  }
  function reset(st) {
    var keep = { gold: 650, lives: 100, wave: 0, score: 0, pops: 0, heroXp: 0 };
    st.gold = st.challenge ? 100 : keep.gold; st.lives = st.challenge ? 20 : keep.lives; st.wave = keep.wave; st.score = keep.score; st.pops = keep.pops; st.heroXp = keep.heroXp;
    st.balloons = []; st.towers = []; st.projectiles = []; st.beams = []; st.floaters = []; st.particles = []; st.spikes = []; st.lights = []; st.ecs = createECS(); st.acc = 0; st.alpha = 1; st.paused = false;
    st.spawnQueue = []; st.waveActive = false; st.betweenWaves = true; st.won = false; st.lost = false; st.heroPlaced = false; st.selected = null; st.hoverTower = null; st.placing = null;
    st.weather = { kind: 'clear', until: 0, strikeT: 0 }; st.reroutes = 0; st.hazardSlows = 0;
    if (st.hero) { st.hero.patrol = false; st.hero.patrolDist = 0; st.hero.patrolDir = 1; st.hero.kills = 0; }
    emitHud(st);
  }
  function destroy(st) {
    st.destroyed = true; st.running = false;
    if (typeof cancelAnimationFrame !== 'undefined') { try { cancelAnimationFrame(st.rafId); } catch (e) {} }
    else { try { clearTimeout(st.rafId); } catch (e) {} }
    if (st.canvas && st._listeners) { st.canvas.removeEventListener('mousemove', st._listeners.onMove); st.canvas.removeEventListener('click', st._listeners.onClick); st.canvas.removeEventListener('touchstart', st._listeners.onTouch); }
    if (st._listeners) document.removeEventListener('keydown', st._listeners.onKey);
    if (st.audio) st.audio.close();
    st.glowCv = st.sceneCv = st.blurCv = st.vigCv = null; st.glowCtx = st.sceneCtx = st.blurCtx = null;
    if (st.opts.bus) st.opts.bus.emit('game:ended', 'cosmos-btd', { score: st.score, wave: st.wave });
  }

  var manifest = { id: 'cosmos-btd', name: 'Cosmos BTD', version: '3.3.0', description: 'Bloons-style tower defense: 50 waves + endless, 7 towers, camo/fortified/regen enemies, heroes, image sprites, ECS + spatial hash, fixed 60Hz timestep, bloom/lighting/vignette/tilt-shift/water post-processing, particle engine, Pillar 3 UI: floating combat text, inspection stat cards, settings (FPS/particles/motion blur/HiDPI), ECS-table iteration. Pillar 4: branching tower upgrade trees with Lv4/Lv5 evolutions, hero commander patrol/gear/ability tiers, hazard detours + wave-variant routing on the spline, storm/blizzard weather.', entry: 'btd.js', canvas: true, maxWaves: 50 };

  global.CosmosBTD = { manifest: manifest, init: init, TOWER_DEFS: TOWER_DEFS, BALLOON_TYPES: BALLOON_TYPES, _createState: createState, AssetManager: AssetManager, createECS: createECS, _ecsEntitiesOfKind: ecsEntitiesOfKind, _towerInspect: towerInspect, BRANCH_DEFS: BRANCH_DEFS, HERO_GEAR: HERO_GEAR, HAZARDS: HAZARDS, _hazardAt: hazardAt, _routeOffset: routeOffset, _heroAbilityTier: heroAbilityTier, _heroGearBonus: heroGearBonus, _weatherSlowFactor: weatherSlowFactor };
})(typeof window !== 'undefined' ? window : globalThis);

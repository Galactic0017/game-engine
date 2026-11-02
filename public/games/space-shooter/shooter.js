/* Space Shooter — arcade game module for the GAME Engine Hub.
 *
 * Implements the IGameModule lifecycle the EngineHost requires:
 *   init(viewport, {bus, wallet, config, hero, player, onHud, onToast})
 *   destroy(), setHero(hero), getState(), getHud(), pause(), resume()
 *
 * Rendering is 100% procedural Canvas 2D: no image files, so nothing can
 * break if an asset is missing. The starfield background is pre-rendered
 * once to an offscreen canvas. The ship moves with Arrow keys / WASD,
 * aims at the mouse, and auto-fires while the mouse or Space is held.
 * Asteroids drift down and split when shot; enemy drones weave and shoot
 * back. Waves get harder; clearing a wave pays a bonus. Drones drop
 * power-ups (shield / rapid fire / spread shot / extra life). Every 5th
 * wave is a boss-drone wave with a health bar. Kills without taking a
 * hit build a combo multiplier (up to x3). Touch devices get a virtual
 * joystick (left half) + fire button (right half) drawn on the canvas.
 * The equipped hero (if any) boosts fire rate slightly and is otherwise
 * cosmetic. On game over the module emits game:ended with final:true so
 * the shell can record the score on the server shooter leaderboard.
 *
 * This module never talks to a wallet, a server, or the DOM outside its
 * viewport. All cross-module communication goes through the event bus
 * and the onHud/onToast callbacks.
 */
(function (global) {
  'use strict';

  var W = 960, H = 600, TAU = Math.PI * 2;
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var dist = function (x1, y1, x2, y2) { return Math.hypot(x2 - x1, y2 - y1); };
  var seed = 135791113;
  function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }

  /* ---- Background: pre-rendered once ---- */
  function paintBackground() {
    var bg = document.createElement('canvas'); bg.width = W; bg.height = H;
    var b = bg.getContext('2d');
    var g = b.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#050814'); g.addColorStop(0.55, '#0a1030'); g.addColorStop(1, '#120a2e');
    b.fillStyle = g; b.fillRect(0, 0, W, H);
    // nebulas
    var nebs = [['#50259c', 200, 130, 190], ['#00f6ff', 760, 420, 170], ['#ff8fab', 520, 260, 130]];
    for (var i = 0; i < nebs.length; i++) {
      var n = nebs[i];
      var rg = b.createRadialGradient(n[1], n[2], 10, n[1], n[2], n[3]);
      rg.addColorStop(0, n[0]); rg.addColorStop(1, 'rgba(0,0,0,0)');
      b.globalAlpha = 0.22; b.fillStyle = rg;
      b.beginPath(); b.arc(n[1], n[2], n[3], 0, TAU); b.fill();
    }
    b.globalAlpha = 1;
    for (i = 0; i < 320; i++) {
      var sx = rnd() * W, sy = rnd() * H, sr = 0.6 + rnd() * 1.7;
      b.fillStyle = rnd() > 0.85 ? '#ffd166' : 'rgba(255,255,255,' + (0.35 + rnd() * 0.6) + ')';
      b.beginPath(); b.arc(sx, sy, sr, 0, TAU); b.fill();
    }
    // distant planet
    var pg = b.createRadialGradient(830, 90, 8, 830, 90, 54);
    pg.addColorStop(0, '#8ecbff'); pg.addColorStop(0.6, '#3b5fd9'); pg.addColorStop(1, '#1b2a6e');
    b.fillStyle = pg; b.beginPath(); b.arc(830, 90, 48, 0, TAU); b.fill();
    b.strokeStyle = 'rgba(255,255,255,.35)'; b.lineWidth = 2;
    b.beginPath(); b.ellipse(830, 90, 74, 16, -0.35, 0, TAU); b.stroke();
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
      var t = ac.currentTime + (when || 0), o = ac.createOscillator(), gn = ac.createGain();
      o.type = type || 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
      gn.gain.setValueAtTime(vol || 0.12, t); gn.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(gn); gn.connect(ac.destination); o.start(t); o.stop(t + dur + 0.02);
    }
    function noise(dur, vol, fc) {
      var ac = audio(); if (!ac) return;
      var n = Math.floor(ac.sampleRate * dur), buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      var s = ac.createBufferSource(); s.buffer = buf;
      var f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = fc || 900;
      var gn = ac.createGain(); gn.gain.value = vol || 0.2;
      s.connect(f); f.connect(gn); gn.connect(ac.destination); s.start();
    }
    return {
      unlock: function () { audio(); },
      mute: function () { muted = true; },
      close: function () { muted = true; try { if (AC) AC.close(); } catch (e) {} AC = null; },
      shoot: function () { tone(980, 320, 0.07, 'square', 0.045); },
      boom: function () { noise(0.22, 0.26, 700); tone(160, 50, 0.2, 'sine', 0.2); },
      hit: function () { noise(0.3, 0.3, 420); tone(220, 70, 0.3, 'sawtooth', 0.16); },
      power: function () { tone(660, 660, 0.08, 'sine', 0.1); tone(990, 990, 0.1, 'sine', 0.1, 0.07); },
      clear: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, f, 0.14, 'triangle', 0.1, i * 0.09); }); },
      over: function () { [400, 320, 240, 160].forEach(function (f, i) { tone(f, f, 0.22, 'sawtooth', 0.11, i * 0.14); }); }
    };
  }

  /* ---- Engine state ---- */
  function createState(opts) {
    return {
      opts: opts || {},
      canvas: null, ctx: null, bg: null,
      running: false, paused: false, destroyed: false, rafId: 0, lastT: 0, time: 0,
      ship: { x: W / 2, y: H - 70, vx: 0, vy: 0, angle: -Math.PI / 2, r: 16, invuln: 0, thrust: 0 },
      keys: {}, mouse: { x: W / 2, y: H / 2, down: false },
      firing: false, fireCd: 0,
      bullets: [], bolts: [], asteroids: [], drones: [], bosses: [], powerups: [],
      particles: [], floaters: [], stars: [],
      spawnQueue: [], spawnTimer: 0, betweenWaves: false, waveTimer: 0,
      score: 0, wave: 0, bestWave: 0, lives: 3, shotsFired: 0, kills: 0, grazes: 0, bossesDefeated: 0,
      gameOver: false, shake: 0, rapidUntil: 0, spreadUntil: 0, shield: false,
      fps: 0, fpsTarget: 60, _fpsN: 0, _fpsT: 0, _dynFactor: 1,
      combo: 0, comboMult: 1, bestCombo: 0,
      powerupCounts: { shield: 0, rapid: 0, spread: 0, life: 0 },
      touch: { joyId: null, fireId: null, joyOX: 0, joyOY: 0, dx: 0, dy: 0, seen: false },
      hero: null, sessionId: null, sessionNonce: null,
      audio: makeAudio()
    };
  }
  /* Batch 15: dynamic quality — particle cap follows measured FPS.
   * Same mapping as BTD (1 / 0.6 / 0.35 with step-up hysteresis). */
  function dynFactorFor(fps, fpsTarget) {
    if (!fps || fps <= 0) return 1;
    var ratio = fps / (fpsTarget || 60);
    return ratio >= 0.9 ? 1 : ratio >= 0.6 ? 0.6 : 0.35;
  }
  function particleCapFor(fps, fpsTarget, baseCap) {
    return Math.max(40, Math.round(baseCap * dynFactorFor(fps, fpsTarget)));
  }
  function updateDynFactor(st) {
    var nf = dynFactorFor(st.fps, st.fpsTarget);
    var cur = st._dynFactor || 1;
    if (nf < cur) st._dynFactor = nf;
    else if (nf > cur && st.fps >= 0.95 * (st.fpsTarget || 60)) st._dynFactor = nf;
    return st._dynFactor;
  }
  function spawnParticle(st, x, y, color, n, speed) {
    var cap = Math.max(40, Math.round(400 * (st._dynFactor || 1)));
    for (var i = 0; i < (n || 8); i++) {
      if (st.particles.length > cap) st.particles.shift();
      var a = Math.random() * TAU, s = (speed || 90) * (0.4 + Math.random() * 0.9);
      st.particles.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.35 + Math.random() * 0.35, max: 0.7, color: color, size: 2 + Math.random() * 3 });
    }
  }
  function floater(st, x, y, text, color, opts) { opts = opts || {}; st.floaters.push({ x: x, y: y, text: text, color: color || '#ffd166', life: 0.9, vy: -70, size: (opts.kind === 'crit' ? 22 : 16), kind: opts.kind || 'info' }); }
  function fireInterval(st) {
    var base = 0.16;
    if (st.time < st.rapidUntil) base = 0.08;
    if (st.hero) base *= 0.85;
    return base;
  }
  /* Combo: +1 per bullet kill; every 5 combo adds +0.5x, capped at x3.
   * A real hit (life lost) resets it; a shield block preserves it. */
  function comboMultiplier(combo) { return 1 + Math.min(4, Math.floor(combo / 5)) * 0.5; }
  function addKillScore(st, base, counted, x, y) {
    var gain = base;
    if (counted) {
      st.combo++;
      st.bestCombo = Math.max(st.bestCombo, st.combo);
      st.comboMult = comboMultiplier(st.combo);
      gain = Math.round(base * st.comboMult);
    }
    st.score += gain;
    floater(st, x, y, '+' + gain + (counted && st.comboMult > 1 ? '  x' + st.comboMult.toFixed(1) : ''), '#ffd166');
    return gain;
  }
  function makePowerup(st, x, y) {
    var r = Math.random(), kind;
    if (r < 0.3) kind = 'shield';
    else if (r < 0.6) kind = 'rapid';
    else if (r < 0.9) kind = 'spread';
    else kind = st.lives < 5 ? 'life' : 'rapid';
    return { kind: kind, x: x, y: y, vy: 60, r: 13, life: 8, dead: false };
  }
  function makeBoss(st) {
    var hp = 20 + st.wave * 2;
    return { kind: 'boss', x: W / 2, y: 70, baseX: W / 2, r: 44, hp: hp, maxHp: hp, t: 0, vy: 14, fireCd: 1.5, dead: false };
  }
  function makeAsteroid(st, x, y, size) {
    var verts = [], n = 9 + Math.floor(Math.random() * 3);
    for (var i = 0; i < n; i++) verts.push(0.72 + Math.random() * 0.45);
    var r = size === 'large' ? 42 : size === 'medium' ? 27 : 16;
    var hp = size === 'large' ? 3 : size === 'medium' ? 2 : 1;
    return {
      kind: 'asteroid', size: size, x: x, y: y,
      vx: (Math.random() - 0.5) * 50, vy: (42 + Math.random() * 30) * (1 + st.wave * 0.03),
      r: r, hp: hp, maxHp: hp, rot: Math.random() * TAU, rotSpd: (Math.random() - 0.5) * 1.6,
      verts: verts, dead: false, grazed: false
    };
  }
  function makeDrone(st, x, y) {
    return {
      kind: 'drone', x: x, y: y, baseX: x, r: 20, hp: 2, maxHp: 2,
      t: Math.random() * TAU, vy: 34 + st.wave * 2, fireCd: 1 + Math.random(),
      dead: false
    };
  }
  function startWave(st) {
    st.wave++;
    /* Batch 23: best wave — highest wave reached in this run. */
    if (st.wave > (st.bestWave || 0)) st.bestWave = st.wave;
    var n = st.wave;
    st.spawnQueue = [];
    var aCount = 6 + n * 3, dCount = n >= 2 ? Math.min(8, n) : 0, i;
    for (i = 0; i < aCount; i++) st.spawnQueue.push('asteroid');
    for (i = 0; i < dCount; i++) st.spawnQueue.push('drone');
    // Shuffle so drones are mixed in with the asteroids.
    for (i = st.spawnQueue.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1)), tmp = st.spawnQueue[i];
      st.spawnQueue[i] = st.spawnQueue[j]; st.spawnQueue[j] = tmp;
    }
    if (st.wave % 5 === 0) st.spawnQueue.unshift('boss');
    st.spawnTimer = 0.5;
    st.betweenWaves = false;
    floater(st, W / 2, 60, st.wave % 5 === 0 ? 'BOSS WAVE ' + st.wave : 'WAVE ' + st.wave, '#ff5a5a');
    emitHud(st);
  }
  function spawnNext(st) {
    var kind = st.spawnQueue.shift();
    if (kind === 'boss') {
      st.bosses.push(makeBoss(st));
    } else if (kind === 'drone') {
      st.drones.push(makeDrone(st, 60 + Math.random() * (W - 120), -30));
    } else {
      var size = Math.random() < 0.45 ? 'large' : Math.random() < 0.7 ? 'medium' : 'small';
      st.asteroids.push(makeAsteroid(st, 30 + Math.random() * (W - 60), -50, size));
    }
  }
  function damageShip(st) {
    if (st.ship.invuln > 0 || st.gameOver) return;
    if (st.shield) {
      st.shield = false;
      st.ship.invuln = 0.75;
      spawnParticle(st, st.ship.x, st.ship.y, '#00f6ff', 18, 150);
      floater(st, st.ship.x, st.ship.y - 30, 'SHIELD BLOCK!', '#00f6ff');
      st.audio.hit();
      emitHud(st);
      return; // shield absorbs the hit; combo is preserved
    }
    st.combo = 0; st.comboMult = 1;
    st.lives--;
    st.ship.invuln = 2;
    st.shake = Math.max(st.shake, 10);
    spawnParticle(st, st.ship.x, st.ship.y, '#ff5a5a', 22, 170);
    st.audio.hit();
    floater(st, st.ship.x, st.ship.y - 30, 'HIT!', '#ff5a5a');
    if (st.lives <= 0) {
      st.lives = 0; st.gameOver = true;
      spawnParticle(st, st.ship.x, st.ship.y, '#ffd166', 40, 220);
      st.audio.over();
      if (st.opts.bus) st.opts.bus.emit('game:ended', 'space-shooter', { score: st.score, wave: st.wave, kills: st.kills, final: true });
    }
    emitHud(st);
  }
  function killAsteroid(st, a, byBullet) {
    a.dead = true;
    st.kills++;
    var base = a.size === 'large' ? 20 : a.size === 'medium' ? 30 : 50;
    addKillScore(st, base, !!byBullet, a.x, a.y);
    spawnParticle(st, a.x, a.y, '#c9a86a', a.size === 'large' ? 18 : 10, 130);
    st.audio.boom();
    if (byBullet) {
      if (a.size === 'large') {
        st.asteroids.push(makeAsteroid(st, a.x - 14, a.y, 'medium'));
        st.asteroids.push(makeAsteroid(st, a.x + 14, a.y, 'medium'));
      } else if (a.size === 'medium') {
        st.asteroids.push(makeAsteroid(st, a.x - 10, a.y, 'small'));
        st.asteroids.push(makeAsteroid(st, a.x + 10, a.y, 'small'));
      }
    }
  }
  function killDrone(st, d) {
    d.dead = true;
    st.kills++;
    addKillScore(st, 100, true, d.x, d.y);
    spawnParticle(st, d.x, d.y, '#c792ea', 16, 140);
    st.audio.boom();
    if (Math.random() < 0.22) st.powerups.push(makePowerup(st, d.x, d.y));
  }
  function killBoss(st, b) {
    b.dead = true;
    st.kills++;
    /* Batch 25: bosses defeated — count boss-drone kills in the
     * run (kills alone mixes asteroids, drones and bosses). */
    st.bossesDefeated = (st.bossesDefeated || 0) + 1;
    addKillScore(st, 500, true, b.x, b.y);
    floater(st, b.x, b.y - 40, 'BOSS DOWN!', '#ff5a5a');
    spawnParticle(st, b.x, b.y, '#ff5a5a', 34, 220);
    st.audio.boom();
    st.powerups.push(makePowerup(st, b.x - 30, b.y));
    st.powerups.push(makePowerup(st, b.x + 30, b.y));
  }
  function update(st, dt) {
    st.time += dt;
    if (st.shake > 0) st.shake = Math.max(0, st.shake - dt * 18);
    var ship = st.ship;
    if (ship.invuln > 0) ship.invuln -= dt;
    // parallax stars
    for (var i = 0; i < st.stars.length; i++) {
      var s = st.stars[i];
      s.y += s.speed * dt;
      if (s.y > H) { s.y = -4; s.x = Math.random() * W; }
    }
    // ship movement: keyboard, or the touch joystick when active
    var ax = 0, ay = 0;
    if (st.keys.left) ax -= 1;
    if (st.keys.right) ax += 1;
    if (st.keys.up) ay -= 1;
    if (st.keys.down) ay += 1;
    var joyMag = Math.hypot(st.touch.dx, st.touch.dy);
    if (st.touch.joyId !== null && joyMag > 0.15) {
      ship.x = clamp(ship.x + (st.touch.dx / Math.max(1, joyMag)) * Math.min(1, joyMag) * 340 * dt, 24, W - 24);
      ship.y = clamp(ship.y + (st.touch.dy / Math.max(1, joyMag)) * Math.min(1, joyMag) * 340 * dt, 50, H - 28);
      ship.thrust = 1;
      if (joyMag > 0.3) ship.angle = Math.atan2(st.touch.dy, st.touch.dx);
    } else if (ax !== 0 || ay !== 0) {
      var len = Math.hypot(ax, ay);
      ship.x = clamp(ship.x + (ax / len) * 340 * dt, 24, W - 24);
      ship.y = clamp(ship.y + (ay / len) * 340 * dt, 50, H - 28);
      ship.thrust = 1;
      ship.angle = Math.atan2(st.mouse.y - ship.y, st.mouse.x - ship.x);
    } else {
      ship.thrust = 0;
      ship.angle = Math.atan2(st.mouse.y - ship.y, st.mouse.x - ship.x);
    }
    // firing (spread shot: 3 bullets while the spread power-up lasts)
    st.fireCd -= dt;
    if (st.firing && st.fireCd <= 0 && !st.gameOver) {
      var bx = ship.x + Math.cos(ship.angle) * 22, by = ship.y + Math.sin(ship.angle) * 22;
      var angles = st.time < st.spreadUntil ? [-0.18, 0, 0.18] : [0];
      for (var ai = 0; ai < angles.length; ai++) {
        var fa = ship.angle + angles[ai];
        st.bullets.push({ x: bx, y: by, vx: Math.cos(fa) * 720, vy: Math.sin(fa) * 720, life: 1.1, dead: false });
      }
      st.shotsFired++;
      st.fireCd = fireInterval(st);
      st.audio.shoot();
    }
    // spawning
    if (!st.betweenWaves && st.spawnQueue.length) {
      st.spawnTimer -= dt;
      if (st.spawnTimer <= 0) { spawnNext(st); st.spawnTimer = Math.max(0.3, 0.7 - st.wave * 0.03); }
    }
    // bullets
    for (i = st.bullets.length - 1; i >= 0; i--) {
      var b = st.bullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (b.life <= 0 || b.x < -20 || b.x > W + 20 || b.y < -20 || b.y > H + 20) { st.bullets.splice(i, 1); continue; }
      var hitDone = false;
      for (var j = 0; j < st.asteroids.length && !hitDone; j++) {
        var a = st.asteroids[j];
        if (!a.dead && dist(b.x, b.y, a.x, a.y) <= a.r + 4) {
          a.hp--;
          st.bullets.splice(i, 1); hitDone = true;
          if (a.hp <= 0) killAsteroid(st, a, true);
          else spawnParticle(st, b.x, b.y, '#c9a86a', 3, 60);
        }
      }
      if (hitDone) continue;
      for (j = 0; j < st.drones.length; j++) {
        var d = st.drones[j];
        if (!d.dead && dist(b.x, b.y, d.x, d.y) <= d.r + 4) {
          d.hp--;
          st.bullets.splice(i, 1);
          if (d.hp <= 0) killDrone(st, d);
          else spawnParticle(st, b.x, b.y, '#c792ea', 3, 60);
          break;
        }
      }
      if (st.bullets.indexOf(b) < 0) continue;
      for (j = 0; j < st.bosses.length; j++) {
        var bo2 = st.bosses[j];
        if (!bo2.dead && dist(b.x, b.y, bo2.x, bo2.y) <= bo2.r + 4) {
          bo2.hp--;
          st.bullets.splice(i, 1);
          if (bo2.hp <= 0) killBoss(st, bo2);
          else spawnParticle(st, b.x, b.y, '#ff5a5a', 3, 60);
          break;
        }
      }
    }
    // asteroids
    for (i = st.asteroids.length - 1; i >= 0; i--) {
      var as = st.asteroids[i];
      as.x += as.vx * dt; as.y += as.vy * dt; as.rot += as.rotSpd * dt;
      if (as.x < -50) as.x = W + 40;
      if (as.x > W + 50) as.x = -40;
      if (as.y > H + 60) { st.asteroids.splice(i, 1); continue; }
      if (!as.dead && !st.gameOver && dist(as.x, as.y, ship.x, ship.y) <= as.r + ship.r - 4) {
        killAsteroid(st, as, false);
        damageShip(st);
      } else if (!as.dead && !st.gameOver && !as.grazed && dist(as.x, as.y, ship.x, ship.y) <= as.r + ship.r + 22) {
        /* Batch 21: graze bonus — skimming an asteroid within 22px of
         * contact (without touching it) pays +5 once per asteroid. */
        as.grazed = true; st.grazes++;
        st.score += 5;
        floater(st, ship.x, ship.y - 30, '+5 GRAZE', '#7bdff2');
      }
    }
    st.asteroids = st.asteroids.filter(function (a) { return !a.dead; });
    // drones
    for (i = st.drones.length - 1; i >= 0; i--) {
      var dr = st.drones[i];
      dr.t += dt;
      dr.y += dr.vy * dt;
      dr.x = dr.baseX + Math.sin(dr.t * 1.8) * 90;
      dr.fireCd -= dt;
      if (dr.fireCd <= 0 && dr.y > 0 && dr.y < H - 100 && !st.gameOver) {
        var ang = Math.atan2(ship.y - dr.y, ship.x - dr.x);
        st.bolts.push({ x: dr.x, y: dr.y + 14, vx: Math.cos(ang) * 260, vy: Math.sin(ang) * 260, life: 3, r: 6, dead: false });
        dr.fireCd = Math.max(0.9, 1.7 - st.wave * 0.06);
        st.audio.shoot();
      }
      if (dr.y > H + 40) { st.drones.splice(i, 1); continue; }
      if (!dr.dead && !st.gameOver && dist(dr.x, dr.y, ship.x, ship.y) <= dr.r + ship.r - 4) {
        killDrone(st, dr);
        damageShip(st);
      }
    }
    st.drones = st.drones.filter(function (d) { return !d.dead; });
    // boss drones: slow weave across the top, 3-bolt fan, big health pool
    for (i = st.bosses.length - 1; i >= 0; i--) {
      var bs = st.bosses[i];
      bs.t += dt;
      bs.y = Math.min(H - 160, bs.y + bs.vy * dt);
      bs.x = bs.baseX + Math.sin(bs.t * 0.9) * (W / 2 - 90);
      bs.fireCd -= dt;
      if (bs.fireCd <= 0 && bs.y > 0 && !st.gameOver) {
        for (var fb = -1; fb <= 1; fb++) {
          var bang = Math.atan2(ship.y - bs.y, ship.x - bs.x) + fb * 0.28;
          st.bolts.push({ x: bs.x, y: bs.y + 30, vx: Math.cos(bang) * 280, vy: Math.sin(bang) * 280, life: 3, r: 7, dead: false });
        }
        bs.fireCd = Math.max(1.2, 2.2 - st.wave * 0.04);
        st.audio.shoot();
      }
      if (bs.y > H + 60) { st.bosses.splice(i, 1); continue; }
      // Contact hurts the ship but does not kill the boss.
      if (!bs.dead && !st.gameOver && dist(bs.x, bs.y, ship.x, ship.y) <= bs.r + ship.r - 4) damageShip(st);
    }
    st.bosses = st.bosses.filter(function (b) { return !b.dead; });
    // enemy bolts
    for (i = st.bolts.length - 1; i >= 0; i--) {
      var bo = st.bolts[i];
      bo.x += bo.vx * dt; bo.y += bo.vy * dt; bo.life -= dt;
      if (bo.life <= 0 || bo.x < -20 || bo.x > W + 20 || bo.y < -20 || bo.y > H + 20) { st.bolts.splice(i, 1); continue; }
      if (!st.gameOver && dist(bo.x, bo.y, ship.x, ship.y) <= bo.r + ship.r - 4) {
        st.bolts.splice(i, 1);
        damageShip(st);
      }
    }
    // powerups: shield (absorbs one hit), rapid fire, spread shot, extra life
    for (i = st.powerups.length - 1; i >= 0; i--) {
      var p = st.powerups[i];
      p.y += p.vy * dt; p.life -= dt;
      if (p.life <= 0 || p.y > H + 30) { st.powerups.splice(i, 1); continue; }
      if (!st.gameOver && dist(p.x, p.y, ship.x, ship.y) <= p.r + ship.r) {
        st.powerups.splice(i, 1);
        var kind = p.kind || 'life';
        st.powerupCounts[kind] = (st.powerupCounts[kind] || 0) + 1;
        if (kind === 'shield') { st.shield = true; floater(st, ship.x, ship.y - 30, 'SHIELD UP!', '#00f6ff'); }
        else if (kind === 'rapid') { st.rapidUntil = st.time + 6; floater(st, ship.x, ship.y - 30, 'RAPID FIRE!', '#00f6ff'); }
        else if (kind === 'spread') { st.spreadUntil = st.time + 8; floater(st, ship.x, ship.y - 30, 'SPREAD SHOT!', '#ffd166'); }
        else if (st.lives < 5) { st.lives++; floater(st, ship.x, ship.y - 30, '+1 LIFE', '#3ddc5f'); }
        else { st.rapidUntil = st.time + 6; floater(st, ship.x, ship.y - 30, 'RAPID FIRE!', '#00f6ff'); }
        st.audio.power();
        emitHud(st);
      }
    }
    // beams of light: particles / floaters
    for (i = st.particles.length - 1; i >= 0; i--) {
      var pa = st.particles[i];
      pa.life -= dt; pa.x += pa.vx * dt; pa.y += pa.vy * dt; pa.vx *= 0.94; pa.vy *= 0.94;
      if (pa.life <= 0) st.particles.splice(i, 1);
    }
    for (i = st.floaters.length - 1; i >= 0; i--) {
      var fl = st.floaters[i];
      fl.life -= dt; fl.vy = (fl.vy == null ? -70 : fl.vy) + 160 * dt; fl.y += fl.vy * dt;
      if (fl.life <= 0) st.floaters.splice(i, 1);
    }
    // wave clear (a live boss holds the wave open)
    if (!st.gameOver && !st.betweenWaves && !st.spawnQueue.length && !st.asteroids.length && !st.drones.length && !st.bosses.length) {
      var bonus = 100 + st.wave * 50;
      st.score += bonus;
      st.audio.clear();
      floater(st, W / 2, 90, 'WAVE CLEAR  +' + bonus, '#3ddc5f');
      if (st.opts.bus) st.opts.bus.emit('game:wave_completed', st.wave, { score: st.score, kills: st.kills });
      st.betweenWaves = true;
      st.waveTimer = 1.2;
      emitHud(st);
    }
    if (st.betweenWaves && !st.gameOver) {
      st.waveTimer -= dt;
      if (st.waveTimer <= 0) startWave(st);
    }
    emitHudThrottled(st, dt);
  }
  function emitHud(st) { if (st.opts.onHud) st.opts.onHud(getHud(st)); }
  /* ---- Batch 22: shot accuracy ---- * Kills per firing volley
   * (shotsFired counts one volley per trigger pull, spread shot
   * included), as a percent to one decimal, capped at 100 — a
   * spread volley can kill more than one target. 0 with no shots.
   * Exposed in the HUD/state as accuracy. */
  function accuracyFor(shotsFired, kills) {
    if (!shotsFired || shotsFired <= 0) return 0;
    return Math.min(100, Math.round((kills || 0) / shotsFired * 1000) / 10);
  }
  /* ---- Batch 24: kills per wave ---- * Average kills per
   * wave reached, to one decimal. 0 before the first wave.
   * Exposed in the HUD/state as killsPerWave, and on the
   * game-over screen. */
  function killsPerWaveFor(kills, wave) {
    if (!wave || wave <= 0) return 0;
    return Math.round((kills || 0) / wave * 10) / 10;
  }
  /* ---- Batch 26: shots per kill ---- * Average volleys
   * fired per kill, to one decimal — the complement of
   * accuracy (a spread volley can kill more than one target,
   * so this can read below 1). 0 with no kills. Exposed in
   * the HUD/state as shotsPerKill, and on the game-over
   * screen. */
  function shotsPerKillFor(shotsFired, kills) {
    if (!kills || kills <= 0) return 0;
    return Math.round((shotsFired || 0) / kills * 10) / 10;
  }
  /* ---- Batch 27: score per wave ---- * Average score
   * per wave reached, to one decimal. 0 before the first
   * wave. Exposed in the HUD/state as scorePerWave, and
   * on the game-over screen, mirroring killsPerWaveFor. */
  function scorePerWaveFor(score, wave) {
    if (!wave || wave <= 0) return 0;
    return Math.round((score || 0) / wave * 10) / 10;
  }
  /* ---- Batch 28: grazes per wave ---- * Average asteroid
   * grazes per wave reached, to one decimal. 0 before the
   * first wave. Exposed in the HUD/state as grazesPerWave,
   * and on the game-over screen, mirroring
   * killsPerWaveFor. */
  function grazesPerWaveFor(grazes, wave) {
    if (!wave || wave <= 0) return 0;
    return Math.round((grazes || 0) / wave * 10) / 10;
  }
  /* ---- Batch 29: power-ups per wave ---- * Average
   * power-ups collected per wave reached, to one decimal.
   * 0 before the first wave. Exposed in the HUD/state as
   * powerupsPerWave, and on the game-over screen,
   * mirroring grazesPerWaveFor. */
  function powerupsPerWaveFor(powerupCounts, wave) {
    if (!wave || wave <= 0) return 0;
    var c = powerupCounts || {};
    var total = (c.shield || 0) + (c.rapid || 0) + (c.spread || 0) + (c.life || 0);
    return Math.round(total / wave * 10) / 10;
  }
  /* ---- Batch 30: shots per wave ---- * Average firing
   * volleys per wave reached, to one decimal. 0 before
   * the first wave. Exposed in the HUD/state as
   * shotsPerWave, and on the game-over screen,
   * mirroring killsPerWaveFor. */
  function shotsPerWaveFor(shotsFired, wave) {
    if (!wave || wave <= 0) return 0;
    return Math.round((shotsFired || 0) / wave * 10) / 10;
  }
  /* ---- Batch 31: bosses per wave ---- * Average
   * bosses defeated per wave reached, to one decimal.
   * 0 before the first wave. Exposed in the HUD/state
   * as bossesPerWave, and on the game-over screen,
   * mirroring shotsPerWaveFor. */
  function bossesPerWaveFor(bossesDefeated, wave) {
    if (!wave || wave <= 0) return 0;
    return Math.round((bossesDefeated || 0) / wave * 10) / 10;
  }
  /* ---- Batch 32: score per kill ---- * Average score
   * per kill, to one decimal. 0 with no kills yet.
   * Exposed in the HUD/state as scorePerKill, and on
   * the game-over screen, mirroring shotsPerKillFor
   * (the score view: points earned per kill, not
   * volleys fired per kill). */
  function scorePerKillFor(score, kills) {
    if (!kills || kills <= 0) return 0;
    return Math.round((score || 0) / kills * 10) / 10;
  }
  /* ---- Batch 33: grazes per kill ---- * Average grazes
   * per kill, to one decimal. 0 with no kills yet.
   * Exposed in the HUD/state as grazesPerKill, and on
   * the game-over screen, mirroring scorePerKillFor
   * (the graze view: near-misses per kill, not points
   * per kill). */
  function grazesPerKillFor(grazes, kills) {
    if (!kills || kills <= 0) return 0;
    return Math.round((grazes || 0) / kills * 10) / 10;
  }
  /* ---- Batch 34: score per shot ---- * Average score
   * per firing volley, to one decimal. 0 with no shots
   * fired yet. Exposed in the HUD/state as
   * scorePerShot, and on the game-over screen,
   * mirroring scorePerKillFor (the volley view:
   * points earned per shot fired, not per kill;
   * shotsFired counts one volley per trigger pull). */
  function scorePerShotFor(score, shotsFired) {
    if (!shotsFired || shotsFired <= 0) return 0;
    return Math.round((score || 0) / shotsFired * 10) / 10;
  }
  /* ---- Batch 35: grazes per shot ---- * Average
   * grazes (near-misses) per firing volley, to one
   * decimal. 0 with no shots fired yet. Exposed in
   * the HUD/state as grazesPerShot, and on the
   * game-over screen, mirroring scorePerShotFor
   * (the graze view: near-misses per volley, not
   * points per volley). */
  function grazesPerShotFor(grazes, shotsFired) {
    if (!shotsFired || shotsFired <= 0) return 0;
    return Math.round((grazes || 0) / shotsFired * 10) / 10;
  }
  /* ---- Batch 36: power-ups per kill ---- * Average
   * power-ups collected per kill, to one decimal. 0 with
   * no kills yet. Exposed in the HUD/state as
   * powerupsPerKill, and on the game-over screen,
   * mirroring grazesPerShotFor (the pickup view:
   * power-ups earned per kill, not near-misses per
   * volley; same shield/rapid/spread/life total as
   * powerupsPerWaveFor). */
  function powerupsPerKillFor(powerupCounts, kills) {
    if (!kills || kills <= 0) return 0;
    var c = powerupCounts || {};
    var total = (c.shield || 0) + (c.rapid || 0) + (c.spread || 0) + (c.life || 0);
    return Math.round(total / kills * 10) / 10;
  }
  /* ---- Batch 37: boss share ---- * Bosses defeated
   * as a percent of all kills, to one decimal, capped
   * at 100 (boss kills are a subset of kills in
   * normal play). 0 with no kills yet. Exposed in
   * the HUD/state as bossShare, and on the game-over
   * screen, mirroring powerupsPerKillFor (the boss
   * view: how much of the killing was bosses, not
   * pickups per kill). */
  function bossShareFor(bossesDefeated, kills) {
    if (!kills || kills <= 0) return 0;
    return Math.min(100, Math.round((bossesDefeated || 0) / kills * 1000) / 10);
  }
  /* ---- Batch 38: kills per minute ---- * Kills
   * per minute of run time, to one decimal. 0 with
   * no elapsed time yet. Exposed in the HUD/state
   * as killsPerMinute, and on the game-over screen,
   * mirroring bossShareFor (the pace view: kills
   * per minute, not the boss share of kills). */
  function killsPerMinuteFor(kills, seconds) {
    if (!seconds || seconds <= 0) return 0;
    return Math.round((kills || 0) / (seconds / 60) * 10) / 10;
  }
  /* ---- Batch 39: score per minute ---- * Score
   * per minute of run time, to one decimal. 0 with
   * no elapsed time yet. Exposed in the HUD/state
   * as scorePerMinute, and on the game-over screen,
   * mirroring killsPerMinuteFor (the scoring pace
   * view: points per minute, not kills per minute). */
  function scorePerMinuteFor(score, seconds) {
    if (!seconds || seconds <= 0) return 0;
    return Math.round((score || 0) / (seconds / 60) * 10) / 10;
  }
  /* ---- Batch 40: grazes per minute ---- * Grazes
   * per minute of run time, to one decimal. 0 with
   * no elapsed time yet. Exposed in the HUD/state
   * as grazesPerMinute, and on the game-over
   * screen, mirroring scorePerMinuteFor (the
   * near-miss pace view: grazes per minute, not
   * score per minute). */
  function grazesPerMinuteFor(grazes, seconds) {
    if (!seconds || seconds <= 0) return 0;
    return Math.round((grazes || 0) / (seconds / 60) * 10) / 10;
  }
  /* ---- Batch 41: power-ups per minute ---- * Total
   * power-ups collected per minute of run time, to
   * one decimal. 0 with no elapsed time yet.
   * Exposed in the HUD/state as powerupsPerMinute,
   * and on the game-over screen, mirroring
   * grazesPerMinuteFor (the pickup pace view:
   * power-ups per minute, not grazes per minute). */
  function powerupsPerMinuteFor(powerupCounts, seconds) {
    if (!seconds || seconds <= 0) return 0;
    var c = powerupCounts || {};
    var total = (c.shield || 0) + (c.rapid || 0) + (c.spread || 0) + (c.life || 0);
    return Math.round(total / (seconds / 60) * 10) / 10;
  }
  var _hudAcc = 0;
  function emitHudThrottled(st, dt) { _hudAcc += dt; if (_hudAcc > 0.25) { _hudAcc = 0; emitHud(st); } }
  function getHud(st) {
    var boss = st.bosses[0] || null;
    return { score: st.score, wave: st.wave, lives: st.lives, gameOver: st.gameOver, shotsFired: st.shotsFired, kills: st.kills, accuracy: accuracyFor(st.shotsFired, st.kills), killsPerWave: killsPerWaveFor(st.kills, st.wave), shotsPerKill: shotsPerKillFor(st.shotsFired, st.kills), scorePerWave: scorePerWaveFor(st.score, st.wave), grazesPerWave: grazesPerWaveFor(st.grazes, st.wave), powerupsPerWave: powerupsPerWaveFor(st.powerupCounts, st.wave), shotsPerWave: shotsPerWaveFor(st.shotsFired, st.wave), bossesPerWave: bossesPerWaveFor(st.bossesDefeated || 0, st.wave), scorePerKill: scorePerKillFor(st.score, st.kills), grazesPerKill: grazesPerKillFor(st.grazes, st.kills), scorePerShot: scorePerShotFor(st.score, st.shotsFired), grazesPerShot: grazesPerShotFor(st.grazes, st.shotsFired), powerupsPerKill: powerupsPerKillFor(st.powerupCounts, st.kills), bossShare: bossShareFor(st.bossesDefeated || 0, st.kills), killsPerMinute: killsPerMinuteFor(st.kills, st.time), scorePerMinute: scorePerMinuteFor(st.score, st.time), grazesPerMinute: grazesPerMinuteFor(st.grazes, st.time), powerupsPerMinute: powerupsPerMinuteFor(st.powerupCounts, st.time), combo: st.combo, comboMult: st.comboMult, bestCombo: st.bestCombo, grazes: st.grazes, bestWave: st.bestWave || 0, shield: st.shield, rapidLeft: Math.max(0, Math.ceil(st.rapidUntil - st.time)), spreadLeft: Math.max(0, Math.ceil(st.spreadUntil - st.time)), boss: boss ? { hp: boss.hp, maxHp: boss.maxHp, wave: st.wave } : null, powerups: st.powerupCounts, bossesDefeated: st.bossesDefeated || 0, touch: st.touch.seen };
  }

  /* ---- Drawing ---- */
  function drawShip(ctx, st) {
    var ship = st.ship;
    if (ship.invuln > 0 && Math.floor(st.time * 12) % 2 === 0) return; // blink while invulnerable
    ctx.save(); ctx.translate(ship.x, ship.y); ctx.rotate(ship.angle);
    // engine flame
    var fl = 10 + Math.random() * 8 + (ship.thrust ? 8 : 0);
    ctx.fillStyle = ship.thrust ? '#ffb703' : '#ff6b35';
    ctx.beginPath(); ctx.moveTo(-14, -5); ctx.lineTo(-14 - fl, 0); ctx.lineTo(-14, 5); ctx.closePath(); ctx.fill();
    // hull
    ctx.fillStyle = '#e8ecf4';
    ctx.beginPath(); ctx.moveTo(22, 0); ctx.lineTo(-12, -13); ctx.lineTo(-6, 0); ctx.lineTo(-12, 13); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#00f6ff'; ctx.lineWidth = 2; ctx.stroke();
    // cockpit
    ctx.fillStyle = '#00f6ff';
    ctx.beginPath(); ctx.arc(6, 0, 4.5, 0, TAU); ctx.fill();
    // hero ring
    if (st.hero) {
      ctx.strokeStyle = st.hero.color || '#ffd166'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 20, 0, TAU); ctx.stroke();
    }
    // shield bubble
    if (st.shield) {
      ctx.strokeStyle = 'rgba(0,246,255,.9)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, 26, 0, TAU); ctx.stroke();
      ctx.strokeStyle = 'rgba(0,246,255,.35)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, 0, 30, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }
  function drawBoss(ctx, b, time) {
    ctx.save(); ctx.translate(b.x, b.y);
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(5, 30, 42, 10, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#4a1f2e';
    ctx.beginPath(); ctx.moveTo(0, -44); ctx.lineTo(40, 0); ctx.lineTo(0, 44); ctx.lineTo(-40, 0); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#ff5a5a'; ctx.lineWidth = 3; ctx.stroke();
    ctx.strokeStyle = '#c792ea'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-40, 0); ctx.lineTo(40, 0); ctx.stroke();
    var pulse = 0.6 + 0.4 * Math.sin(time * 5 + b.t);
    ctx.fillStyle = 'rgba(255,90,90,' + pulse + ')';
    ctx.beginPath(); ctx.arc(0, 0, 13, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center';
    ctx.fillText('BOSS', 0, -50);
    ctx.restore();
  }
  var POWERUP_STYLE = { shield: { color: '#00f6ff', label: 'S' }, rapid: { color: '#ffd166', label: 'R' }, spread: { color: '#ff8fab', label: 'W' }, life: { color: '#3ddc5f', label: '+' } };
  function drawPowerup(ctx, p) {
    var s = POWERUP_STYLE[p.kind || 'life'] || POWERUP_STYLE.life;
    ctx.save(); ctx.translate(p.x, p.y);
    ctx.fillStyle = 'rgba(5,8,20,.8)';
    ctx.beginPath(); ctx.arc(0, 0, p.r, 0, TAU); ctx.fill();
    ctx.strokeStyle = s.color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, p.r, 0, TAU); ctx.stroke();
    ctx.fillStyle = s.color; ctx.font = 'bold 15px Arial'; ctx.textAlign = 'center';
    ctx.fillText(s.label, 0, 5);
    ctx.restore();
  }
  function drawAsteroid(ctx, a) {
    ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(a.rot);
    var g = ctx.createRadialGradient(-a.r * 0.3, -a.r * 0.3, 2, 0, 0, a.r * 1.15);
    g.addColorStop(0, '#b8a284'); g.addColorStop(0.6, '#7a6a52'); g.addColorStop(1, '#4a4034');
    ctx.fillStyle = g;
    ctx.beginPath();
    for (var i = 0; i < a.verts.length; i++) {
      var ang = (i / a.verts.length) * TAU, rr = a.r * a.verts[i];
      if (i === 0) ctx.moveTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
      else ctx.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
    }
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 1.5; ctx.stroke();
    // craters
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.beginPath(); ctx.arc(-a.r * 0.3, a.r * 0.2, a.r * 0.22, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(a.r * 0.35, -a.r * 0.25, a.r * 0.16, 0, TAU); ctx.fill();
    // hp pips for big rocks
    if (a.maxHp > 1) {
      ctx.fillStyle = '#fff'; ctx.font = 'bold 10px Arial'; ctx.textAlign = 'center';
      ctx.fillText(String(a.hp), 0, 4);
    }
    ctx.restore();
  }
  function drawDrone(ctx, d, time) {
    ctx.save(); ctx.translate(d.x, d.y);
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(3, 14, 18, 5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#3a2a56';
    ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo(18, 0); ctx.lineTo(0, 20); ctx.lineTo(-18, 0); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#c792ea'; ctx.lineWidth = 2; ctx.stroke();
    var pulse = 0.6 + 0.4 * Math.sin(time * 6 + d.t);
    ctx.fillStyle = 'rgba(255,90,90,' + pulse + ')';
    ctx.beginPath(); ctx.arc(0, 0, 6, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function draw(st) {
    var ctx = st.ctx;
    ctx.save();
    if (st.shake > 0) ctx.translate((Math.random() - 0.5) * st.shake, (Math.random() - 0.5) * st.shake);
    ctx.drawImage(st.bg, 0, 0);
    // parallax stars
    for (var i = 0; i < st.stars.length; i++) {
      var s = st.stars[i];
      ctx.fillStyle = 'rgba(255,255,255,' + s.alpha + ')';
      ctx.fillRect(s.x, s.y, s.size, s.size * 3);
    }
    // aim line (faint)
    if (!st.gameOver) {
      ctx.strokeStyle = 'rgba(0,246,255,.18)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(st.ship.x, st.ship.y); ctx.lineTo(st.mouse.x, st.mouse.y); ctx.stroke();
      ctx.strokeStyle = 'rgba(0,246,255,.7)';
      ctx.beginPath(); ctx.arc(st.mouse.x, st.mouse.y, 8, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(st.mouse.x - 12, st.mouse.y); ctx.lineTo(st.mouse.x + 12, st.mouse.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(st.mouse.x, st.mouse.y - 12); ctx.lineTo(st.mouse.x, st.mouse.y + 12); ctx.stroke();
    }
    for (i = 0; i < st.powerups.length; i++) drawPowerup(ctx, st.powerups[i]);
    for (i = 0; i < st.asteroids.length; i++) drawAsteroid(ctx, st.asteroids[i]);
    for (i = 0; i < st.drones.length; i++) drawDrone(ctx, st.drones[i], st.time);
    for (i = 0; i < st.bosses.length; i++) drawBoss(ctx, st.bosses[i], st.time);
    // bullets
    for (i = 0; i < st.bullets.length; i++) {
      var b = st.bullets[i];
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(Math.atan2(b.vy, b.vx));
      ctx.fillStyle = '#aef3ff'; ctx.fillRect(-8, -2, 16, 4);
      ctx.fillStyle = '#fff'; ctx.fillRect(2, -1.5, 6, 3);
      ctx.restore();
    }
    // enemy bolts
    for (i = 0; i < st.bolts.length; i++) {
      var bo = st.bolts[i];
      ctx.fillStyle = '#ff5a9e';
      ctx.beginPath(); ctx.arc(bo.x, bo.y, bo.r, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(bo.x, bo.y, 2.5, 0, TAU); ctx.fill();
    }
    if (!st.gameOver) drawShip(ctx, st);
    for (i = 0; i < st.particles.length; i++) {
      var pa = st.particles[i];
      ctx.globalAlpha = Math.max(0, pa.life / pa.max);
      ctx.fillStyle = pa.color;
      ctx.beginPath(); ctx.arc(pa.x, pa.y, pa.size, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (i = 0; i < st.floaters.length; i++) {
      var fl = st.floaters[i];
      ctx.globalAlpha = Math.max(0, Math.min(1, fl.life / 0.3));
      ctx.fillStyle = fl.color; ctx.font = 'bold ' + (fl.size || 16) + 'px Arial'; ctx.textAlign = 'center';
      ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 3; if (ctx.strokeText) ctx.strokeText(fl.text, fl.x, fl.y);
      ctx.fillText(fl.text, fl.x, fl.y);
    }
    ctx.globalAlpha = 1;
    // top bar
    ctx.fillStyle = 'rgba(5,8,20,.55)'; ctx.fillRect(0, 0, W, 34);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 15px Arial'; ctx.textAlign = 'left';
    ctx.fillText('SCORE ' + st.score, 14, 22);
    ctx.fillText('WAVE ' + st.wave, 170, 22);
    ctx.fillStyle = '#ff5a5a';
    ctx.fillText('LIVES ' + '♥'.repeat(Math.max(0, st.lives)), 300, 22);
    if (st.shield) { ctx.fillStyle = '#00f6ff'; ctx.fillText('🛡 SHIELD', 430, 22); }
    if (st.time < st.rapidUntil) { ctx.fillStyle = '#00f6ff'; ctx.fillText('RAPID', 540, 22); }
    if (st.time < st.spreadUntil) { ctx.fillStyle = '#ff8fab'; ctx.fillText('SPREAD', 610, 22); }
    if (st.comboMult > 1) { ctx.fillStyle = '#ffd166'; ctx.fillText('COMBO x' + st.comboMult.toFixed(1) + ' (' + st.combo + ')', 690, 22); }
    if (st.bosses.length) {
      var bb = st.bosses[0];
      ctx.fillStyle = 'rgba(5,8,20,.7)'; ctx.fillRect(W / 2 - 160, 40, 320, 14);
      ctx.fillStyle = '#ff5a5a'; ctx.fillRect(W / 2 - 160, 40, 320 * Math.max(0, bb.hp / bb.maxHp), 14);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(W / 2 - 160, 40, 320, 14);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center';
      ctx.fillText('BOSS  ' + bb.hp + '/' + bb.maxHp, W / 2, 51);
    }
    // touch controls overlay (only after a touch has been seen)
    if (st.touch.seen) {
      var jx = st.touch.joyId !== null ? st.touch.joyOX : 110, jy = st.touch.joyId !== null ? st.touch.joyOY : H - 110;
      ctx.globalAlpha = 0.35; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(jx, jy, 55, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 0.6; ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(jx + clamp(st.touch.dx, -1, 1) * 32, jy + clamp(st.touch.dy, -1, 1) * 32, 22, 0, TAU); ctx.fill();
      ctx.globalAlpha = st.touch.fireId !== null ? 0.8 : 0.35; ctx.fillStyle = '#ff5a5a';
      ctx.beginPath(); ctx.arc(W - 90, H - 110, 42, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.9; ctx.fillStyle = '#fff'; ctx.font = 'bold 15px Arial'; ctx.textAlign = 'center';
      ctx.fillText('FIRE', W - 90, H - 105);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = '#9fb4d8'; ctx.font = '13px Arial'; ctx.textAlign = 'right';
    ctx.fillText('Arrows/WASD move • Mouse aim • Hold click/Space to fire • P pause • R restart', W - 12, 22);
    if (st.paused && !st.gameOver) {
      ctx.fillStyle = 'rgba(5,8,20,.6)'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 36px Arial'; ctx.textAlign = 'center';
      ctx.fillText('PAUSED', W / 2, H / 2);
      ctx.fillStyle = '#9fb4d8'; ctx.font = '15px Arial';
      ctx.fillText('Press P to resume.', W / 2, H / 2 + 30);
    }
    if (st.gameOver) {
      ctx.fillStyle = 'rgba(5,8,20,.72)'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#ff5a5a'; ctx.font = 'bold 44px Arial'; ctx.textAlign = 'center';
      ctx.fillText('💥 GAME OVER', W / 2, H / 2 - 10);
      ctx.fillStyle = '#fff'; ctx.font = '18px Arial';
      ctx.fillText('Score ' + st.score + '  •  Wave ' + st.wave + '  •  Best wave ' + (st.bestWave || st.wave) + '  •  Kills ' + st.kills + '  •  Shots ' + st.shotsFired + '  •  Accuracy ' + accuracyFor(st.shotsFired, st.kills) + '%  •  Kills/wave ' + killsPerWaveFor(st.kills, st.wave) + '  •  Score/wave ' + scorePerWaveFor(st.score, st.wave), W / 2, H / 2 + 26);
      ctx.fillStyle = '#ffd166'; ctx.font = '15px Arial';
      ctx.fillText('Best combo ' + st.bestCombo + '  •  Bosses defeated ' + (st.bossesDefeated || 0) + '  •  Grazes/wave ' + grazesPerWaveFor(st.grazes, st.wave) + '  •  Shots/kill ' + shotsPerKillFor(st.shotsFired, st.kills) + '  •  Power-ups ' + (st.powerupCounts.shield + st.powerupCounts.rapid + st.powerupCounts.spread + st.powerupCounts.life) + '  •  Power-ups/wave ' + powerupsPerWaveFor(st.powerupCounts, st.wave) + '  •  Shots/wave ' + shotsPerWaveFor(st.shotsFired, st.wave) + '  •  Bosses/wave ' + bossesPerWaveFor(st.bossesDefeated || 0, st.wave) + '  •  Score/kill ' + scorePerKillFor(st.score, st.kills) + '  •  Grazes/kill ' + grazesPerKillFor(st.grazes, st.kills) + '  •  Score/shot ' + scorePerShotFor(st.score, st.shotsFired) + '  •  Grazes/shot ' + grazesPerShotFor(st.grazes, st.shotsFired) + '  •  Power-ups/kill ' + powerupsPerKillFor(st.powerupCounts, st.kills) + '  •  Boss share ' + bossShareFor(st.bossesDefeated || 0, st.kills) + '%' + '  •  Kills/min ' + killsPerMinuteFor(st.kills, st.time) + '  •  Score/min ' + scorePerMinuteFor(st.score, st.time) + '  •  Grazes/min ' + grazesPerMinuteFor(st.grazes, st.time) + '  •  Power-ups/min ' + powerupsPerMinuteFor(st.powerupCounts, st.time), W / 2, H / 2 + 48);
      ctx.fillStyle = '#9fb4d8'; ctx.font = '14px Arial';
      ctx.fillText('Press R to restart, or switch games in the sidebar.', W / 2, H / 2 + 74);
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
    st._fpsN++; st._fpsT += dt; if (st._fpsT >= 0.5) { st.fps = Math.round(st._fpsN / st._fpsT); st._fpsN = 0; st._fpsT = 0; updateDynFactor(st); }
    if (st.running && !st.paused) update(st, dt);
    draw(st);
  }
  function canvasPos(st, ev) {
    var r = st.canvas.getBoundingClientRect();
    return { x: (ev.clientX - r.left) * (W / r.width), y: (ev.clientY - r.top) * (H / r.height) };
  }
  /* Touch: left half = virtual joystick anchored where the finger lands,
   * right half = fire button. Identifiers are tracked so a second finger
   * can fire while the first steers. */
  function touchPos(st, t) {
    var r = st.canvas.getBoundingClientRect();
    return { x: (t.clientX - r.left) * (W / r.width), y: (t.clientY - r.top) * (H / r.height) };
  }
  function handleTouchStart(st, ev) {
    st.touch.seen = true;
    st.audio.unlock();
    if (ev.preventDefault) ev.preventDefault();
    var touches = ev.changedTouches || [];
    for (var i = 0; i < touches.length; i++) {
      var pos = touchPos(st, touches[i]);
      if (pos.x < W * 0.55 && st.touch.joyId === null) {
        st.touch.joyId = touches[i].identifier;
        st.touch.joyOX = pos.x; st.touch.joyOY = pos.y; st.touch.dx = 0; st.touch.dy = 0;
      } else if (st.touch.fireId === null) {
        st.touch.fireId = touches[i].identifier;
        st.firing = true;
      }
    }
  }
  function handleTouchMove(st, ev) {
    if (ev.preventDefault) ev.preventDefault();
    var touches = ev.changedTouches || [];
    for (var i = 0; i < touches.length; i++) {
      if (touches[i].identifier === st.touch.joyId) {
        var pos = touchPos(st, touches[i]);
        st.touch.dx = (pos.x - st.touch.joyOX) / 55;
        st.touch.dy = (pos.y - st.touch.joyOY) / 55;
        var m = Math.hypot(st.touch.dx, st.touch.dy);
        if (m > 1) { st.touch.dx /= m; st.touch.dy /= m; }
      }
    }
  }
  function handleTouchEnd(st, ev) {
    var touches = ev.changedTouches || [];
    for (var i = 0; i < touches.length; i++) {
      if (touches[i].identifier === st.touch.joyId) { st.touch.joyId = null; st.touch.dx = 0; st.touch.dy = 0; }
      if (touches[i].identifier === st.touch.fireId) {
        st.touch.fireId = null;
        if (!st.mouse.down && !st.keys.space) st.firing = false;
      }
    }
  }
  function reset(st) {
    st.ship.x = W / 2; st.ship.y = H - 70; st.ship.invuln = 0; st.ship.thrust = 0;
    st.bullets = []; st.bolts = []; st.asteroids = []; st.drones = []; st.bosses = []; st.powerups = [];
    st.particles = []; st.floaters = [];
    st.spawnQueue = []; st.spawnTimer = 0; st.betweenWaves = false; st.waveTimer = 0;
    st.score = 0; st.wave = 0; st.bestWave = 0; st.lives = 3; st.shotsFired = 0; st.kills = 0; st.grazes = 0; st.bossesDefeated = 0; st.combo = 0; st.comboMult = 1;
    st.gameOver = false; st.paused = false; st.rapidUntil = 0; st.spreadUntil = 0; st.shield = false;
    st.combo = 0; st.comboMult = 1; st.bestCombo = 0;
    st.powerupCounts = { shield: 0, rapid: 0, spread: 0, life: 0 };
    st.touch.joyId = null; st.touch.fireId = null; st.touch.dx = 0; st.touch.dy = 0;
    st.fireCd = 0;
    startWave(st);
    emitHud(st);
  }
  function keyName(ev) {
    var k = ev.key || '';
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') return 'left';
    if (k === 'ArrowRight' || k === 'd' || k === 'D') return 'right';
    if (k === 'ArrowUp' || k === 'w' || k === 'W') return 'up';
    if (k === 'ArrowDown' || k === 's' || k === 'S') return 'down';
    return null;
  }
  function init(viewport, opts) {
    opts = opts || {};
    var st = createState(opts);
    st.sessionId = opts.sessionId || null;
    st.sessionNonce = opts.sessionNonce || null;
    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    canvas.style.width = '100%'; canvas.style.maxWidth = W + 'px'; canvas.style.display = 'block';
    canvas.style.touchAction = 'none';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Space Shooter game board');
    viewport.innerHTML = '';
    viewport.appendChild(canvas);
    st.canvas = canvas; st.ctx = canvas.getContext('2d');
    st.bg = paintBackground();
    for (var si = 0; si < 70; si++) {
      st.stars.push({ x: Math.random() * W, y: Math.random() * H, speed: 24 + Math.random() * 60, size: 1 + Math.random() * 2, alpha: 0.3 + Math.random() * 0.6 });
    }
    if (opts.hero) { st.hero = opts.hero; }
    if (opts.bus) opts.bus.emit('game:start', 'space-shooter', opts.hero ? [opts.hero.id] : []);
    var onMove = function (ev) { var pos = canvasPos(st, ev); st.mouse.x = pos.x; st.mouse.y = pos.y; };
    var onDown = function (ev) { st.audio.unlock(); st.mouse.down = true; st.firing = true; var pos = canvasPos(st, ev); st.mouse.x = pos.x; st.mouse.y = pos.y; };
    var onUp = function () { st.mouse.down = false; if (!st.keys.space) st.firing = false; };
    var onKeyDown = function (ev) {
      var name = keyName(ev);
      if (name) { st.keys[name] = true; if (ev.preventDefault) ev.preventDefault(); return; }
      if (ev.key === ' ') { ev.preventDefault(); st.keys.space = true; st.firing = true; st.audio.unlock(); }
      else if (ev.key === 'p' || ev.key === 'P') { st.paused = !st.paused; emitHud(st); }
      else if (ev.key === 'r' || ev.key === 'R') { reset(st); }
    };
    var onKeyUp = function (ev) {
      var name = keyName(ev);
      if (name) { st.keys[name] = false; return; }
      if (ev.key === ' ') { st.keys.space = false; if (!st.mouse.down) st.firing = false; }
    };
    var onBlur = function () { st.keys = {}; st.firing = false; st.mouse.down = false; st.touch.joyId = null; st.touch.fireId = null; st.touch.dx = 0; st.touch.dy = 0; };
    var onTouchStart = function (ev) { handleTouchStart(st, ev); };
    var onTouchMove = function (ev) { handleTouchMove(st, ev); };
    var onTouchEnd = function (ev) { handleTouchEnd(st, ev); };
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('mouseup', onUp);
    canvas.addEventListener('touchstart', onTouchStart);
    canvas.addEventListener('touchmove', onTouchMove);
    canvas.addEventListener('touchend', onTouchEnd);
    canvas.addEventListener('touchcancel', onTouchEnd);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('blur', onBlur);
    st._listeners = { onMove: onMove, onDown: onDown, onUp: onUp, onTouchStart: onTouchStart, onTouchMove: onTouchMove, onTouchEnd: onTouchEnd, onKeyDown: onKeyDown, onKeyUp: onKeyUp, onBlur: onBlur };
    st.running = true; st.lastT = 0;
    startWave(st);
    st.rafId = (typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame(function (t) { loop(st, t); }) : setTimeout(function () { loop(st, Date.now()); }, 16));
    emitHud(st);
    var api = {
      state: st,
      setHero: function (hero) { st.hero = hero || null; emitHud(st); },
      setSession: function (sessionId, nonce) { st.sessionId = sessionId; st.sessionNonce = nonce; },
      pause: function () { st.paused = true; emitHud(st); },
      resume: function () { st.paused = false; emitHud(st); },
      startWave: function () { if (!st.gameOver) startWave(st); },
      getState: function () { return { score: st.score, wave: st.wave, lives: st.lives, gameOver: st.gameOver, shotsFired: st.shotsFired, kills: st.kills, accuracy: accuracyFor(st.shotsFired, st.kills), killsPerWave: killsPerWaveFor(st.kills, st.wave), shotsPerKill: shotsPerKillFor(st.shotsFired, st.kills), scorePerWave: scorePerWaveFor(st.score, st.wave), grazesPerWave: grazesPerWaveFor(st.grazes, st.wave), powerupsPerWave: powerupsPerWaveFor(st.powerupCounts, st.wave), shotsPerWave: shotsPerWaveFor(st.shotsFired, st.wave), bossesPerWave: bossesPerWaveFor(st.bossesDefeated || 0, st.wave), scorePerKill: scorePerKillFor(st.score, st.kills), grazesPerKill: grazesPerKillFor(st.grazes, st.kills), scorePerShot: scorePerShotFor(st.score, st.shotsFired), grazesPerShot: grazesPerShotFor(st.grazes, st.shotsFired), powerupsPerKill: powerupsPerKillFor(st.powerupCounts, st.kills), bossShare: bossShareFor(st.bossesDefeated || 0, st.kills), killsPerMinute: killsPerMinuteFor(st.kills, st.time), scorePerMinute: scorePerMinuteFor(st.score, st.time), grazesPerMinute: grazesPerMinuteFor(st.grazes, st.time), powerupsPerMinute: powerupsPerMinuteFor(st.powerupCounts, st.time), combo: st.combo, comboMult: st.comboMult, bestCombo: st.bestCombo, grazes: st.grazes, bestWave: st.bestWave || 0, shield: st.shield, spreadUntil: st.spreadUntil, rapidUntil: st.rapidUntil, bosses: st.bosses.length, bossesDefeated: st.bossesDefeated || 0, bossHp: st.bosses[0] ? st.bosses[0].hp : null, powerupCounts: st.powerupCounts, touchSeen: st.touch.seen, fps: st.fps, particleCap: particleCapFor(st.fps, st.fpsTarget, 400), dynFactor: st._dynFactor || 1, particles: st.particles.length }; },
      getHud: function () { return getHud(st); },
      destroy: function () { destroy(st); }
    };
    st._api = api;
    return api;
  }
  function destroy(st) {
    st.destroyed = true; st.running = false;
    if (typeof cancelAnimationFrame !== 'undefined') { try { cancelAnimationFrame(st.rafId); } catch (e) {} }
    else { try { clearTimeout(st.rafId); } catch (e) {} }
    if (st.canvas && st._listeners) {
      st.canvas.removeEventListener('mousemove', st._listeners.onMove);
      st.canvas.removeEventListener('mousedown', st._listeners.onDown);
      st.canvas.removeEventListener('mouseup', st._listeners.onUp);
      st.canvas.removeEventListener('touchstart', st._listeners.onTouchStart);
      st.canvas.removeEventListener('touchmove', st._listeners.onTouchMove);
      st.canvas.removeEventListener('touchend', st._listeners.onTouchEnd);
      st.canvas.removeEventListener('touchcancel', st._listeners.onTouchEnd);
    }
    if (st._listeners) {
      document.removeEventListener('keydown', st._listeners.onKeyDown);
      document.removeEventListener('keyup', st._listeners.onKeyUp);
      if (typeof window !== 'undefined' && window.removeEventListener) window.removeEventListener('blur', st._listeners.onBlur);
    }
    if (st.audio) st.audio.close();
    if (st.opts.bus) st.opts.bus.emit('game:ended', 'space-shooter', { score: st.score, wave: st.wave, kills: st.kills });
  }

  var manifest = { id: 'space-shooter', name: 'Space Shooter', version: '1.5.0', description: 'Arcade space shooter: dodge asteroids, blast drones, survive the waves. Power-ups, boss waves, combos, touch controls. Batch 21: graze bonus for skimming asteroids. Batch 22: shot accuracy stat. Batch 23: best wave tracked.', entry: 'shooter.js', canvas: true };

  global.SpaceShooter = { manifest: manifest, init: init, _createState: createState, _accuracyFor: accuracyFor, _killsPerWaveFor: killsPerWaveFor, _shotsPerKillFor: shotsPerKillFor, _scorePerWaveFor: scorePerWaveFor, _grazesPerWaveFor: grazesPerWaveFor, _powerupsPerWaveFor: powerupsPerWaveFor, _shotsPerWaveFor: shotsPerWaveFor, _bossesPerWaveFor: bossesPerWaveFor, _scorePerKillFor: scorePerKillFor, _grazesPerKillFor: grazesPerKillFor, _scorePerShotFor: scorePerShotFor, _grazesPerShotFor: grazesPerShotFor, _powerupsPerKillFor: powerupsPerKillFor, _bossShareFor: bossShareFor, _killsPerMinuteFor: killsPerMinuteFor, _scorePerMinuteFor: scorePerMinuteFor, _grazesPerMinuteFor: grazesPerMinuteFor, _powerupsPerMinuteFor: powerupsPerMinuteFor, _dynFactorFor: dynFactorFor, _particleCapFor: particleCapFor, _updateDynFactor: updateDynFactor, _spawnParticle: spawnParticle };
})(typeof window !== 'undefined' ? window : globalThis);

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
 * back. Waves get harder; clearing a wave pays a bonus. The equipped
 * hero (if any) boosts fire rate slightly and is otherwise cosmetic.
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
      bullets: [], bolts: [], asteroids: [], drones: [], powerups: [],
      particles: [], floaters: [], stars: [],
      spawnQueue: [], spawnTimer: 0, betweenWaves: false, waveTimer: 0,
      score: 0, wave: 0, lives: 3, shotsFired: 0, kills: 0,
      gameOver: false, shake: 0, rapidUntil: 0,
      hero: null, sessionId: null, sessionNonce: null,
      audio: makeAudio()
    };
  }
  function spawnParticle(st, x, y, color, n, speed) {
    for (var i = 0; i < (n || 8); i++) {
      if (st.particles.length > 400) st.particles.shift();
      var a = Math.random() * TAU, s = (speed || 90) * (0.4 + Math.random() * 0.9);
      st.particles.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.35 + Math.random() * 0.35, max: 0.7, color: color, size: 2 + Math.random() * 3 });
    }
  }
  function floater(st, x, y, text, color) { st.floaters.push({ x: x, y: y, text: text, color: color || '#ffd166', life: 0.9 }); }
  function fireInterval(st) {
    var base = 0.16;
    if (st.time < st.rapidUntil) base = 0.08;
    if (st.hero) base *= 0.85;
    return base;
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
      verts: verts, dead: false
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
    st.spawnTimer = 0.5;
    st.betweenWaves = false;
    floater(st, W / 2, 60, 'WAVE ' + st.wave, '#00f6ff');
    emitHud(st);
  }
  function spawnNext(st) {
    var kind = st.spawnQueue.shift();
    if (kind === 'drone') {
      st.drones.push(makeDrone(st, 60 + Math.random() * (W - 120), -30));
    } else {
      var size = Math.random() < 0.45 ? 'large' : Math.random() < 0.7 ? 'medium' : 'small';
      st.asteroids.push(makeAsteroid(st, 30 + Math.random() * (W - 60), -50, size));
    }
  }
  function damageShip(st) {
    if (st.ship.invuln > 0 || st.gameOver) return;
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
      if (st.opts.bus) st.opts.bus.emit('game:ended', 'space-shooter', { score: st.score, wave: st.wave });
    }
    emitHud(st);
  }
  function killAsteroid(st, a, byBullet) {
    a.dead = true;
    st.kills++;
    var gain = a.size === 'large' ? 20 : a.size === 'medium' ? 30 : 50;
    st.score += gain;
    floater(st, a.x, a.y, '+' + gain, '#ffd166');
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
    st.score += 100;
    floater(st, d.x, d.y, '+100', '#c792ea');
    spawnParticle(st, d.x, d.y, '#c792ea', 16, 140);
    st.audio.boom();
    if (Math.random() < 0.15) {
      st.powerups.push({ x: d.x, y: d.y, vy: 60, r: 13, life: 8, dead: false });
    }
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
    // ship movement
    var ax = 0, ay = 0;
    if (st.keys.left) ax -= 1;
    if (st.keys.right) ax += 1;
    if (st.keys.up) ay -= 1;
    if (st.keys.down) ay += 1;
    if (ax !== 0 || ay !== 0) {
      var len = Math.hypot(ax, ay);
      ship.x = clamp(ship.x + (ax / len) * 340 * dt, 24, W - 24);
      ship.y = clamp(ship.y + (ay / len) * 340 * dt, 50, H - 28);
      ship.thrust = 1;
    } else { ship.thrust = 0; }
    ship.angle = Math.atan2(st.mouse.y - ship.y, st.mouse.x - ship.x);
    // firing
    st.fireCd -= dt;
    if (st.firing && st.fireCd <= 0 && !st.gameOver) {
      var bx = ship.x + Math.cos(ship.angle) * 22, by = ship.y + Math.sin(ship.angle) * 22;
      st.bullets.push({ x: bx, y: by, vx: Math.cos(ship.angle) * 720, vy: Math.sin(ship.angle) * 720, life: 1.1, dead: false });
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
    // powerups
    for (i = st.powerups.length - 1; i >= 0; i--) {
      var p = st.powerups[i];
      p.y += p.vy * dt; p.life -= dt;
      if (p.life <= 0 || p.y > H + 30) { st.powerups.splice(i, 1); continue; }
      if (!st.gameOver && dist(p.x, p.y, ship.x, ship.y) <= p.r + ship.r) {
        st.powerups.splice(i, 1);
        if (st.lives < 5) { st.lives++; floater(st, ship.x, ship.y - 30, '+1 LIFE', '#3ddc5f'); }
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
      fl.life -= dt; fl.y -= 34 * dt;
      if (fl.life <= 0) st.floaters.splice(i, 1);
    }
    // wave clear
    if (!st.gameOver && !st.betweenWaves && !st.spawnQueue.length && !st.asteroids.length && !st.drones.length) {
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
  var _hudAcc = 0;
  function emitHudThrottled(st, dt) { _hudAcc += dt; if (_hudAcc > 0.25) { _hudAcc = 0; emitHud(st); } }
  function getHud(st) {
    return { score: st.score, wave: st.wave, lives: st.lives, gameOver: st.gameOver, shotsFired: st.shotsFired };
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
    for (i = 0; i < st.powerups.length; i++) {
      var p = st.powerups[i];
      ctx.fillStyle = '#ffd166'; ctx.font = 'bold 24px Arial'; ctx.textAlign = 'center';
      ctx.fillText('★', p.x, p.y);
    }
    for (i = 0; i < st.asteroids.length; i++) drawAsteroid(ctx, st.asteroids[i]);
    for (i = 0; i < st.drones.length; i++) drawDrone(ctx, st.drones[i], st.time);
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
      ctx.globalAlpha = Math.min(1, fl.life);
      ctx.fillStyle = fl.color; ctx.font = 'bold 16px Arial'; ctx.textAlign = 'center';
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
    if (st.time < st.rapidUntil) { ctx.fillStyle = '#00f6ff'; ctx.fillText('RAPID FIRE', 470, 22); }
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
      ctx.fillText('Score ' + st.score + '  •  Wave ' + st.wave + '  •  Kills ' + st.kills + '  •  Shots ' + st.shotsFired, W / 2, H / 2 + 26);
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
    if (st.running && !st.paused) update(st, dt);
    draw(st);
  }
  function canvasPos(st, ev) {
    var r = st.canvas.getBoundingClientRect();
    return { x: (ev.clientX - r.left) * (W / r.width), y: (ev.clientY - r.top) * (H / r.height) };
  }
  function reset(st) {
    st.ship.x = W / 2; st.ship.y = H - 70; st.ship.invuln = 0; st.ship.thrust = 0;
    st.bullets = []; st.bolts = []; st.asteroids = []; st.drones = []; st.powerups = [];
    st.particles = []; st.floaters = [];
    st.spawnQueue = []; st.spawnTimer = 0; st.betweenWaves = false; st.waveTimer = 0;
    st.score = 0; st.wave = 0; st.lives = 3; st.shotsFired = 0; st.kills = 0;
    st.gameOver = false; st.paused = false; st.rapidUntil = 0; st.fireCd = 0;
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
    var onBlur = function () { st.keys = {}; st.firing = false; st.mouse.down = false; };
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('mouseup', onUp);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('blur', onBlur);
    st._listeners = { onMove: onMove, onDown: onDown, onUp: onUp, onKeyDown: onKeyDown, onKeyUp: onKeyUp, onBlur: onBlur };
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
      getState: function () { return { score: st.score, wave: st.wave, lives: st.lives, gameOver: st.gameOver, shotsFired: st.shotsFired }; },
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
    }
    if (st._listeners) {
      document.removeEventListener('keydown', st._listeners.onKeyDown);
      document.removeEventListener('keyup', st._listeners.onKeyUp);
      if (typeof window !== 'undefined' && window.removeEventListener) window.removeEventListener('blur', st._listeners.onBlur);
    }
    if (st.audio) st.audio.close();
    if (st.opts.bus) st.opts.bus.emit('game:ended', 'space-shooter', { score: st.score, wave: st.wave });
  }

  var manifest = { id: 'space-shooter', name: 'Space Shooter', version: '1.0.0', description: 'Arcade space shooter: dodge asteroids, blast drones, survive the waves.', entry: 'shooter.js', canvas: true };

  global.SpaceShooter = { manifest: manifest, init: init, _createState: createState };
})(typeof window !== 'undefined' ? window : globalThis);

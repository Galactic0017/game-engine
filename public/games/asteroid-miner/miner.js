/* Asteroid Miner — playable Engine Hub module (Batch 14).
 *
 * Implements the IGameModule lifecycle the EngineHost requires:
 *   init(viewport, {bus, wallet, config, hero, player, onHud, onToast})
 *   destroy(), setHero(hero), getState(), getHud(), pause(), resume()
 *
 * Click an asteroid to strike it with the drill; hold and drag the
 * beam across rocks to keep mining. Mined ore goes into cargo — bank
 * it (B or the Bank button) to convert it to credits at the current
 * ore value. Six ore tiers (Iron -> ATOM Crystal) get rarer and more
 * valuable in deeper belts; clearing a belt's mining quota advances
 * the belt, which raises asteroid HP/value and shifts the ore mix.
 * Drill upgrades (Power / Auto-Drill / Scanner) are bought with
 * banked credits. Progress persists in localStorage per address;
 * ending a shift (E or End Shift) emits game:ended with final:true so
 * the shell can record the run on the server per-game leaderboard.
 *
 * Rendering is 100% procedural Canvas 2D. This module never talks to
 * a wallet or a server directly; all cross-module communication goes
 * through the event bus and the onHud/onToast callbacks.
 */
(function (global) {
  'use strict';

  var W = 960, H = 600, TAU = Math.PI * 2;
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var dist = function (x1, y1, x2, y2) { return Math.hypot(x2 - x1, y2 - y1); };

  var ORES = [
    { id: 'iron', name: 'Iron', color: '#b8a284', value: 5 },
    { id: 'nickel', name: 'Nickel', color: '#7bdff2', value: 12 },
    { id: 'cobalt', name: 'Cobalt', color: '#3b82f6', value: 25 },
    { id: 'gold', name: 'Gold', color: '#ffd166', value: 50 },
    { id: 'platinum', name: 'Platinum', color: '#e8ecf4', value: 95 },
    { id: 'atom', name: 'ATOM Crystal', color: '#c792ea', value: 220 }
  ];
  function oreById(id) {
    for (var i = 0; i < ORES.length; i++) if (ORES[i].id === id) return ORES[i];
    return ORES[0];
  }
  /* Ore mix shifts deeper: belt 1 is mostly iron/nickel; by belt 6
   * gold/platinum/atom are common. Weights are per-tier, belt-indexed. */
  function pickOre(belt) {
    var weights = ORES.map(function (o, i) {
      var base = [46, 28, 14, 7, 4, 1][i];
      var shift = (belt - 1) * [ -5, -3, 0, 2, 3, 3 ][i];
      return Math.max(1, base + shift);
    });
    var total = 0, i;
    for (i = 0; i < weights.length; i++) total += weights[i];
    var r = Math.random() * total;
    for (i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) return ORES[i]; }
    return ORES[0];
  }
  function beltQuota(belt) { return 6 + belt * 2; }
  function oreValueMult(scannerLevel) { return 1 + scannerLevel * 0.25; }

  /* Clickable canvas regions (also reachable by keyboard). */
  var BTNS = {
    power: { x: 20, y: 540, w: 210, h: 44 },
    auto: { x: 240, y: 540, w: 210, h: 44 },
    scanner: { x: 460, y: 540, w: 210, h: 44 },
    bank: { x: 690, y: 540, w: 120, h: 44 },
    endShift: { x: 820, y: 540, w: 120, h: 44 }
  };
  function upgradeCost(kind, level) {
    if (kind === 'power') return 50 * level;
    if (kind === 'auto') return 120 * (level + 1);
    return 80 * (level + 1); // scanner
  }
  function drillDamage(powerLevel) { return 2 + (powerLevel - 1) * 2; }
  function autoDps(autoLevel) { return autoLevel * 1.5; }

  function paintBackground() {
    var bg = document.createElement('canvas'); bg.width = W; bg.height = H;
    var b = bg.getContext('2d');
    var g = b.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#04060f'); g.addColorStop(0.6, '#0a1030'); g.addColorStop(1, '#160b33');
    b.fillStyle = g; b.fillRect(0, 0, W, H);
    var nebs = [['#50259c', 180, 120, 180], ['#00f6ff', 780, 380, 160]];
    for (var i = 0; i < nebs.length; i++) {
      var n = nebs[i];
      var rg = b.createRadialGradient(n[1], n[2], 10, n[1], n[2], n[3]);
      rg.addColorStop(0, n[0]); rg.addColorStop(1, 'rgba(0,0,0,0)');
      b.globalAlpha = 0.2; b.fillStyle = rg;
      b.beginPath(); b.arc(n[1], n[2], n[3], 0, TAU); b.fill();
    }
    b.globalAlpha = 1;
    for (i = 0; i < 280; i++) {
      b.fillStyle = 'rgba(255,255,255,' + (0.3 + Math.random() * 0.6) + ')';
      b.beginPath(); b.arc(Math.random() * W, Math.random() * H, 0.6 + Math.random() * 1.6, 0, TAU); b.fill();
    }
    return bg;
  }

  function createState(opts) {
    return {
      opts: opts || {},
      canvas: null, ctx: null, bg: null,
      running: false, paused: false, destroyed: false, rafId: 0, lastT: 0, time: 0,
      mouse: { x: W / 2, y: 240, down: false },
      mining: false, mineTarget: null, mineCd: 0, beamFlash: 0,
      asteroids: [], particles: [], floaters: [],
      belt: 1, mined: 0, quota: beltQuota(1), totalMined: 0, richVeins: 0,
      ore: { iron: 0, nickel: 0, cobalt: 0, gold: 0, platinum: 0, atom: 0 },
      credits: 0, bankedValue: 0,
      powerLevel: 1, autoLevel: 0, scannerLevel: 0,
      bestBelt: 1, bestValue: 0,
      shiftEnded: false, shiftCount: 0,
      hero: null, address: 'guest', saveKey: null,
      fps: 0, fpsTarget: 60, _fpsN: 0, _fpsT: 0, _dynFactor: 1,
      _hudAcc: 0
    };
  }
  function saveKeyFor(address) { return 'game_miner_' + (address || 'guest'); }
  function loadSave(st) {
    var store = null;
    try { store = (typeof localStorage !== 'undefined') ? localStorage : null; } catch (e) { store = null; }
    if (!store) return;
    try {
      var raw = store.getItem(st.saveKey);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (d && typeof d === 'object') {
        if (typeof d.credits === 'number') st.credits = d.credits;
        if (typeof d.powerLevel === 'number') st.powerLevel = Math.max(1, d.powerLevel);
        if (typeof d.autoLevel === 'number') st.autoLevel = d.autoLevel;
        if (typeof d.scannerLevel === 'number') st.scannerLevel = d.scannerLevel;
        if (typeof d.bestBelt === 'number') st.bestBelt = Math.max(1, d.bestBelt);
        if (typeof d.bestValue === 'number') st.bestValue = d.bestValue;
        if (typeof d.totalMined === 'number') st.totalMined = d.totalMined;
        if (d.ore) for (var k in st.ore) if (typeof d.ore[k] === 'number') st.ore[k] = d.ore[k];
      }
    } catch (e) {}
  }
  function persist(st) {
    var store = null;
    try { store = (typeof localStorage !== 'undefined') ? localStorage : null; } catch (e) { store = null; }
    if (!store || !st.saveKey) return;
    try {
      store.setItem(st.saveKey, JSON.stringify({
        credits: st.credits, powerLevel: st.powerLevel, autoLevel: st.autoLevel,
        scannerLevel: st.scannerLevel, bestBelt: st.bestBelt, bestValue: st.bestValue,
        totalMined: st.totalMined, ore: st.ore
      }));
    } catch (e) {}
  }
  function cargoValue(st) {
    var v = 0;
    for (var i = 0; i < ORES.length; i++) v += (st.ore[ORES[i].id] || 0) * ORES[i].value;
    return Math.round(v * oreValueMult(st.scannerLevel));
  }
  /* Batch 15: dynamic quality — particle cap follows measured FPS.
   * Same mapping as BTD/Shooter (1 / 0.6 / 0.35, step-up hysteresis). */
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
    var cap = Math.max(40, Math.round(300 * (st._dynFactor || 1)));
    for (var i = 0; i < (n || 8); i++) {
      if (st.particles.length > cap) st.particles.shift();
      var a = Math.random() * TAU, s = (speed || 90) * (0.4 + Math.random() * 0.9);
      st.particles.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.35 + Math.random() * 0.35, max: 0.7, color: color, size: 2 + Math.random() * 3 });
    }
  }
  function floater(st, x, y, text, color) { st.floaters.push({ x: x, y: y, text: text, color: color || '#ffd166', life: 0.9, vy: -60, size: 16 }); }
  function makeAsteroid(st, x, y, forceOre) {
    var verts = [], n = 9 + Math.floor(Math.random() * 3), i;
    for (i = 0; i < n; i++) verts.push(0.72 + Math.random() * 0.45);
    var ore = forceOre || pickOre(st.belt);
    var hpMult = 1 + (st.belt - 1) * 0.35;
    var hp = Math.max(2, Math.round((3 + ORES.indexOf(ore) * 2) * hpMult));
    return {
      kind: 'asteroid', ore: ore.id, x: x, y: y,
      vx: (Math.random() - 0.5) * 26, vy: 10 + Math.random() * 16 + st.belt * 2,
      r: 26 + Math.random() * 18, hp: hp, maxHp: hp,
      rot: Math.random() * TAU, rotSpd: (Math.random() - 0.5) * 1.2,
      verts: verts, dead: false, flash: 0
    };
  }
  function spawnBelt(st) {
    st.asteroids = [];
    var count = 5 + Math.min(4, st.belt);
    for (var i = 0; i < count; i++) {
      st.asteroids.push(makeAsteroid(st, 60 + Math.random() * (W - 120), 50 + Math.random() * 380));
    }
    st.quota = beltQuota(st.belt);
    st.mined = 0;
  }
  function asteroidAt(st, x, y) {
    for (var i = st.asteroids.length - 1; i >= 0; i--) {
      var a = st.asteroids[i];
      if (!a.dead && dist(x, y, a.x, a.y) <= a.r + 4) return a;
    }
    return null;
  }
  function damageAsteroid(st, a, dmg, byAuto) {
    if (a.dead) return;
    a.hp -= dmg; a.flash = 0.12; st.beamFlash = 0.1;
    spawnParticle(st, a.x, a.y, oreById(a.ore).color, 3, 70);
    if (a.hp <= 0) mineAsteroid(st, a, byAuto);
  }
  function mineAsteroid(st, a, byAuto) {
    a.dead = true;
    st.ore[a.ore] = (st.ore[a.ore] || 0) + 1;
    st.mined++; st.totalMined++;
    var ore = oreById(a.ore);
    /* Batch 21: rich vein — every 10th mined rock yields a bonus ore
     * of the same type. Deterministic on totalMined, so it cannot
     * double-pay for one rock. */
    if (st.totalMined % 10 === 0) {
      st.richVeins++;
      st.ore[a.ore]++;
      floater(st, a.x, a.y - 24, 'RICH VEIN +1 ' + ore.name, '#ffd166');
    }
    spawnParticle(st, a.x, a.y, ore.color, 16, 150);
    floater(st, a.x, a.y, '+1 ' + ore.name + (byAuto ? ' (auto)' : ''), ore.color);
    if (st.mined >= st.quota) advanceBelt(st);
    emitHud(st);
    persist(st);
  }
  function advanceBelt(st) {
    var bonus = 40 + st.belt * 20;
    st.credits += bonus;
    st.belt++;
    st.bestBelt = Math.max(st.bestBelt, st.belt);
    floater(st, W / 2, 90, 'BELT ' + st.belt + '  +' + bonus + ' credits', '#3ddc5f');
    if (st.opts.bus) st.opts.bus.emit('game:wave_completed', st.belt, { score: st.bankedValue, kills: st.totalMined });
    spawnBelt(st);
    emitHud(st);
    persist(st);
  }
  function buyUpgrade(st, kind) {
    var level = kind === 'power' ? st.powerLevel : kind === 'auto' ? st.autoLevel : st.scannerLevel;
    var cost = upgradeCost(kind, level);
    if (st.credits < cost) {
      if (st.opts.onToast) st.opts.onToast('Not enough credits: ' + cost + ' needed.', 'err');
      return false;
    }
    st.credits -= cost;
    if (kind === 'power') st.powerLevel++;
    else if (kind === 'auto') st.autoLevel++;
    else st.scannerLevel++;
    if (st.opts.onToast) st.opts.onToast((kind === 'power' ? 'Drill Power' : kind === 'auto' ? 'Auto-Drill' : 'Scanner') + ' upgraded.', 'ok');
    emitHud(st);
    persist(st);
    return true;
  }
  function bankOre(st) {
    var v = cargoValue(st);
    if (v <= 0) {
      if (st.opts.onToast) st.opts.onToast('Cargo is empty — mine an asteroid first.', 'err');
      return 0;
    }
    for (var k in st.ore) st.ore[k] = 0;
    st.credits += v; st.bankedValue += v;
    st.bestValue = Math.max(st.bestValue, st.bankedValue);
    floater(st, W / 2, 120, 'BANKED +' + v + ' credits', '#ffd166');
    if (st.opts.onToast) st.opts.onToast('Banked ' + v + ' credits of ore.', 'ok');
    emitHud(st);
    persist(st);
    return v;
  }
  function endShift(st) {
    if (st.shiftEnded) return;
    st.shiftEnded = true; st.shiftCount++;
    bankOre(st);
    if (st.opts.bus) st.opts.bus.emit('game:ended', 'asteroid-miner', { score: st.bankedValue, wave: st.belt, kills: st.totalMined, final: true });
    emitHud(st);
    persist(st);
  }
  function reset(st) {
    st.asteroids = []; st.particles = []; st.floaters = [];
    st.belt = 1; st.mined = 0; st.totalMined = 0; st.bankedValue = 0; st.richVeins = 0;
    st.ore = { iron: 0, nickel: 0, cobalt: 0, gold: 0, platinum: 0, atom: 0 };
    // Drill upgrades + credits persist across shifts (they are in the local save).
    st.mining = false; st.mineTarget = null; st.shiftEnded = false; st.paused = false;
    spawnBelt(st);
    emitHud(st);
    persist(st);
  }
  function update(st, dt) {
    st.time += dt;
    if (st.beamFlash > 0) st.beamFlash -= dt;
    // Hold-to-mine: the rock under the cursor takes drill damage.
    if (st.mining && !st.paused) {
      var target = asteroidAt(st, st.mouse.x, st.mouse.y);
      st.mineTarget = target;
      if (target) {
        st.mineCd -= dt;
        if (st.mineCd <= 0) { damageAsteroid(st, target, drillDamage(st.powerLevel), false); st.mineCd = 0.22; }
      }
    }
    // Auto-drill: passive damage to the nearest rock.
    if (st.autoLevel > 0) {
      var nearest = null, nd = 1e9, i;
      for (i = 0; i < st.asteroids.length; i++) {
        var a = st.asteroids[i];
        if (a.dead) continue;
        var d = dist(a.x, a.y, W / 2, H - 60);
        if (d < nd) { nd = d; nearest = a; }
      }
      if (nearest) damageAsteroid(st, nearest, autoDps(st.autoLevel) * dt, true);
    }
    for (i = st.asteroids.length - 1; i >= 0; i--) {
      var as = st.asteroids[i];
      if (as.flash > 0) as.flash -= dt;
      as.x += as.vx * dt; as.y += as.vy * dt; as.rot += as.rotSpd * dt;
      if (as.x < as.r) { as.x = as.r; as.vx = Math.abs(as.vx); }
      if (as.x > W - as.r) { as.x = W - as.r; as.vx = -Math.abs(as.vx); }
      if (as.y > H - 80) { st.asteroids.splice(i, 1); continue; }
    }
    st.asteroids = st.asteroids.filter(function (a) { return !a.dead; });
    // Keep the belt populated: replace drifted-off rocks.
    var want = 5 + Math.min(4, st.belt);
    if (st.asteroids.length < want) st.asteroids.push(makeAsteroid(st, 60 + Math.random() * (W - 120), -30));
    for (i = st.particles.length - 1; i >= 0; i--) {
      var pa = st.particles[i];
      pa.life -= dt; pa.x += pa.vx * dt; pa.y += pa.vy * dt; pa.vx *= 0.94; pa.vy *= 0.94;
      if (pa.life <= 0) st.particles.splice(i, 1);
    }
    for (i = st.floaters.length - 1; i >= 0; i--) {
      var fl = st.floaters[i];
      fl.life -= dt; fl.y += fl.vy * dt;
      if (fl.life <= 0) st.floaters.splice(i, 1);
    }
    st._hudAcc += dt;
    if (st._hudAcc > 0.25) { st._hudAcc = 0; emitHud(st); }
  }
  function emitHud(st) { if (st.opts.onHud) st.opts.onHud(getHud(st)); }
  function getHud(st) {
    return {
      belt: st.belt, mined: st.mined, quota: st.quota, totalMined: st.totalMined, richVeins: st.richVeins,
      ore: st.ore, cargoValue: cargoValue(st), credits: st.credits,
      bankedValue: st.bankedValue, powerLevel: st.powerLevel, autoLevel: st.autoLevel,
      scannerLevel: st.scannerLevel, bestBelt: st.bestBelt, bestValue: st.bestValue,
      shiftEnded: st.shiftEnded, asteroids: st.asteroids.length,
      drillDamage: drillDamage(st.powerLevel),
      costs: { power: upgradeCost('power', st.powerLevel), auto: upgradeCost('auto', st.autoLevel), scanner: upgradeCost('scanner', st.scannerLevel) }
    };
  }
  function getState(st) {
    return {
      belt: st.belt, mined: st.mined, quota: st.quota, totalMined: st.totalMined, richVeins: st.richVeins,
      ore: st.ore, cargoValue: cargoValue(st), credits: st.credits,
      bankedValue: st.bankedValue, powerLevel: st.powerLevel, autoLevel: st.autoLevel,
      scannerLevel: st.scannerLevel, bestBelt: st.bestBelt, bestValue: st.bestValue,
      shiftEnded: st.shiftEnded, shiftCount: st.shiftCount, asteroids: st.asteroids.length,
      paused: st.paused, fps: st.fps, particleCap: particleCapFor(st.fps, st.fpsTarget, 300), dynFactor: st._dynFactor || 1, particles: st.particles.length
    };
  }

  /* ---- Drawing ---- */
  function drawAsteroid(ctx, a) {
    ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(a.rot);
    var ore = oreById(a.ore);
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
    ctx.strokeStyle = a.flash > 0 ? '#ffffff' : 'rgba(0,0,0,.4)'; ctx.lineWidth = a.flash > 0 ? 3 : 1.5; ctx.stroke();
    // ore flecks in the tier colour
    ctx.fillStyle = ore.color;
    ctx.beginPath(); ctx.arc(-a.r * 0.3, a.r * 0.2, a.r * 0.18, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(a.r * 0.35, -a.r * 0.25, a.r * 0.14, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(a.r * 0.1, a.r * 0.4, a.r * 0.11, 0, TAU); ctx.fill();
    // HP ring
    ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, a.r + 6, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0, a.hp / a.maxHp)); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center';
    ctx.fillText(ore.name, 0, -a.r - 12);
    ctx.restore();
  }
  function drawButton(ctx, b, label, sub, enabled) {
    ctx.fillStyle = enabled ? 'rgba(20,32,64,.9)' : 'rgba(20,32,64,.45)';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = enabled ? '#00f6ff' : 'rgba(255,255,255,.25)'; ctx.lineWidth = 1.5;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = enabled ? '#fff' : '#8a93a8'; ctx.font = 'bold 13px Arial'; ctx.textAlign = 'center';
    ctx.fillText(label, b.x + b.w / 2, b.y + 19);
    ctx.fillStyle = '#9fb4d8'; ctx.font = '11px Arial';
    ctx.fillText(sub, b.x + b.w / 2, b.y + 35);
  }
  function draw(st) {
    var ctx = st.ctx;
    ctx.save();
    ctx.drawImage(st.bg, 0, 0);
    // drill rig at the bottom centre
    ctx.fillStyle = '#1b2a4e';
    ctx.fillRect(W / 2 - 70, H - 62, 140, 16);
    ctx.fillStyle = '#00f6ff';
    ctx.fillRect(W / 2 - 8, H - 82, 16, 22);
    ctx.fillStyle = '#ffd166';
    ctx.beginPath(); ctx.arc(W / 2, H - 82, 7, 0, TAU); ctx.fill();
    // mining beam: rig -> cursor rock while holding
    if (st.mining && st.mineTarget && !st.mineTarget.dead) {
      ctx.strokeStyle = st.beamFlash > 0 ? 'rgba(255,209,102,.95)' : 'rgba(0,246,255,.7)';
      ctx.lineWidth = st.beamFlash > 0 ? 5 : 3;
      ctx.beginPath(); ctx.moveTo(W / 2, H - 82); ctx.lineTo(st.mineTarget.x, st.mineTarget.y); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      ctx.beginPath(); ctx.arc(st.mineTarget.x, st.mineTarget.y, 5, 0, TAU); ctx.fill();
    }
    for (var i = 0; i < st.asteroids.length; i++) drawAsteroid(ctx, st.asteroids[i]);
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
      ctx.fillStyle = fl.color; ctx.font = 'bold ' + fl.size + 'px Arial'; ctx.textAlign = 'center';
      if (ctx.strokeText) { ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 3; ctx.strokeText(fl.text, fl.x, fl.y); }
      ctx.fillText(fl.text, fl.x, fl.y);
    }
    ctx.globalAlpha = 1;
    // top bar
    ctx.fillStyle = 'rgba(5,8,20,.55)'; ctx.fillRect(0, 0, W, 34);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 15px Arial'; ctx.textAlign = 'left';
    ctx.fillText('BELT ' + st.belt + '  •  MINED ' + st.mined + '/' + st.quota, 14, 22);
    ctx.fillStyle = '#ffd166';
    ctx.fillText('CREDITS ' + st.credits, 250, 22);
    ctx.fillStyle = '#7bdff2';
    ctx.fillText('CARGO ' + cargoValue(st) + 'cr', 420, 22);
    ctx.fillStyle = '#c792ea';
    ctx.fillText('DRILL Lv' + st.powerLevel + ' (' + drillDamage(st.powerLevel) + ' dmg)', 580, 22);
    ctx.fillStyle = '#9fb4d8'; ctx.font = '13px Arial'; ctx.textAlign = 'right';
    ctx.fillText('Click/drag to mine • 1/2/3 upgrades • B bank • E end shift • P pause • R restart', W - 12, 22);
    // belt progress bar
    ctx.fillStyle = 'rgba(5,8,20,.7)'; ctx.fillRect(14, 42, 300, 10);
    ctx.fillStyle = '#3ddc5f'; ctx.fillRect(14, 42, 300 * Math.min(1, st.mined / st.quota), 10);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(14, 42, 300, 10);
    // ore legend
    ctx.font = '12px Arial'; ctx.textAlign = 'left';
    var lx = 340;
    for (i = 0; i < ORES.length; i++) {
      ctx.fillStyle = ORES[i].color;
      ctx.fillText(ORES[i].name + ' x' + (st.ore[ORES[i].id] || 0), lx, 51);
      lx += 102;
    }
    // upgrade / action bar
    drawButton(ctx, BTNS.power, '1 · Drill Power Lv' + st.powerLevel, 'Cost ' + upgradeCost('power', st.powerLevel) + 'cr · ' + drillDamage(st.powerLevel) + ' dmg', st.credits >= upgradeCost('power', st.powerLevel));
    drawButton(ctx, BTNS.auto, '2 · Auto-Drill Lv' + st.autoLevel, 'Cost ' + upgradeCost('auto', st.autoLevel) + 'cr', st.credits >= upgradeCost('auto', st.autoLevel));
    drawButton(ctx, BTNS.scanner, '3 · Scanner Lv' + st.scannerLevel, 'Cost ' + upgradeCost('scanner', st.scannerLevel) + 'cr · +' + Math.round(oreValueMult(st.scannerLevel) * 100 - 100) + '% value', st.credits >= upgradeCost('scanner', st.scannerLevel));
    drawButton(ctx, BTNS.bank, 'B · Bank', cargoValue(st) + 'cr in cargo', cargoValue(st) > 0);
    drawButton(ctx, BTNS.endShift, 'E · End Shift', st.shiftEnded ? 'Shift saved' : 'Save bests', !st.shiftEnded);
    if (st.paused) {
      ctx.fillStyle = 'rgba(5,8,20,.6)'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 36px Arial'; ctx.textAlign = 'center';
      ctx.fillText('PAUSED', W / 2, H / 2);
    }
    if (st.shiftEnded) {
      ctx.fillStyle = 'rgba(5,8,20,.55)'; ctx.fillRect(0, 0, W, 34);
      ctx.fillStyle = '#3ddc5f'; ctx.font = 'bold 14px Arial'; ctx.textAlign = 'center';
      ctx.fillText('Shift ended — bests saved. Press R for a new shift, or keep mining.', W / 2, 22);
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
  function hitButton(pos) {
    for (var k in BTNS) {
      var b = BTNS[k];
      if (pos.x >= b.x && pos.x <= b.x + b.w && pos.y >= b.y && pos.y <= b.y + b.h) return k;
    }
    return null;
  }
  function init(viewport, opts) {
    opts = opts || {};
    var st = createState(opts);
    st.address = (opts.player && opts.player.address) || 'guest';
    st.saveKey = saveKeyFor(st.address);
    loadSave(st);
    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    canvas.style.width = '100%'; canvas.style.maxWidth = W + 'px'; canvas.style.display = 'block';
    canvas.style.touchAction = 'none';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Asteroid Miner game board');
    viewport.innerHTML = '';
    viewport.appendChild(canvas);
    st.canvas = canvas; st.ctx = canvas.getContext('2d');
    st.bg = paintBackground();
    if (opts.hero) { st.hero = opts.hero; }
    if (opts.bus) opts.bus.emit('game:start', 'asteroid-miner', opts.hero ? [opts.hero.id] : []);
    var onMove = function (ev) { var pos = canvasPos(st, ev); st.mouse.x = pos.x; st.mouse.y = pos.y; };
    var onDown = function (ev) {
      var pos = canvasPos(st, ev); st.mouse.x = pos.x; st.mouse.y = pos.y;
      var btn = hitButton(pos);
      if (btn === 'power') return buyUpgrade(st, 'power');
      if (btn === 'auto') return buyUpgrade(st, 'auto');
      if (btn === 'scanner') return buyUpgrade(st, 'scanner');
      if (btn === 'bank') return bankOre(st);
      if (btn === 'endShift') return endShift(st);
      st.mining = true; st.mineCd = 0;
      var target = asteroidAt(st, pos.x, pos.y);
      if (target) damageAsteroid(st, target, drillDamage(st.powerLevel), false);
    };
    var onUp = function () { st.mining = false; st.mineTarget = null; };
    var onKeyDown = function (ev) {
      if (ev.key === '1') buyUpgrade(st, 'power');
      else if (ev.key === '2') buyUpgrade(st, 'auto');
      else if (ev.key === '3') buyUpgrade(st, 'scanner');
      else if (ev.key === 'b' || ev.key === 'B') bankOre(st);
      else if (ev.key === 'e' || ev.key === 'E') endShift(st);
      else if (ev.key === 'p' || ev.key === 'P') { st.paused = !st.paused; emitHud(st); }
      else if (ev.key === 'r' || ev.key === 'R') reset(st);
    };
    var onBlur = function () { st.mining = false; st.mineTarget = null; };
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('mouseup', onUp);
    document.addEventListener('keydown', onKeyDown);
    if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('blur', onBlur);
    st._listeners = { onMove: onMove, onDown: onDown, onUp: onUp, onKeyDown: onKeyDown, onBlur: onBlur };
    st.running = true; st.lastT = 0;
    spawnBelt(st);
    st.rafId = (typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame(function (t) { loop(st, t); }) : setTimeout(function () { loop(st, Date.now()); }, 16));
    emitHud(st);
    var api = {
      state: st,
      setHero: function (hero) { st.hero = hero || null; emitHud(st); },
      pause: function () { st.paused = true; emitHud(st); },
      resume: function () { st.paused = false; emitHud(st); },
      buyUpgrade: function (kind) { return buyUpgrade(st, kind); },
      bankOre: function () { return bankOre(st); },
      endShift: function () { endShift(st); },
      getState: function () { return getState(st); },
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
      if (typeof window !== 'undefined' && window.removeEventListener) window.removeEventListener('blur', st._listeners.onBlur);
    }
    persist(st);
    if (st.opts.bus) st.opts.bus.emit('game:ended', 'asteroid-miner', { score: st.bankedValue, wave: st.belt, kills: st.totalMined });
  }

  var manifest = { id: 'asteroid-miner', name: 'Asteroid Miner', version: '1.2.0', description: 'Click/drag mining: 6 ore tiers, drill upgrades, belt progression. Local save + server bests. Batch 21: rich-vein bonus ore every 10th rock.', entry: 'miner.js', canvas: true };

  global.AsteroidMiner = { manifest: manifest, init: init, _createState: createState, _ORES: ORES, _pickOre: pickOre, _beltQuota: beltQuota, _upgradeCost: upgradeCost, _cargoValue: cargoValue, _dynFactorFor: dynFactorFor, _particleCapFor: particleCapFor, _updateDynFactor: updateDynFactor, _spawnParticle: spawnParticle };
})(typeof window !== 'undefined' ? window : globalThis);

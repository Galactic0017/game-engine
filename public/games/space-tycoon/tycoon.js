/* Space Tycoon — small Engine Hub module (local save only).
 * Rigs earn credits per second; offline earnings use the same formula
 * as the spec: sum over rigs of elapsedSeconds * outputRate, capped at
 * 8 hours offline. Overseers are owned hero IDs (optional boost).
 * Batch 17: prestige reset (permanent +25% multiplier per prestige)
 * and rig skins (bought with credits, persisted per address).
 * This module never posts to the server: earnings stay in this game.
 */
(function (global) {
  'use strict';
  var RIG_DEFS = [
    { id: 'rig-1', name: 'Drill Rig', cost: 100, outputRate: 1 },
    { id: 'rig-2', name: 'Laser Rig', cost: 500, outputRate: 6 },
    { id: 'rig-3', name: 'Quantum Rig', cost: 2500, outputRate: 35 },
    { id: 'rig-4', name: 'Void Rig', cost: 12000, outputRate: 200 }
  ];
  var SKIN_DEFS = [
    { id: 'standard', name: 'Standard Rig', cost: 0, color: '#8ecae6' },
    { id: 'gold', name: 'Gold Rig', cost: 1000, color: '#ffd166' },
    { id: 'void', name: 'Void Rig', cost: 2500, color: '#c792ea' }
  ];
  var OFFLINE_CAP_SEC = 8 * 3600;
  var PRESTIGE_COST = 5000;
  function prestigeMultiplierFor(count) { return 1 + 0.25 * (count || 0); }
  function canPrestige(state) { return Math.floor(state.credits || 0) >= PRESTIGE_COST; }
  /* Batch 23: prestige progress — percent toward PRESTIGE_COST plus
   * credits remaining, so the panel can show how close prestige is
   * without re-deriving the cost. Exposed in state as
   * prestigeProgress { pct, remaining, canPrestige }. */
  function prestigeProgressFor(credits) {
    var c = Math.max(0, Math.floor(credits || 0));
    return { pct: Math.min(100, Math.round(c / PRESTIGE_COST * 100)), remaining: Math.max(0, PRESTIGE_COST - c), canPrestige: c >= PRESTIGE_COST };
  }
  /* Batch 24: earnings rate — credits per second from the
   * current rigs, after the prestige multiplier and the
   * overseer boost (the same formula render() shows as
   * Rate). To one decimal. Exposed in state as earningsRate;
   * the panel already displays this number as Rate. */
  function earningsRateFor(rigs, prestigeCount, overseerCount) {
    var rate = 0;
    for (var i = 0; i < (rigs || []).length; i++) rate += (rigs[i].outputRate || 0) * (rigs[i].level || 1);
    var boost = (overseerCount ? 1 + overseerCount * 0.1 : 1) * prestigeMultiplierFor(prestigeCount);
    return Math.round(rate * boost * 10) / 10;
  }
  /* Batch 26: seconds to prestige — whole seconds until
   * PRESTIGE_COST credits at the given earnings rate (credits
   * already held count). 0 when prestige is already
   * affordable, null when the rate is zero and it is not
   * (no rigs earning yet). Exposed in state as
   * secondsToPrestige; the panel shows it as an estimate
   * beside the prestige progress line. */
  function secondsToPrestigeFor(credits, rate) {
    var c = Math.max(0, Math.floor(credits || 0));
    if (c >= PRESTIGE_COST) return 0;
    if (!rate || rate <= 0) return null;
    return Math.ceil((PRESTIGE_COST - c) / rate);
  }
  function calcOfflineEarnings(rigs, elapsedSeconds, multiplier) {
    var capped = Math.min(Math.max(0, Math.floor(elapsedSeconds)), OFFLINE_CAP_SEC);
    var total = 0;
    for (var i = 0; i < rigs.length; i++) total += capped * (rigs[i].outputRate || 0) * (rigs[i].level || 1);
    return String(Math.floor(total * (multiplier || 1)));
  }
  function loadSave(address) {
    try { var raw = global.localStorage && global.localStorage.getItem('game_tycoon_' + (address || 'guest')); if (raw) return JSON.parse(raw); } catch (e) {}
    return { credits: 200, rigs: [], lastCollected: Date.now(), overseers: [] };
  }
  function normalizeSave(s) {
    s.credits = s.credits || 0; s.rigs = s.rigs || []; s.overseers = s.overseers || [];
    s.prestigeCount = s.prestigeCount || 0; s.lifetimeEarned = s.lifetimeEarned || 0;
    s.skin = s.skin || 'standard'; s.skinOwned = s.skinOwned || ['standard'];
    if (s.skinOwned.indexOf('standard') < 0) s.skinOwned.push('standard');
    return s;
  }
  function saveState(address, s) { try { if (global.localStorage) global.localStorage.setItem('game_tycoon_' + (address || 'guest'), JSON.stringify(s)); } catch (e) {} }
  function skinFor(id) { for (var i = 0; i < SKIN_DEFS.length; i++) if (SKIN_DEFS[i].id === id) return SKIN_DEFS[i]; return SKIN_DEFS[0]; }
  function init(viewport, opts) {
    opts = opts || {};
    var address = (opts.player && opts.player.address) || (opts.wallet && opts.wallet.address) || 'guest';
    var state = normalizeSave(loadSave(address));
    var now = Date.now();
    var mult = prestigeMultiplierFor(state.prestigeCount);
    var offline = calcOfflineEarnings(state.rigs, (now - (state.lastCollected || now)) / 1000, mult);
    if (Number(offline) > 0) { state.credits += Number(offline); state.lifetimeEarned += Number(offline); }
    state.lastCollected = now;
    var destroyed = false, timer = null;
    function boost() {
      var overseerBoost = state.overseers.length ? 1 + state.overseers.length * 0.1 : 1;
      return overseerBoost * prestigeMultiplierFor(state.prestigeCount);
    }
    function doPrestige() {
      if (!canPrestige(state)) return false;
      state.prestigeCount++;
      state.credits = 200; state.rigs = []; state.overseers = [];
      state.lastCollected = Date.now(); saveState(address, state); render();
      if (opts.onToast) opts.onToast('Prestige ' + state.prestigeCount + '! Permanent +' + Math.round((prestigeMultiplierFor(state.prestigeCount) - 1) * 100) + '% earnings.', 'ok');
      return true;
    }
    function buySkin(skinId) {
      var skin = skinFor(skinId);
      if (state.skinOwned.indexOf(skin.id) >= 0) { state.skin = skin.id; saveState(address, state); render(); return true; }
      if (state.credits < skin.cost) return false;
      state.credits -= skin.cost; state.skinOwned.push(skin.id); state.skin = skin.id;
      saveState(address, state); render();
      if (opts.onToast) opts.onToast(skin.name + ' equipped!', 'ok');
      return true;
    }
    function render() {
      var rate = 0; state.rigs.forEach(function (r) { rate += (r.outputRate || 0) * (r.level || 1); });
      var skin = skinFor(state.skin);
      var prog = prestigeProgressFor(state.credits);
      var secToPrestige = secondsToPrestigeFor(state.credits, earningsRateFor(state.rigs, state.prestigeCount, state.overseers.length));
      var html = '<div class="miniGame"><h2>🛰 Space Tycoon</h2><p class="muted">Local save only — rig earnings stay in this game.</p>'
        + '<p><strong>Credits:</strong> ' + Math.floor(state.credits) + ' &nbsp; <strong>Rate:</strong> ' + (rate * boost()).toFixed(1) + '/s'
        + ' &nbsp; <strong>Prestige:</strong> ' + state.prestigeCount + ' (x' + prestigeMultiplierFor(state.prestigeCount).toFixed(2) + ')'
        + ' &nbsp; <strong>Lifetime:</strong> ' + Math.floor(state.lifetimeEarned) + '</p>'
        + (Number(offline) > 0 ? '<p class="ok">Welcome back! Offline earnings: +' + offline + ' credits (capped at 8h).</p>' : '')
        + '<p><strong>Rig skin:</strong> ' + skin.name + ' — ' + SKIN_DEFS.map(function (sk) {
          var owned = state.skinOwned.indexOf(sk.id) >= 0;
          var label = sk.id === state.skin ? sk.name + ' (equipped)' : owned ? 'Equip ' + sk.name : 'Buy ' + sk.name + ' — ' + sk.cost;
          return '<button data-skin="' + sk.id + '" ' + (!owned && state.credits < sk.cost ? 'disabled' : '') + '>' + label + '</button>';
        }).join(' ') + '</p>'
        + '<div class="rigRow">' + RIG_DEFS.map(function (d) {
          var owned = state.rigs.find(function (r) { return r.id === d.id; });
          var cost = owned ? Math.floor(d.cost * Math.pow(1.8, owned.level)) : d.cost;
          return '<div class="rigCard" style="border-color:' + skin.color + '"><strong>' + d.name + '</strong><br>Level ' + (owned ? owned.level : 0) + ' · ' + d.outputRate + '/s per level<br><button data-buy="' + d.id + '" ' + (state.credits < cost ? 'disabled' : '') + '>Buy / Upgrade — ' + cost + '</button></div>';
        }).join('') + '</div>'
        + '<p><button id="tycCollect">Collect now</button> <button id="tycOverseer">Assign my hero as overseer (+10%)</button> <button id="tycPrestige" ' + (canPrestige(state) ? '' : 'disabled') + '>Prestige — reset for +25% forever (' + PRESTIGE_COST + ' credits)</button></p>'
        + '<p class="muted">Prestige progress: ' + prog.pct + '% — ' + (prog.remaining > 0 ? prog.remaining + ' credits to go.' : 'ready to prestige!') + (secToPrestige != null && secToPrestige > 0 ? ' About ' + secToPrestige + 's at the current rate.' : '') + '</p>'
        + '<p class="muted">Overseers: ' + (state.overseers.length ? state.overseers.join(', ') : 'none') + '</p></div>';
      viewport.innerHTML = html;
      viewport.querySelectorAll('[data-buy]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var def = RIG_DEFS.find(function (d) { return d.id === btn.getAttribute('data-buy'); });
          var owned = state.rigs.find(function (r) { return r.id === def.id; });
          var cost = owned ? Math.floor(def.cost * Math.pow(1.8, owned.level)) : def.cost;
          if (state.credits < cost) return;
          state.credits -= cost;
          if (owned) owned.level++; else state.rigs.push({ id: def.id, level: 1, outputRate: def.outputRate, lastCollected: Date.now() });
          state.lastCollected = Date.now(); saveState(address, state); render();
          if (opts.onToast) opts.onToast(def.name + ' upgraded!', 'ok');
        });
      });
      viewport.querySelectorAll('[data-skin]').forEach(function (btn) {
        btn.addEventListener('click', function () { buySkin(btn.getAttribute('data-skin')); });
      });
      var collect = viewport.querySelector('#tycCollect');
      if (collect) collect.addEventListener('click', function () { collectEarnings(); render(); });
      var ov = viewport.querySelector('#tycOverseer');
      if (ov) ov.addEventListener('click', function () {
        var hero = opts.hero; if (!hero) { if (opts.onToast) opts.onToast('Equip a hero first (My Heroes).', 'warn'); return; }
        if (state.overseers.indexOf(hero.id) < 0) state.overseers.push(hero.id);
        saveState(address, state); render();
      });
      var pr = viewport.querySelector('#tycPrestige');
      if (pr) pr.addEventListener('click', function () { doPrestige(); });
    }
    function collectEarnings() {
      var now2 = Date.now(); var earned = Number(calcOfflineEarnings(state.rigs, (now2 - state.lastCollected) / 1000, prestigeMultiplierFor(state.prestigeCount)));
      earned = Math.floor(earned * (state.overseers.length ? 1 + state.overseers.length * 0.1 : 1));
      state.credits += earned; state.lifetimeEarned += earned; state.lastCollected = now2; saveState(address, state);
      if (opts.onToast) opts.onToast('Collected +' + earned + ' credits.', 'ok');
      return earned;
    }
    function tick() { if (destroyed) return; state.credits += 0; state.lastCollected = state.lastCollected; saveState(address, state); }
    render();
    timer = setInterval(function () { if (destroyed) return; var n = Date.now(); var e = Number(calcOfflineEarnings(state.rigs, (n - state.lastCollected) / 1000, prestigeMultiplierFor(state.prestigeCount))); var b = state.overseers.length ? 1 + state.overseers.length * 0.1 : 1; var earned = Math.floor(e * b); state.credits += earned; state.lifetimeEarned += earned; state.lastCollected = n; saveState(address, state); render(); }, 5000);
    if (opts.bus) opts.bus.emit('game:start', 'space-tycoon', []);
    return {
      state: state,
      getState: function () { return { credits: Math.floor(state.credits), rigs: state.rigs, overseers: state.overseers, prestigeCount: state.prestigeCount, prestigeMultiplier: prestigeMultiplierFor(state.prestigeCount), prestigeProgress: prestigeProgressFor(state.credits), earningsRate: earningsRateFor(state.rigs, state.prestigeCount, state.overseers.length), secondsToPrestige: secondsToPrestigeFor(Math.floor(state.credits), earningsRateFor(state.rigs, state.prestigeCount, state.overseers.length)), lifetimeEarned: Math.floor(state.lifetimeEarned), skin: state.skin, skinOwned: state.skinOwned.slice() }; },
      prestige: doPrestige,
      buySkin: buySkin,
      collectEarnings: collectEarnings,
      destroy: function () { destroyed = true; if (timer) clearInterval(timer); if (opts.bus) opts.bus.emit('game:ended', 'space-tycoon', {}); }
    };
  }
  global.SpaceTycoon = { manifest: { id: 'space-tycoon', name: 'Space Tycoon' }, init: init, calculateOfflineEarnings: calcOfflineEarnings, RIG_DEFS: RIG_DEFS, SKIN_DEFS: SKIN_DEFS, PRESTIGE_COST: PRESTIGE_COST, _prestigeMultiplierFor: prestigeMultiplierFor, _canPrestige: canPrestige, _prestigeProgressFor: prestigeProgressFor, _earningsRateFor: earningsRateFor, _secondsToPrestigeFor: secondsToPrestigeFor, _normalizeSave: normalizeSave };
})(typeof window !== 'undefined' ? window : globalThis);

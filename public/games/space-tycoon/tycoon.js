/* Space Tycoon — small Engine Hub module (local save only).
 * Rigs earn credits per second; offline earnings use the same formula
 * as the spec: sum over rigs of elapsedSeconds * outputRate, capped at
 * 8 hours offline. Overseers are owned hero IDs (optional boost).
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
  var OFFLINE_CAP_SEC = 8 * 3600;
  function calcOfflineEarnings(rigs, elapsedSeconds) {
    var capped = Math.min(Math.max(0, Math.floor(elapsedSeconds)), OFFLINE_CAP_SEC);
    var total = 0;
    for (var i = 0; i < rigs.length; i++) total += capped * (rigs[i].outputRate || 0) * (rigs[i].level || 1);
    return String(Math.floor(total));
  }
  function loadSave(address) {
    try { var raw = global.localStorage && global.localStorage.getItem('game_tycoon_' + (address || 'guest')); if (raw) return JSON.parse(raw); } catch (e) {}
    return { credits: 200, rigs: [], lastCollected: Date.now(), overseers: [] };
  }
  function saveState(address, s) { try { if (global.localStorage) global.localStorage.setItem('game_tycoon_' + (address || 'guest'), JSON.stringify(s)); } catch (e) {} }
  function init(viewport, opts) {
    opts = opts || {};
    var address = (opts.player && opts.player.address) || (opts.wallet && opts.wallet.address) || 'guest';
    var state = loadSave(address);
    var now = Date.now();
    var offline = calcOfflineEarnings(state.rigs, (now - (state.lastCollected || now)) / 1000);
    if (Number(offline) > 0) { state.credits += Number(offline); }
    state.lastCollected = now;
    var destroyed = false, timer = null;
    function render() {
      var rate = 0; state.rigs.forEach(function (r) { rate += (r.outputRate || 0) * (r.level || 1); });
      var overseerBoost = state.overseers.length ? 1 + state.overseers.length * 0.1 : 1;
      var html = '<div class="miniGame"><h2>🛰 Space Tycoon</h2><p class="muted">Local save only — rig earnings stay in this game.</p>'
        + '<p><strong>Credits:</strong> ' + Math.floor(state.credits) + ' &nbsp; <strong>Rate:</strong> ' + (rate * overseerBoost).toFixed(1) + '/s</p>'
        + (Number(offline) > 0 ? '<p class="ok">Welcome back! Offline earnings: +' + offline + ' credits (capped at 8h).</p>' : '')
        + '<div class="rigRow">' + RIG_DEFS.map(function (d) {
          var owned = state.rigs.find(function (r) { return r.id === d.id; });
          var cost = owned ? Math.floor(d.cost * Math.pow(1.8, owned.level)) : d.cost;
          return '<div class="rigCard"><strong>' + d.name + '</strong><br>Level ' + (owned ? owned.level : 0) + ' · ' + d.outputRate + '/s per level<br><button data-buy="' + d.id + '" ' + (state.credits < cost ? 'disabled' : '') + '>Buy / Upgrade — ' + cost + '</button></div>';
        }).join('') + '</div>'
        + '<p><button id="tycCollect">Collect now</button> <button id="tycOverseer">Assign my hero as overseer (+10%)</button></p>'
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
      var collect = viewport.querySelector('#tycCollect');
      if (collect) collect.addEventListener('click', function () { collectEarnings(); render(); });
      var ov = viewport.querySelector('#tycOverseer');
      if (ov) ov.addEventListener('click', function () {
        var hero = opts.hero; if (!hero) { if (opts.onToast) opts.onToast('Equip a hero first (My Heroes).', 'warn'); return; }
        if (state.overseers.indexOf(hero.id) < 0) state.overseers.push(hero.id);
        saveState(address, state); render();
      });
    }
    function collectEarnings() {
      var now2 = Date.now(); var earned = Number(calcOfflineEarnings(state.rigs, (now2 - state.lastCollected) / 1000));
      var boost = state.overseers.length ? 1 + state.overseers.length * 0.1 : 1;
      earned = Math.floor(earned * boost);
      state.credits += earned; state.lastCollected = now2; saveState(address, state);
      if (opts.onToast) opts.onToast('Collected +' + earned + ' credits.', 'ok');
      return earned;
    }
    function tick() { if (destroyed) return; state.credits += 0; state.lastCollected = state.lastCollected; saveState(address, state); }
    render();
    timer = setInterval(function () { if (destroyed) return; var n = Date.now(); var e = Number(calcOfflineEarnings(state.rigs, (n - state.lastCollected) / 1000)); var boost = state.overseers.length ? 1 + state.overseers.length * 0.1 : 1; state.credits += Math.floor(e * boost); state.lastCollected = n; saveState(address, state); render(); }, 5000);
    if (opts.bus) opts.bus.emit('game:start', 'space-tycoon', []);
    return {
      getState: function () { return { credits: Math.floor(state.credits), rigs: state.rigs, overseers: state.overseers }; },
      destroy: function () { destroyed = true; if (timer) clearInterval(timer); if (opts.bus) opts.bus.emit('game:ended', 'space-tycoon', {}); }
    };
  }
  global.SpaceTycoon = { manifest: { id: 'space-tycoon', name: 'Space Tycoon' }, init: init, calculateOfflineEarnings: calcOfflineEarnings, RIG_DEFS: RIG_DEFS };
})(typeof window !== 'undefined' ? window : globalThis);

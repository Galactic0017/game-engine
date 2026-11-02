/* ATOM Core Clicker — small Engine Hub module (local save only).
 * Tap the core for shards. Random multiplier surges (2x, 10s) reward
 * active play. A session proof hash (SHA-256 over clicks:shards:nonce)
 * is shown so a score can be checked — it is display-only evidence,
 * not server-verified credit.
 * Batch 17: combo streaks (clicks within 1.5s chain; +10% per 10
 * streak, capped 3x), golden shard events (+10 per click for 8s),
 * Save Best (best combo recorded on the server leaderboard via
 * game:ended final), and shard conversion (100 banked shards ->
 * 10 in-game credits via POST /api/convert-shards).
 */
(function (global) {
  'use strict';
  var COMBO_WINDOW_MS = 1500;
  var GOLDEN_CHANCE = 0.015;
  var GOLDEN_MS = 8000;
  var GOLDEN_BONUS = 10;
  var SHARD_CONVERSION = { shardsPerChunk: 100, creditsPerChunk: 10, minShards: 100, maxShards: 5000 };
  function comboMultiplier(streak) { return Math.min(3, 1 + 0.1 * Math.floor((streak || 0) / 10)); }
  function clickGain(state, now) {
    var surging = now < (state.surgeUntil || 0);
    var gain = Math.floor((surging ? 2 : 1) * comboMultiplier(state.combo || 0));
    if (now < (state.goldenUntil || 0)) gain += GOLDEN_BONUS;
    return gain;
  }
  function convertShards(banked) {
    var chunks = Math.floor((banked || 0) / SHARD_CONVERSION.shardsPerChunk);
    var shards = chunks * SHARD_CONVERSION.shardsPerChunk;
    return { chunks: chunks, shards: shards, credits: chunks * SHARD_CONVERSION.creditsPerChunk, remainder: (banked || 0) - shards };
  }
  function cyrb53(str, seedNum) { var h1 = 0xdeadbeef ^ seedNum, h2 = 0x41c6ce57 ^ seedNum; for (var i = 0; i < str.length; i++) { var ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); } h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909); h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909); return (h2 >>> 0).toString(16) + (h1 >>> 0).toString(16); }
  async function sha256Hex(text) { try { if (global.crypto && global.crypto.subtle) { var buf = await global.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)); return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); } } catch (e) {} return 'fallback:' + cyrb53(text, 0); }
  function init(viewport, opts) {
    opts = opts || {};
    var address = (opts.player && opts.player.address) || (opts.wallet && opts.wallet.address) || 'guest';
    var key = 'game_clicker_' + address;
    var state = { shards: 0, clicks: 0, banked: 0, nonce: Math.random().toString(16).slice(2), combo: 0, bestCombo: 0, lastClickAt: 0, surgeUntil: 0, goldenUntil: 0, goldenEvents: 0 };
    try { var raw = global.localStorage && global.localStorage.getItem(key); if (raw) state = JSON.parse(raw); } catch (e) {}
    state.combo = state.combo || 0; state.bestCombo = state.bestCombo || 0; state.lastClickAt = state.lastClickAt || 0;
    state.surgeUntil = state.surgeUntil || 0; state.goldenUntil = state.goldenUntil || 0; state.goldenEvents = state.goldenEvents || 0;
    var destroyed = false, proof = '…', surgeTimer = null, savedOnce = false;
    function persist() { try { if (global.localStorage) global.localStorage.setItem(key, JSON.stringify(state)); } catch (e) {} }
    async function refreshProof() { proof = await sha256Hex(state.clicks + ':' + state.shards + ':' + state.nonce); var el = viewport.querySelector('#clkProof'); if (el) el.textContent = proof.slice(0, 24) + '…'; }
    function clickCore(now) {
      now = now || Date.now();
      if (now - state.lastClickAt <= COMBO_WINDOW_MS && state.lastClickAt) state.combo++; else state.combo = 1;
      state.lastClickAt = now;
      if (state.combo > state.bestCombo) state.bestCombo = state.combo;
      var gain = clickGain(state, now);
      state.clicks++; state.shards += gain;
      if (Math.random() < GOLDEN_CHANCE && now >= state.goldenUntil) { state.goldenUntil = now + GOLDEN_MS; state.goldenEvents++; if (opts.onToast) opts.onToast('Golden shard! +10 per click for 8s.', 'ok'); }
      if (Math.random() < 0.02 && now >= state.surgeUntil) { state.surgeUntil = now + 10000; if (opts.onToast) opts.onToast('Multiplier surge! 2x for 10s.', 'ok'); }
      persist(); render(); refreshProof();
      return gain;
    }
    function endSession() {
      if (savedOnce) return null;
      savedOnce = true;
      var payload = { final: true, score: state.bestCombo, wave: 0, clicks: state.clicks, shards: state.banked, bestCombo: state.bestCombo };
      if (opts.bus) opts.bus.emit('game:ended', 'atom-clicker', payload);
      if (opts.onToast) opts.onToast('Best combo saved: ' + state.bestCombo + '.', 'ok');
      return payload;
    }
    async function convertBanked() {
      var conv = convertShards(state.banked);
      if (conv.chunks <= 0) { if (opts.onToast) opts.onToast('Bank 100+ shards first to convert.', 'warn'); return null; }
      var playerAddress = (opts.player && opts.player.address) || (opts.wallet && opts.wallet.address) || null;
      if (!playerAddress || playerAddress === 'guest' || typeof global.fetch !== 'function') { if (opts.onToast) opts.onToast('Connect your wallet to convert shards to credits.', 'warn'); return null; }
      try {
        var res = await global.fetch('/api/convert-shards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: playerAddress, shards: conv.shards }) });
        var data = null; try { data = await res.json(); } catch (e) {}
        if (!res.ok || !data || typeof data.credits !== 'number') { if (opts.onToast) opts.onToast((data && data.error) || 'Conversion failed.', 'err'); return null; }
        state.banked = conv.remainder; persist(); render(); refreshProof();
        if (opts.onToast) opts.onToast('Converted ' + conv.shards + ' shards → +' + data.credits + ' credits.', 'ok');
        return data;
      } catch (e) { if (opts.onToast) opts.onToast('Conversion failed (offline?).', 'err'); return null; }
    }
    function render() {
      var now = Date.now();
      var surging = now < state.surgeUntil;
      var golden = now < state.goldenUntil;
      var conv = convertShards(state.banked);
      viewport.innerHTML = '<div class="miniGame"><h2>⚛ ATOM Core Clicker</h2><p class="muted">Local save only — shards stay in this game until converted.</p>'
        + '<p><strong>Shards:</strong> ' + state.shards + ' &nbsp; <strong>Banked:</strong> ' + state.banked + ' &nbsp; <strong>Clicks:</strong> ' + state.clicks + '</p>'
        + '<p>Multiplier: <strong>' + (surging ? '2x SURGE!' : '1x') + '</strong>' + (surging ? ' (' + Math.ceil((state.surgeUntil - now) / 1000) + 's left)' : '')
        + ' &nbsp; Combo: <strong>x' + comboMultiplier(state.combo).toFixed(1) + '</strong> (' + state.combo + ' streak, best ' + state.bestCombo + ')</p>'
        + (golden ? '<p class="ok">✨ GOLDEN SHARD! +10 per click (' + Math.ceil((state.goldenUntil - now) / 1000) + 's left)</p>' : '')
        + '<button id="clkCore" style="font-size:44px;padding:26px 34px;border-radius:50%;">⚛</button>'
        + '<p><button id="clkBank">Bank shards</button> <button id="clkConvert" ' + (conv.chunks <= 0 ? 'disabled' : '') + '>Convert ' + conv.shards + ' shards → +' + conv.credits + ' credits</button> <button id="clkSave">Save best combo</button></p>'
        + '<p class="muted">100 banked shards = 10 credits. Session proof: <code id="clkProof">' + proof.slice(0, 24) + '…</code></p></div>';
      var core = viewport.querySelector('#clkCore');
      if (core) core.addEventListener('click', function () { clickCore(); });
      var bankBtn = viewport.querySelector('#clkBank');
      if (bankBtn) bankBtn.addEventListener('click', function () { state.banked += state.shards; state.shards = 0; persist(); render(); refreshProof(); if (opts.onToast) opts.onToast('Shards banked.', 'ok'); });
      var convBtn = viewport.querySelector('#clkConvert');
      if (convBtn) convBtn.addEventListener('click', function () { convertBanked(); });
      var saveBtn = viewport.querySelector('#clkSave');
      if (saveBtn) saveBtn.addEventListener('click', function () { endSession(); });
    }
    render(); refreshProof();
    surgeTimer = setInterval(function () { if (destroyed) return; render(); }, 1000);
    if (opts.bus) opts.bus.emit('game:start', 'atom-clicker', []);
    return {
      state: state,
      click: clickCore,
      endSession: endSession,
      convertBanked: convertBanked,
      getState: function () { return { shards: state.shards, banked: state.banked, clicks: state.clicks, proof: proof, combo: state.combo, bestCombo: state.bestCombo, goldenActive: Date.now() < state.goldenUntil, goldenEvents: state.goldenEvents, surgeUntil: state.surgeUntil }; },
      destroy: function () { destroyed = true; if (surgeTimer) clearInterval(surgeTimer); if (opts.bus) opts.bus.emit('game:ended', 'atom-clicker', {}); }
    };
  }
  global.AtomClicker = { manifest: { id: 'atom-clicker', name: 'ATOM Core Clicker' }, init: init, _comboMultiplier: comboMultiplier, _clickGain: clickGain, _convertShards: convertShards, SHARD_CONVERSION: SHARD_CONVERSION, COMBO_WINDOW_MS: COMBO_WINDOW_MS, GOLDEN_BONUS: GOLDEN_BONUS };
})(typeof window !== 'undefined' ? window : globalThis);

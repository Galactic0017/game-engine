/* ATOM Core Clicker — small Engine Hub module (local save only).
 * Tap the core for shards. Random multiplier surges (2x, 10s) reward
 * active play. A session proof hash (SHA-256 over clicks:shards:nonce)
 * is shown so a score can be checked — it is display-only evidence,
 * not server-verified credit.
 */
(function (global) {
  'use strict';
  function cyrb53(str, seedNum) { var h1 = 0xdeadbeef ^ seedNum, h2 = 0x41c6ce57 ^ seedNum; for (var i = 0; i < str.length; i++) { var ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); } h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909); h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909); return (h2 >>> 0).toString(16) + (h1 >>> 0).toString(16); }
  async function sha256Hex(text) { try { if (global.crypto && global.crypto.subtle) { var buf = await global.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)); return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); } } catch (e) {} return 'fallback:' + cyrb53(text, 0); }
  function init(viewport, opts) {
    opts = opts || {};
    var address = (opts.player && opts.player.address) || 'guest';
    var key = 'game_clicker_' + address;
    var state = { shards: 0, clicks: 0, banked: 0, nonce: Math.random().toString(16).slice(2) };
    try { var raw = global.localStorage && global.localStorage.getItem(key); if (raw) state = JSON.parse(raw); } catch (e) {}
    var mult = 1, surgeUntil = 0, surgeTimer = null, destroyed = false, proof = '…';
    function persist() { try { if (global.localStorage) global.localStorage.setItem(key, JSON.stringify(state)); } catch (e) {} }
    async function refreshProof() { proof = await sha256Hex(state.clicks + ':' + state.shards + ':' + state.nonce); var el = viewport.querySelector('#clkProof'); if (el) el.textContent = proof.slice(0, 24) + '…'; }
    function render() {
      var surging = Date.now() < surgeUntil;
      viewport.innerHTML = '<div class="miniGame"><h2>⚛ ATOM Core Clicker</h2><p class="muted">Local save only — shards stay in this game.</p>'
        + '<p><strong>Shards:</strong> ' + state.shards + ' &nbsp; <strong>Banked:</strong> ' + state.banked + ' &nbsp; <strong>Clicks:</strong> ' + state.clicks + '</p>'
        + '<p>Multiplier: <strong>' + (surging ? '2x SURGE!' : '1x') + '</strong>' + (surging ? ' (' + Math.ceil((surgeUntil - Date.now()) / 1000) + 's left)' : '') + '</p>'
        + '<button id="clkCore" style="font-size:44px;padding:26px 34px;border-radius:50%;">⚛</button>'
        + '<p><button id="clkBank">Bank shards</button></p>'
        + '<p class="muted">Session proof: <code id="clkProof">' + proof.slice(0, 24) + '…</code></p></div>';
      var core = viewport.querySelector('#clkCore');
      core.addEventListener('click', function () {
        state.clicks++; state.shards += (Date.now() < surgeUntil ? 2 : 1);
        if (Math.random() < 0.02 && Date.now() >= surgeUntil) { surgeUntil = Date.now() + 10000; if (opts.onToast) opts.onToast('Multiplier surge! 2x for 10s.', 'ok'); }
        persist(); render(); refreshProof();
      });
      viewport.querySelector('#clkBank').addEventListener('click', function () { state.banked += state.shards; state.shards = 0; persist(); render(); refreshProof(); if (opts.onToast) opts.onToast('Shards banked.', 'ok'); });
    }
    render(); refreshProof();
    surgeTimer = setInterval(function () { if (destroyed) return; render(); }, 1000);
    if (opts.bus) opts.bus.emit('game:start', 'atom-clicker', []);
    return {
      getState: function () { return { shards: state.shards, banked: state.banked, clicks: state.clicks, proof: proof }; },
      destroy: function () { destroyed = true; if (surgeTimer) clearInterval(surgeTimer); if (opts.bus) opts.bus.emit('game:ended', 'atom-clicker', {}); }
    };
  }
  global.AtomClicker = { manifest: { id: 'atom-clicker', name: 'ATOM Core Clicker' }, init: init };
})(typeof window !== 'undefined' ? window : globalThis);

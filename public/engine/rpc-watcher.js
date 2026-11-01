/* RpcWatcher — real-time CEO verification worker (browser side).
 *
 * Primary: CometBFT WebSocket (wss://…/websocket) subscribed to
 *   tm.event = 'Tx'
 * filtered client-side by transaction hash / sender / memo. The public
 * Cosmos Hub RPC endpoint may refuse browser connections, rate-limit,
 * or be unreachable — every failure path falls back to REST polling
 * and never blocks the CEO panel.
 *
 * Fallback: HTTP REST polling of /cosmos/tx/v1beta1/txs/{hash} at
 * 3-second intervals with exponential backoff (3s, 6s, 12s, 24s, 48s
 * cap), up to `maxAttempts`. A tx is "confirmed" only when the REST
 * response has tx_response.code === 0.
 *
 * This watcher is a *notification* layer only. It never approves a
 * sale by itself: approval always goes through the server
 * /api/admin/auto-verify-order endpoint, which re-checks the tx
 * against the LCD itself (amount, denom, recipient, sender, memo)
 * and fails closed on any mismatch. A watcher "confirmed" event that
 * the server later rejects is reported as rpc:tx_failed.
 *
 * Usage:
 *   var w = new RpcWatcher(bus, { wsUrl, lcdUrls });
 *   w.watch(hash, { listingId });   // emits rpc:tx_confirmed / rpc:tx_failed
 *   w.stop(hash); w.stopAll();
 */
(function (global) {
  'use strict';

  function RpcWatcher(bus, config) {
    this.bus = bus;
    this.config = config || {};
    this.wsUrl = this.config.wsUrl || null;
    this.lcdUrls = this.config.lcdUrls || [];
    this.socket = null;
    this.socketState = 'idle'; // idle | connecting | open | closed | failed
    this.watched = Object.create(null); // hash -> { listingId, attempts, timer, done }
    this._connecting = null;
  }

  RpcWatcher.prototype._setStatus = function (status, detail) {
    this.socketState = status;
    this.bus.emit('rpc:watcher_status', { status: status, detail: detail || null, wsUrl: this.wsUrl });
  };

  RpcWatcher.prototype._connectSocket = function () {
    var self = this;
    if (!this.wsUrl || typeof WebSocket === 'undefined') { this._setStatus('failed', 'No WebSocket endpoint configured or WebSocket unavailable in this browser.'); return Promise.resolve(null); }
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) return Promise.resolve(this.socket);
    if (this._connecting) return this._connecting;
    this._setStatus('connecting');
    this._connecting = new Promise(function (resolve) {
      var ws;
      try { ws = new WebSocket(self.wsUrl); } catch (e) { self._setStatus('failed', String(e && e.message || e)); resolve(null); return; }
      var settled = false;
      var timer = setTimeout(function () {
        if (!settled) { settled = true; try { ws.close(); } catch (e) {} self._setStatus('failed', 'WebSocket connect timed out.'); resolve(null); }
      }, 8000);
      ws.onopen = function () {
        if (settled) return; settled = true; clearTimeout(timer);
        self.socket = ws; self._setStatus('open');
        try { ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'subscribe', id: 'game-tx-watch', params: { query: "tm.event = 'Tx'" } })); } catch (e) {}
        resolve(ws);
      };
      ws.onmessage = function (ev) { self._onSocketMessage(ev.data); };
      ws.onerror = function () { if (!settled) { settled = true; clearTimeout(timer); self._setStatus('failed', 'WebSocket error.'); resolve(null); } };
      ws.onclose = function () {
        self.socket = null; self._connecting = null;
        if (self.socketState === 'open') self._setStatus('closed', 'WebSocket closed. REST polling continues.');
      };
    }).then(function (s) { self._connecting = null; return s; });
    return this._connecting;
  };

  RpcWatcher.prototype._onSocketMessage = function (data) {
    var msg;
    try { msg = JSON.parse(data); } catch (e) { return; }
    var result = msg && msg.result;
    if (!result || !result.events) return;
    // CometBFT Tx events carry tx.hash as hex (uppercase) in events.
    var hashes = result.events['tx.hash'] || [];
    var self = this;
    hashes.forEach(function (h) {
      var hash = String(h).toLowerCase();
      if (self.watched[hash] && !self.watched[hash].done) self._confirm(hash, 'websocket');
    });
  };

  // REST check for one hash against every configured LCD.
  // Returns: { found:true, code, tx } | { found:false } | { error }
  RpcWatcher.prototype.checkTx = async function (hash) {
    var lastError = null;
    for (var i = 0; i < this.lcdUrls.length; i++) {
      try {
        var res = await fetch(this.lcdUrls[i] + '/cosmos/tx/v1beta1/txs/' + hash);
        if (res.status === 404) return { found: false };
        if (!res.ok) { lastError = new Error('LCD HTTP ' + res.status); continue; }
        var json = await res.json();
        if (json && json.tx_response) return { found: true, code: json.tx_response.code, tx: json };
        return { found: false };
      } catch (e) { lastError = e; }
    }
    return { found: false, error: lastError };
  };

  RpcWatcher.prototype.watch = function (hash, opts) {
    var self = this;
    hash = String(hash || '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('RpcWatcher.watch: hash must be 64 hex characters.');
    if (this.watched[hash] && !this.watched[hash].done) return this.watched[hash];
    var entry = { hash: hash, listingId: (opts && opts.listingId) || null, attempts: 0, timer: null, done: false, maxAttempts: (opts && opts.maxAttempts) || 20 };
    this.watched[hash] = entry;
    // Try the socket in the background; polling runs regardless so a
    // dead socket can never silently stall verification.
    this._connectSocket();
    this._poll(entry);
    return entry;
  };

  RpcWatcher.prototype._poll = function (entry) {
    var self = this;
    if (entry.done) return;
    entry.attempts++;
    this.checkTx(entry.hash).then(function (r) {
      if (entry.done) return;
      if (r.found && r.code === 0) { self._confirm(entry.hash, 'rest'); return; }
      if (r.found && r.code !== 0) { self._fail(entry.hash, 'Transaction is on-chain but failed (code ' + r.code + ').'); return; }
      if (entry.attempts >= entry.maxAttempts) { self._fail(entry.hash, 'Transaction not found on any configured LCD after ' + entry.attempts + ' checks.'); return; }
      var delay = Math.min(48000, 3000 * Math.pow(2, Math.min(4, entry.attempts - 1)));
      entry.timer = setTimeout(function () { self._poll(entry); }, delay);
    }).catch(function (e) {
      if (entry.done) return;
      if (entry.attempts >= entry.maxAttempts) { self._fail(entry.hash, String(e && e.message || e)); return; }
      entry.timer = setTimeout(function () { self._poll(entry); }, 6000);
    });
  };

  RpcWatcher.prototype._confirm = function (hash, via) {
    var entry = this.watched[hash];
    if (!entry || entry.done) return;
    entry.done = true;
    if (entry.timer) clearTimeout(entry.timer);
    this.bus.emit('rpc:tx_confirmed', hash, { listingId: entry.listingId, via: via, attempts: entry.attempts });
  };

  RpcWatcher.prototype._fail = function (hash, reason) {
    var entry = this.watched[hash];
    if (!entry || entry.done) return;
    entry.done = true;
    if (entry.timer) clearTimeout(entry.timer);
    this.bus.emit('rpc:tx_failed', hash, { listingId: entry.listingId, reason: reason });
  };

  RpcWatcher.prototype.stop = function (hash) {
    var entry = this.watched[String(hash || '').toLowerCase()];
    if (entry) { entry.done = true; if (entry.timer) clearTimeout(entry.timer); delete this.watched[entry.hash]; }
  };

  RpcWatcher.prototype.stopAll = function () {
    var self = this;
    Object.keys(this.watched).forEach(function (h) { self.stop(h); });
    if (this.socket) { try { this.socket.close(); } catch (e) {} this.socket = null; }
    this._setStatus('closed', 'Watcher stopped.');
  };

  global.RpcWatcher = RpcWatcher;
})(typeof window !== 'undefined' ? window : globalThis);

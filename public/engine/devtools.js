/* GameDevTools — debug console + performance monitor (Batch 7, Pillar 5).
 *
 * Press `~` (Backquote) to toggle the overlay. The overlay shows a
 * live FPS graph (last 60 frame times), frame time, entity/particle/
 * grid counts from the active game, and JS heap size when the browser
 * exposes performance.memory (Chrome); other browsers honestly show
 * "n/a". A command line accepts: help, fps, stats, entities, mem,
 * version, clear. Commands are string-matched only — no eval.
 *
 * The core (recordFrame / getStats / exec) has no DOM dependency and
 * is unit-testable; DOM work is guarded so loading this file in Node
 * or a VM harness never throws. Sampling reads
 * window.GAME_CTX.host.current.handle.getDebugStats() when available
 * and falls back to getHud()/getState() — never to invented numbers.
 */
(function (global) {
  'use strict';

  var HISTORY = 60;
  function DevTools(opts) {
    this.opts = opts || {};
    this.open = false;
    this.frames = []; // ms per frame, newest last
    this.fps = 0; this.avgMs = 0; this.maxMs = 0;
    this.counts = {};
    this.logLines = [];
    this.el = null; this.canvas = null; this.statsEl = null; this.logEl = null;
    this._timer = null; this._keyHandler = null;
  }
  DevTools.prototype.recordFrame = function (ms, counts) {
    if (typeof ms !== 'number' || !isFinite(ms) || ms < 0) return;
    this.frames.push(ms);
    if (this.frames.length > HISTORY) this.frames.shift();
    var sum = 0, max = 0;
    for (var i = 0; i < this.frames.length; i++) { sum += this.frames[i]; if (this.frames[i] > max) max = this.frames[i]; }
    this.avgMs = this.frames.length ? Math.round(sum / this.frames.length * 10) / 10 : 0;
    this.maxMs = Math.round(max * 10) / 10;
    this.fps = this.avgMs > 0 ? Math.round(1000 / this.avgMs) : 0;
    if (counts) this.counts = counts;
  };
  DevTools.prototype.memoryMB = function () {
    try {
      if (typeof performance !== 'undefined' && performance.memory && typeof performance.memory.usedJSHeapSize === 'number') {
        return Math.round(performance.memory.usedJSHeapSize / 1048576 * 10) / 10;
      }
    } catch (e) {}
    return null;
  };
  DevTools.prototype.getStats = function () {
    var c = this.counts || {};
    return {
      fps: this.fps, avgMs: this.avgMs, maxMs: this.maxMs, samples: this.frames.length,
      entities: c.entities != null ? c.entities : null,
      balloons: c.balloons != null ? c.balloons : null,
      towers: c.towers != null ? c.towers : null,
      projectiles: c.projectiles != null ? c.projectiles : null,
      particles: c.particles != null ? c.particles : null,
      gridCells: c.gridCells != null ? c.gridCells : null,
      gridQueries: c.gridQueries != null ? c.gridQueries : null,
      memoryMB: (c.memoryMB != null ? c.memoryMB : this.memoryMB()),
      version: c.version || null, wave: c.wave != null ? c.wave : null
    };
  };
  DevTools.prototype.log = function (msg, kind) {
    var line = String(msg);
    this.logLines.push({ text: line, kind: kind || 'info', at: new Date().toISOString() });
    if (this.logLines.length > 100) this.logLines.shift();
    if (this.logEl && typeof document !== 'undefined') {
      var d = document.createElement('div');
      d.textContent = line;
      this.logEl.appendChild(d);
      while (this.logEl.children.length > 100) this.logEl.removeChild(this.logEl.firstChild);
    }
    return line;
  };
  DevTools.prototype.sample = function (handle) {
    if (!handle) return null;
    try {
      if (typeof handle.getDebugStats === 'function') { this.counts = handle.getDebugStats(); return this.counts; }
      if (typeof handle.getHud === 'function') {
        var h = handle.getHud();
        this.counts = { entities: h.ecsEntities, balloons: null, towers: h.towers, particles: h.particles, gridCells: h.gridCells, gridQueries: h.gridQueries, fps: h.fps, version: null, wave: h.wave };
        return this.counts;
      }
    } catch (e) { return null; }
    return null;
  };
  DevTools.prototype.exec = function (input) {
    var cmd = String(input == null ? '' : input).trim();
    var parts = cmd.split(/\s+/);
    var name = (parts[0] || '').toLowerCase();
    var s = this.getStats();
    var out;
    if (name === '' ) out = '';
    else if (name === 'help') out = 'commands: help · fps · stats · entities · mem · version · clear';
    else if (name === 'fps') out = 'FPS ' + s.fps + ' · avg ' + s.avgMs + 'ms · max ' + s.maxMs + 'ms (' + s.samples + ' samples)';
    else if (name === 'stats') out = 'fps=' + s.fps + ' avgMs=' + s.avgMs + ' maxMs=' + s.maxMs + ' particles=' + s.particles + ' gridCells=' + s.gridCells + ' gridQueries=' + s.gridQueries + ' mem=' + (s.memoryMB == null ? 'n/a' : s.memoryMB + 'MB');
    else if (name === 'entities') out = 'entities=' + s.entities + ' balloons=' + s.balloons + ' towers=' + s.towers + ' projectiles=' + s.projectiles + ' particles=' + s.particles;
    else if (name === 'mem') out = s.memoryMB == null ? 'JS heap: n/a in this browser (performance.memory not exposed)' : 'JS heap: ' + s.memoryMB + ' MB';
    else if (name === 'version') out = 'GAME BTD ' + (s.version || 'unknown') + ' · wave ' + (s.wave == null ? '—' : s.wave);
    else if (name === 'clear') { this.logLines = []; if (this.logEl) this.logEl.innerHTML = ''; out = 'console cleared'; }
    else out = 'unknown command: ' + name + ' — try "help"';
    if (out) this.log('> ' + cmd + '\n' + out);
    return out;
  };
  DevTools.prototype._drawGraph = function () {
    if (!this.canvas || typeof document === 'undefined') return;
    var ctx = this.canvas.getContext && this.canvas.getContext('2d');
    if (!ctx) return;
    var w = this.canvas.width, h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0b1020'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(0,246,255,.4)'; ctx.beginPath(); ctx.moveTo(0, h - (1000 / 60) * 2); ctx.lineTo(w, h - (1000 / 60) * 2); ctx.stroke();
    ctx.strokeStyle = '#00f6ff'; ctx.beginPath();
    for (var i = 0; i < this.frames.length; i++) {
      var x = (i / HISTORY) * w, y = h - Math.min(h, this.frames[i] * 2);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };
  DevTools.prototype._renderStats = function () {
    if (!this.statsEl) return;
    var s = this.getStats();
    this.statsEl.textContent = 'FPS ' + s.fps + ' · ' + s.avgMs + 'ms avg / ' + s.maxMs + 'ms max · entities ' + (s.entities == null ? '—' : s.entities)
      + ' · balloons ' + (s.balloons == null ? '—' : s.balloons) + ' · towers ' + (s.towers == null ? '—' : s.towers)
      + ' · projectiles ' + (s.projectiles == null ? '—' : s.projectiles) + ' · particles ' + (s.particles == null ? '—' : s.particles)
      + ' · grid ' + (s.gridCells == null ? '—' : s.gridCells) + ' cells / ' + (s.gridQueries == null ? '—' : s.gridQueries) + ' queries'
      + ' · heap ' + (s.memoryMB == null ? 'n/a' : s.memoryMB + ' MB');
  };
  DevTools.prototype._tick = function () {
    var handle = null;
    try {
      var g = global.GAME_CTX || (typeof window !== 'undefined' ? window.GAME_CTX : null);
      if (g && g.host && g.host.current) handle = g.host.current.handle;
    } catch (e) {}
    if (handle) {
      var before = this.counts;
      this.sample(handle);
      var fps = (this.counts && this.counts.fps) || 0;
      if (fps > 0) this.recordFrame(1000 / fps, this.counts); else if (before) this.counts = before;
    }
    this._drawGraph();
    this._renderStats();
  };
  DevTools.prototype._ensureDom = function () {
    if (this.el || typeof document === 'undefined' || !document.body) return;
    var el = document.createElement('div');
    el.id = 'devConsole';
    el.setAttribute('style', 'position:fixed;left:12px;bottom:12px;width:min(520px,92vw);background:rgba(8,12,24,.92);border:1px solid #00f6ff;color:#e0e0e0;font:12px monospace;padding:10px;z-index:9999;border-radius:8px;');
    var title = document.createElement('div');
    title.textContent = '🛠 Debug console — press ~ to close · type "help"';
    el.appendChild(title);
    var cv = document.createElement('canvas');
    cv.width = 480; cv.height = 48; cv.setAttribute('aria-label', 'FPS graph, last 60 frames');
    el.appendChild(cv); this.canvas = cv;
    var st = document.createElement('div'); el.appendChild(st); this.statsEl = st;
    var lg = document.createElement('div'); lg.style.maxHeight = '120px'; lg.style.overflow = 'auto'; el.appendChild(lg); this.logEl = lg;
    var self = this;
    var form = document.createElement('form');
    var input = document.createElement('input');
    input.type = 'text'; input.placeholder = 'help · fps · stats · entities · mem · version · clear'; input.setAttribute('style', 'width:100%;margin-top:6px;background:#111827;color:#fff;border:1px solid #374151;padding:6px;');
    form.appendChild(input);
    form.addEventListener('submit', function (ev) { ev.preventDefault(); self.exec(input.value); input.value = ''; });
    el.appendChild(form);
    document.body.appendChild(el);
    this.el = el;
  };
  DevTools.prototype.toggle = function () {
    this.open = !this.open;
    if (this.open) {
      this._ensureDom();
      if (this.el) this.el.hidden = false;
      var self = this;
      if (typeof setInterval !== 'undefined' && !this._timer) this._timer = setInterval(function () { self._tick(); }, 500);
      this._tick();
      this.log('debug console open — type "help"');
    } else {
      if (this.el) this.el.hidden = true;
      if (this._timer) { clearInterval(this._timer); this._timer = null; }
    }
    return this.open;
  };
  DevTools.prototype.isOpen = function () { return this.open; };
  DevTools.prototype.stop = function () {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el);
    this.el = null; this.open = false;
  };

  var instance = new DevTools();
  /* `~` toggle, bound once in a browser. Guarded so VM/Node loads
   * only register the handler when a real document exists. */
  try {
    if (typeof document !== 'undefined' && document.addEventListener && !global.__gameDevToolsBound) {
      global.__gameDevToolsBound = true;
      document.addEventListener('keydown', function (ev) {
        if (!ev || ev.key !== '`') return;
        if (ev.target && (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA')) return;
        ev.preventDefault();
        instance.toggle();
      });
    }
  } catch (e) {}
  global.GameDevTools = instance;
  global.GameDevToolsClass = DevTools;
})(typeof window !== 'undefined' ? window : globalThis);

/* EngineHost — the Master Launcher Shell.
 *
 * Loads and unloads game modules into #game-viewport, owns the global
 * wallet + state, and guarantees a clean teardown so switching games (or
 * opening the full-screen marketplace) never leaks a running loop, a
 * live AudioContext, or a stray keyboard listener.
 *
 * Lifecycle contract every game module must honour:
 *   module.init(viewportEl, { bus, wallet, config, hero, onHud, onToast })
 *     -> returns a handle (or nothing)
 *   module.destroy()  — stop the loop, mute audio, unbind listeners.
 *   module.getState() — optional, returns a plain snapshot for the hub.
 *
 * The host itself is framework-free: it is a plain object with a
 * registry of { id, name, tagline, status, load } entries. Adding a new
 * game means adding one registry entry and one module file — the wallet,
 * marketplace and CEO code never change.
 */
(function (global) {
  'use strict';

  function EngineHost(bus, wallet, config) {
    this.bus = bus;
    this.wallet = wallet;
    this.config = config || {};
    this.registry = Object.create(null);
    this.current = null;        // { id, module, handle }
    this.viewport = null;
    this.player = null;         // server player record, refreshed by the shell
    this.heroes = [];           // owned hero records
    this.equippedHero = null;
    this._unsubscribes = [];
  }

  EngineHost.prototype.registerGame = function (entry) {
    if (!entry || !entry.id || typeof entry.load !== 'function') {
      throw new Error('EngineHost.registerGame: entry needs {id, name, load()}');
    }
    this.registry[entry.id] = entry;
    return entry;
  };

  EngineHost.prototype.listGames = function () {
    var self = this;
    return Object.keys(this.registry).map(function (id) { return self.registry[id]; });
  };

  EngineHost.prototype.setViewport = function (el) { this.viewport = el; };

  EngineHost.prototype.loadGame = async function (gameId, opts) {
    var entry = this.registry[gameId];
    if (!entry) throw new Error('Unknown game: ' + gameId);
    if (entry.status && entry.status !== 'playable') throw new Error(entry.name + ' is not playable yet.');
    this.unloadGame();
    if (!this.viewport) throw new Error('EngineHost: no viewport element set.');
    this.viewport.innerHTML = '';
    var mod = await entry.load();
    var handle = null;
    if (mod && typeof mod.init === 'function') {
      handle = await mod.init(this.viewport, {
        bus: this.bus,
        wallet: this.wallet,
        config: this.config,
        hero: this.equippedHero,
        player: this.player,
        sessionId: opts && opts.sessionId,
        sessionNonce: opts && opts.sessionNonce,
        onHud: opts && opts.onHud,
        onToast: opts && opts.onToast,
        onWaveReport: opts && opts.onWaveReport,
        onTowerSelect: opts && opts.onTowerSelect
      });
    }
    this.current = { id: gameId, module: mod, handle: handle, entry: entry };
    this.bus.emit('engine:game_loaded', gameId);
    this.bus.emit('game:start', gameId, this.equippedHero ? [this.equippedHero.id] : []);
    return this.current;
  };

  // Clean teardown: destroy the module, then verify the viewport is
  // empty and no bus listeners from the game remain (games must keep
  // their unsubscribe functions and call them in destroy()).
  EngineHost.prototype.unloadGame = function () {
    if (!this.current) return;
    var gameId = this.current.id;
    try {
      if (this.current.module && typeof this.current.module.destroy === 'function') {
        this.current.module.destroy();
      }
    } catch (err) {
      if (typeof console !== 'undefined' && console.error) console.error('EngineHost: destroy failed for ' + gameId, err);
    }
    try {
      if (this.current.handle && typeof this.current.handle.destroy === 'function') this.current.handle.destroy();
    } catch (err) { /* already reported */ }
    this.current = null;
    if (this.viewport) this.viewport.innerHTML = '';
    this.bus.emit('engine:game_unloaded', gameId);
  };

  EngineHost.prototype.getCurrentState = function () {
    if (this.current && this.current.handle && typeof this.current.handle.getState === 'function') {
      try { return this.current.handle.getState(); } catch (e) { return null; }
    }
    if (!this.current || !this.current.module || typeof this.current.module.getState !== 'function') return null;
    try { return this.current.module.getState(); } catch (e) { return null; }
  };

  // Shared identity helpers: the shell refreshes these from /api/state
  // and /api/player so every game sees the same player/heroes.
  EngineHost.prototype.setPlayer = function (player, heroes) {
    this.player = player || null;
    this.heroes = heroes || [];
    if (this.equippedHero) {
      var stillOwned = this.heroes.find(function (h) { return h.id === this.equippedHero.id; }.bind(this));
      if (!stillOwned) this.equippedHero = null;
    }
  };

  EngineHost.prototype.equipHero = function (hero) {
    this.equippedHero = hero || null;
    if (this.current && this.current.handle && typeof this.current.handle.setHero === 'function') {
      this.current.handle.setHero(hero);
    } else if (this.current && this.current.module && typeof this.current.module.setHero === 'function') {
      this.current.module.setHero(hero);
    }
    return this.equippedHero;
  };

  EngineHost.prototype.on = function (event, cb) {
    var unsub = this.bus.on(event, cb);
    this._unsubscribes.push(unsub);
    return unsub;
  };

  EngineHost.prototype.destroy = function () {
    this.unloadGame();
    this._unsubscribes.forEach(function (fn) { try { fn(); } catch (e) {} });
    this._unsubscribes = [];
    if (this.wallet) this.wallet.stopBalancePolling();
  };

  global.EngineHost = EngineHost;
})(typeof window !== 'undefined' ? window : globalThis);

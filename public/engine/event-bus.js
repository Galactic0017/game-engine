/* EngineEvents — the typed global event bus (IEngineEventBus).
 *
 * Decouples the game core from the UI framework: the wallet manager, the
 * game canvas, the marketplace and the CEO panel only ever talk through
 * this bus. No module imports another module's DOM.
 *
 * Events (see docs/EVENT_BUS.md in the repo README for the full matrix):
 *   wallet:connected(address, balanceUatom)
 *   wallet:disconnected()
 *   game:start(gameId, heroIds)
 *   game:wave_completed(wave, rewardsEarned, report)
 *   game:hero_level_up(heroId, newLevel)
 *   game:session_flagged(flag)
 *   marketplace:buy_requested({heroId, priceUatom})
 *   marketplace:order_pending(sale)
 *   ceo:order_approved(listingId, txHash)
 *   ceo:order_rejected(listingId)
 *   rpc:tx_confirmed(txHash, checks)
 *   rpc:watcher_status(status)
 *
 * This is plain JavaScript (no TypeScript build step in this repo), so the
 * contract is enforced by the event-name registry below: emitting an
 * unknown event throws in development and logs a warning in production.
 * Payloads are NOT validated at runtime beyond the registry — handlers
 * must treat every payload as untrusted input from another module.
 */
(function (global) {
  'use strict';

  var KNOWN_EVENTS = {
    'wallet:connected': true,
    'wallet:disconnected': true,
    'wallet:balance': true,
    'game:start': true,
    'game:wave_completed': true,
    'game:hero_level_up': true,
    'game:session_flagged': true,
    'game:ended': true,
    'marketplace:buy_requested': true,
    'marketplace:order_pending': true,
    'marketplace:listing_created': true,
    'ceo:order_approved': true,
    'ceo:order_rejected': true,
    'ceo:auto_verify_toggled': true,
    'rpc:tx_confirmed': true,
    'rpc:tx_failed': true,
    'rpc:watcher_status': true,
    'engine:game_loaded': true,
    'engine:game_unloaded': true,
    'engine:error': true
  };

  function EngineEvents() {
    this._handlers = Object.create(null);
  }

  EngineEvents.prototype.on = function (event, callback) {
    if (!KNOWN_EVENTS[event]) throw new Error('EngineEvents: unknown event "' + event + '"');
    if (typeof callback !== 'function') throw new Error('EngineEvents.on: callback must be a function');
    (this._handlers[event] = this._handlers[event] || []).push(callback);
    var self = this;
    // Return an unsubscribe function so callers can clean up on teardown.
    return function unsubscribe() { self.off(event, callback); };
  };

  EngineEvents.prototype.once = function (event, callback) {
    var self = this;
    function wrapper() {
      self.off(event, wrapper);
      callback.apply(null, arguments);
    }
    return this.on(event, wrapper);
  };

  EngineEvents.prototype.off = function (event, callback) {
    var list = this._handlers[event];
    if (!list) return;
    if (!callback) { delete this._handlers[event]; return; }
    this._handlers[event] = list.filter(function (fn) { return fn !== callback; });
  };

  EngineEvents.prototype.emit = function (event) {
    if (!KNOWN_EVENTS[event]) {
      var msg = 'EngineEvents: unknown event "' + event + '"';
      if (typeof console !== 'undefined' && console.warn) console.warn(msg);
      throw new Error(msg);
    }
    var args = Array.prototype.slice.call(arguments, 1);
    var list = (this._handlers[event] || []).slice();
    for (var i = 0; i < list.length; i++) {
      try {
        list[i].apply(null, args);
      } catch (err) {
        // One bad handler must never break the bus or the game loop.
        // Never re-emit engine:error from inside its own handler (recursion).
        if (typeof console !== 'undefined' && console.error) console.error('EngineEvents handler failed for ' + event, err);
        if (event !== 'engine:error') this.emit('engine:error', { event: event, error: String(err && err.message || err) });
      }
    }
    return list.length;
  };

  EngineEvents.prototype.listenerCount = function (event) {
    return (this._handlers[event] || []).length;
  };

  // A single shared bus for the whole hub. Game modules receive it via
  // Engine.loadGame() options, they never construct their own.
  var bus = new EngineEvents();

  global.EngineEvents = EngineEvents;
  global.engineBus = bus;
})(typeof window !== 'undefined' ? window : globalThis);

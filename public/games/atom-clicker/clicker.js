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
 * Batch 22: click milestones (100/500/1000/2500/5000) that toast
 * once each when crossed and persist with the local save.
 * Batch 30: shards per click (held shards per click, in state + panel).
 */
(function (global) {
  'use strict';
  var COMBO_WINDOW_MS = 1500;
  var GOLDEN_CHANCE = 0.015;
  var GOLDEN_MS = 8000;
  var GOLDEN_BONUS = 10;
  var SHARD_CONVERSION = { shardsPerChunk: 100, creditsPerChunk: 10, minShards: 100, maxShards: 5000 };
  /* Batch 22: click milestones — total-click thresholds that toast
   * once each when crossed. milestonesReached is pure; the hit list
   * is persisted with the save so a milestone never toasts twice,
   * and legacy saves seed it silently from their stored click total. */
  var MILESTONES = [100, 500, 1000, 2500, 5000];
  function milestonesReached(clicks) { return MILESTONES.filter(function (m) { return (clicks || 0) >= m; }); }
  function nextMilestone(clicks) { for (var i = 0; i < MILESTONES.length; i++) if ((clicks || 0) < MILESTONES[i]) return MILESTONES[i]; return null; }
  /* Batch 25: clicks to the next milestone — how many more total
   * clicks until the next milestone threshold, 0 once all five
   * are reached. Pure; exposed in state as
   * clicksToNextMilestone alongside nextMilestone. */
  function clicksToNextMilestone(clicks) { var n = nextMilestone(clicks); return n == null ? 0 : n - (clicks || 0); }
  /* Batch 28: milestone progress percent — how far, as a
   * percent to one decimal, the click total has travelled
   * from the last milestone reached (0 before the first)
   * toward the next one; 100 once all five are reached.
   * Pure; exposed in state as milestoneProgressPct and in
   * the panel's milestone line. */
  /* Batch 30: shards per click — shards currently held
   * (unbanked + banked) per total click, to one decimal.
   * 0 with no clicks. Held shards only: converting shards
   * to credits removes them from the held total, so this
   * falls after a conversion. Pure; exposed in state as
   * shardsPerClick and in the panel's milestone line. */
  function shardsPerClickFor(shards, banked, clicks) {
    if (!clicks || clicks <= 0) return 0;
    return Math.round(((shards || 0) + (banked || 0)) / clicks * 10) / 10;
  }
  /* Batch 32: banked per click — banked shards only
   * per total click, to one decimal. 0 with no clicks.
   * Banked shards are the conversion-ready pile (the
   * unbanked shards in shardsPerClick are not counted),
   * so this reads lower than shardsPerClick until the
   * player banks. Pure; exposed in state as
   * bankedPerClick and in the panel's milestone line. */
  function bankedPerClickFor(banked, clicks) {
    if (!clicks || clicks <= 0) return 0;
    return Math.round((banked || 0) / clicks * 10) / 10;
  }
  /* Batch 34: clicks per golden — average clicks
   * between golden shard events, to one decimal.
   * 0 with no golden event yet (goldenEvents only
   * grows when a golden shard triggers, at a 1.5%
   * chance per click, so this reads about 67 in
   * steady play). Pure; exposed in state as
   * clicksPerGolden and in the panel's milestone
   * line. */
  function clicksPerGoldenFor(clicks, goldenEvents) {
    if (!goldenEvents || goldenEvents <= 0) return 0;
    return Math.round((clicks || 0) / goldenEvents * 10) / 10;
  }
  /* Batch 36: shards per golden — shards currently held
   * (unbanked + banked) per golden shard event, to one
   * decimal. 0 with no golden event yet. Held shards
   * only: converting shards to credits removes them
   * from the held total, so this falls after a
   * conversion. Pure; exposed in state as
   * shardsPerGolden and in the panel's milestone
   * line, mirroring clicksPerGoldenFor (the held-shard
   * view: shards held per golden event, not clicks
   * between golden events). */
  function shardsPerGoldenFor(shards, banked, goldenEvents) {
    if (!goldenEvents || goldenEvents <= 0) return 0;
    return Math.round(((shards || 0) + (banked || 0)) / goldenEvents * 10) / 10;
  }
  /* Batch 37: banked per golden — banked shards per
   * golden shard event, to one decimal. 0 with no
   * golden event yet. Banked only: unbanked shards
   * are not counted, so banking during a golden
   * run raises this. Pure; exposed in state as
   * bankedPerGolden and in the panel's milestone
   * line, mirroring shardsPerGoldenFor (the banked
   * view: shards banked per golden event, not
   * shards held per golden event). */
  function bankedPerGoldenFor(banked, goldenEvents) {
    if (!goldenEvents || goldenEvents <= 0) return 0;
    return Math.round((banked || 0) / goldenEvents * 10) / 10;
  }
  /* ---- Batch 38: golden share ---- * Golden
   * shard events as a percent of all clicks, to
   * one decimal, capped at 100 (golden events are
   * a subset of clicks in normal play). 0 with no
   * clicks yet. Pure; exposed in state as
   * goldenShare and in the panel's milestone
   * line, mirroring bankedPerGoldenFor (the share
   * view: how often clicks go golden, not shards
   * banked per golden event). */
  function goldenShareFor(goldenEvents, clicks) {
    if (!clicks || clicks <= 0) return 0;
    return Math.min(100, Math.round((goldenEvents || 0) / clicks * 1000) / 10);
  }
  /* ---- Batch 39: clicks per milestone ---- * Average
   * clicks per milestone hit, to one decimal. 0 with
   * no milestone hit yet. Pure; exposed in state as
   * clicksPerMilestone and in the panel's milestone
   * line, mirroring goldenShareFor (the milestone
   * view: clicks per hit, not the golden share). */
  function clicksPerMilestoneFor(clicks, milestonesHit) {
    if (!milestonesHit || milestonesHit <= 0) return 0;
    return Math.round((clicks || 0) / milestonesHit * 10) / 10;
  }
  /* ---- Batch 40: golden per milestone ---- *
   * Golden shard events per milestone hit, to one
   * decimal. 0 with no milestone hit yet. Pure;
   * exposed in state as goldenPerMilestone and in
   * the panel's milestone line, mirroring
   * clicksPerMilestoneFor (the golden view:
   * golden events per hit, not clicks per hit). */
  function goldenPerMilestoneFor(goldenEvents, milestonesHit) {
    if (!milestonesHit || milestonesHit <= 0) return 0;
    return Math.round((goldenEvents || 0) / milestonesHit * 10) / 10;
  }
  /* ---- Batch 41: shards per milestone ---- * Held
   * plus banked shards per milestone hit, to one
   * decimal. 0 with no milestone hit yet. Pure;
   * exposed in state as shardsPerMilestone and in
   * the panel's milestone line, mirroring
   * shardsPerGoldenFor (the milestone view: all
   * shards per hit, not per golden event). */
  function shardsPerMilestoneFor(shards, banked, milestonesHit) {
    if (!milestonesHit || milestonesHit <= 0) return 0;
    return Math.round(((shards || 0) + (banked || 0)) / milestonesHit * 10) / 10;
  }
  /* ---- Batch 42: banked per milestone ---- * Banked
   * shards per milestone hit, to one decimal. 0
   * with no milestone hit yet. Pure; exposed in
   * state as bankedPerMilestone and in the
   * panel's milestone line, mirroring
   * shardsPerMilestoneFor (the banked view:
   * banked shards per hit, not all shards). */
  function bankedPerMilestoneFor(banked, milestonesHit) {
    if (!milestonesHit || milestonesHit <= 0) return 0;
    return Math.round((banked || 0) / milestonesHit * 10) / 10;
  }
  /* ---- Batch 43: clicks per shard ---- * Total
   * clicks per shard currently held (unbanked +
   * banked), to one decimal. 0 with no held
   * shard yet. Held shards only: converting
   * shards to credits removes them from the held
   * total, so this rises after a conversion.
   * Pure; exposed in state as clicksPerShard
   * and in the panel's milestone line,
   * mirroring bankedPerMilestoneFor (the effort
   * view: clicks per held shard, not banked
   * shards per milestone hit). */
  function clicksPerShardFor(clicks, shards, banked) {
    var held = (shards || 0) + (banked || 0);
    if (!held || held <= 0) return 0;
    return Math.round((clicks || 0) / held * 10) / 10;
  }
  function milestoneProgressFor(clicks) {
    var c = Math.max(0, clicks || 0);
    var next = nextMilestone(c);
    if (next == null) return 100;
    var prev = 0;
    for (var i = 0; i < MILESTONES.length; i++) if (MILESTONES[i] <= c) prev = MILESTONES[i];
    return Math.round((c - prev) / (next - prev) * 1000) / 10;
  }
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
    state.milestones = Array.isArray(state.milestones) ? state.milestones : milestonesReached(state.clicks || 0);
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
      var newly = milestonesReached(state.clicks).filter(function (m) { return state.milestones.indexOf(m) < 0; });
      newly.forEach(function (m) { state.milestones.push(m); if (opts.onToast) opts.onToast('Milestone! ' + m + ' total clicks.', 'ok'); });
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
        + '<p class="muted">100 banked shards = 10 credits. Session proof: <code id="clkProof">' + proof.slice(0, 24) + '…</code></p>'
        + '<p class="muted">Milestones hit: ' + state.milestones.length + '/' + MILESTONES.length + (nextMilestone(state.clicks) ? ' — next at ' + nextMilestone(state.clicks) + ' clicks.' : ' — all reached!') + ' Milestone progress: ' + milestoneProgressFor(state.clicks) + '% to the next milestone.' + ' Shards/click: ' + shardsPerClickFor(state.shards, state.banked, state.clicks) + ' held per click.' + ' Banked/click: ' + bankedPerClickFor(state.banked, state.clicks) + ' banked per click.' + ' Clicks/golden: ' + clicksPerGoldenFor(state.clicks, state.goldenEvents) + ' clicks per golden event.' + ' Shards/golden: ' + shardsPerGoldenFor(state.shards, state.banked, state.goldenEvents) + ' held shards per golden event.' + ' Banked/golden: ' + bankedPerGoldenFor(state.banked, state.goldenEvents) + ' banked shards per golden event.' + ' Golden share: ' + goldenShareFor(state.goldenEvents, state.clicks) + '% of clicks were golden events.' + ' Clicks/milestone: ' + clicksPerMilestoneFor(state.clicks, state.milestones.length) + ' clicks per milestone hit.' + ' Golden/milestone: ' + goldenPerMilestoneFor(state.goldenEvents, state.milestones.length) + ' golden events per milestone hit.' + ' Shards/milestone: ' + shardsPerMilestoneFor(state.shards, state.banked, state.milestones.length) + ' held + banked shards per milestone hit.' + ' Banked/milestone: ' + bankedPerMilestoneFor(state.banked, state.milestones.length) + ' banked shards per milestone hit.' + ' Clicks/shard: ' + clicksPerShardFor(state.clicks, state.shards, state.banked) + ' clicks per held shard.' + '</p></div>';
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
      getState: function () { return { shards: state.shards, banked: state.banked, clicks: state.clicks, proof: proof, combo: state.combo, bestCombo: state.bestCombo, goldenActive: Date.now() < state.goldenUntil, goldenEvents: state.goldenEvents, surgeUntil: state.surgeUntil, milestones: state.milestones.slice(), nextMilestone: nextMilestone(state.clicks), clicksToNextMilestone: clicksToNextMilestone(state.clicks), milestoneProgressPct: milestoneProgressFor(state.clicks), shardsPerClick: shardsPerClickFor(state.shards, state.banked, state.clicks), bankedPerClick: bankedPerClickFor(state.banked, state.clicks), clicksPerGolden: clicksPerGoldenFor(state.clicks, state.goldenEvents), shardsPerGolden: shardsPerGoldenFor(state.shards, state.banked, state.goldenEvents), bankedPerGolden: bankedPerGoldenFor(state.banked, state.goldenEvents), goldenShare: goldenShareFor(state.goldenEvents, state.clicks), clicksPerMilestone: clicksPerMilestoneFor(state.clicks, state.milestones.length), goldenPerMilestone: goldenPerMilestoneFor(state.goldenEvents, state.milestones.length), shardsPerMilestone: shardsPerMilestoneFor(state.shards, state.banked, state.milestones.length), bankedPerMilestone: bankedPerMilestoneFor(state.banked, state.milestones.length), clicksPerShard: clicksPerShardFor(state.clicks, state.shards, state.banked) }; },
      destroy: function () { destroyed = true; if (surgeTimer) clearInterval(surgeTimer); if (opts.bus) opts.bus.emit('game:ended', 'atom-clicker', {}); }
    };
  }
  global.AtomClicker = { manifest: { id: 'atom-clicker', name: 'ATOM Core Clicker' }, init: init, _comboMultiplier: comboMultiplier, _clickGain: clickGain, _convertShards: convertShards, _milestonesReached: milestonesReached, _nextMilestone: nextMilestone, _clicksToNextMilestone: clicksToNextMilestone, _milestoneProgressFor: milestoneProgressFor, _shardsPerClickFor: shardsPerClickFor, _bankedPerClickFor: bankedPerClickFor, _clicksPerGoldenFor: clicksPerGoldenFor, _shardsPerGoldenFor: shardsPerGoldenFor, _bankedPerGoldenFor: bankedPerGoldenFor, _goldenShareFor: goldenShareFor, _clicksPerMilestoneFor: clicksPerMilestoneFor, _goldenPerMilestoneFor: goldenPerMilestoneFor, _shardsPerMilestoneFor: shardsPerMilestoneFor, _bankedPerMilestoneFor: bankedPerMilestoneFor, _clicksPerShardFor: clicksPerShardFor, MILESTONES: MILESTONES, SHARD_CONVERSION: SHARD_CONVERSION, COMBO_WINDOW_MS: COMBO_WINDOW_MS, GOLDEN_BONUS: GOLDEN_BONUS };
})(typeof window !== 'undefined' ? window : globalThis);

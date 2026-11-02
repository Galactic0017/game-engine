/* Engine Hub shell — glue between EngineHost, wallet, server and views.
 * Owns: config load, wallet widget, sidebar, BTD action bar, session
 * start, wave-report submission, toasts, nav. Marketplace and CEO
 * panels live in marketplace-ui.js / ceo-ui.js and share this ctx.
 */
(function () {
  'use strict';
  var bus = window.engineBus;
  var ctx = { config: null, wallet: null, host: null, watcher: null, state: null, player: null, session: null, currentGame: 'cosmos-btd', hud: null, selectedTower: null };
  window.GAME_CTX = ctx;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function shortAddr(a) { return a ? a.slice(0, 9) + '…' + a.slice(-5) : ''; }
  function toast(msg, kind) {
    var box = document.getElementById('toasts'); if (!box) return;
    var el = document.createElement('div'); el.className = 'toast ' + (kind || ''); el.textContent = msg;
    box.appendChild(el);
    setTimeout(function () { el.remove(); }, 6000);
  }
  ctx.toast = toast; ctx.esc = esc; ctx.shortAddr = shortAddr;
  /* Batch 16: reduced motion defaults to the OS preference when the
   * user has never chosen (stored settings win over the OS default). */
  function prefersReducedMotion() { try { return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  function loadSettings() { try { return Object.assign({ volume: 1, quality: 'high', postfx: true, dof: true, fpsTarget: 60, particleDensity: 'high', motionBlur: false, displayScale: 'auto', uiScale: 1, glass: true, uiSounds: true, ambientHum: true, colorblind: false, reducedMotion: prefersReducedMotion() }, JSON.parse(localStorage.getItem('game-settings') || '{}')); } catch (e) { return { volume: 1, quality: 'high', postfx: true, dof: true, fpsTarget: 60, particleDensity: 'high', motionBlur: false, displayScale: 'auto', uiScale: 1, glass: true, uiSounds: true, ambientHum: true, colorblind: false, reducedMotion: prefersReducedMotion() }; } }
  ctx.settings = loadSettings();
  function saveSettings() { try { localStorage.setItem('game-settings', JSON.stringify(ctx.settings)); } catch (e) {} }
  /* Reactive UI prefs: glass theme on/off + dynamic font scaling, applied
   * live to the whole hub (CSS vars), independent of the loaded game. */
  function applyUiPrefs() {
    if (typeof document === 'undefined') return;
    document.documentElement.style.setProperty('--ui-scale', String(ctx.settings.uiScale || 1));
    document.body.setAttribute('data-glass', ctx.settings.glass === false ? 'off' : 'on');
    /* Batch 9: expose graphics quality on <body> so the CSS-only
     * starfield freezes its animation on Low quality. */
    document.body.setAttribute('data-quality', ctx.settings.quality === 'low' ? 'low' : 'high');
    /* Batch 16: expose accessibility prefs on <body> so CSS animations
     * (starfield, glow) freeze when reduced motion is on. */
    document.body.setAttribute('data-reduced-motion', ctx.settings.reducedMotion ? 'on' : 'off');
    document.body.setAttribute('data-colorblind', ctx.settings.colorblind ? 'on' : 'off');
  }
  ctx.applyUiPrefs = applyUiPrefs;
  function applySettings(handle) { if (!handle) { applyUiPrefs(); applyAmbientHum(); return; } if (handle.setVolume) handle.setVolume(ctx.settings.volume); if (handle.setQuality) handle.setQuality(ctx.settings.quality); if (handle.setPostFx) handle.setPostFx(ctx.settings.postfx !== false); if (handle.setDof) handle.setDof(ctx.settings.dof !== false); if (handle.setFpsTarget) handle.setFpsTarget(ctx.settings.fpsTarget); if (handle.setParticleDensity) handle.setParticleDensity(ctx.settings.particleDensity); if (handle.setMotionBlur) handle.setMotionBlur(ctx.settings.motionBlur); if (handle.setDisplayScale) handle.setDisplayScale(ctx.settings.displayScale); if (handle.setColorblind) handle.setColorblind(ctx.settings.colorblind === true); if (handle.setReducedMotion) handle.setReducedMotion(ctx.settings.reducedMotion === true); applyUiPrefs(); applyAmbientHum(); }
  ctx.applySettings = applySettings;
  /* Hover/click sound feedback: one lazy WebAudio tick, throttled, silent
   * when volume is 0 or UI sounds are off. Never throws, never autoplays. */
  var _uiAC = null, _lastClickTick = 0, _lastHoverTick = 0;
  function uiTick(kind) {
    if (ctx.settings.uiSounds === false || !ctx.settings.volume) return;
    var now = Date.now();
    if (kind === 'hover') { if (now - _lastHoverTick < 180) return; _lastHoverTick = now; }
    else { if (now - _lastClickTick < 60) return; _lastClickTick = now; }
    try {
      var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      if (!_uiAC) _uiAC = new AC();
      if (_uiAC.state === 'suspended') _uiAC.resume();
      var t = _uiAC.currentTime, o = _uiAC.createOscillator(), g = _uiAC.createGain();
      o.type = 'sine'; o.frequency.value = kind === 'hover' ? 1200 : 880;
      g.gain.setValueAtTime(0.03 * (ctx.settings.volume || 1), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      o.connect(g); g.connect(_uiAC.destination); o.start(t); o.stop(t + 0.06);
    } catch (e) { /* sound is decoration; never break the UI */ }
  }
  ctx.uiTick = uiTick;
  /* Batch 19: ambient space hum — two quiet detuned Web Audio sine
   * oscillators, no audio assets. Shares the uiTick AudioContext.
   * Never autoplays: it starts only after the user's first
   * pointer/key gesture, and only while ambient hum + UI sounds are
   * on and volume > 0. Never throws, never breaks the UI. */
  var _humNodes = null, _userGestured = false;
  function humAllowed() { return ctx.settings.ambientHum !== false && ctx.settings.uiSounds !== false && (ctx.settings.volume || 0) > 0; }
  function startAmbientHum() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      if (!_uiAC) _uiAC = new AC();
      if (_uiAC.state === 'suspended') _uiAC.resume();
      var t = _uiAC.currentTime, g = _uiAC.createGain();
      g.gain.setValueAtTime(0.012 * (ctx.settings.volume || 1), t);
      g.connect(_uiAC.destination);
      var oscs = [54, 81].map(function (freq) { var o = _uiAC.createOscillator(); o.type = 'sine'; o.frequency.value = freq; o.connect(g); o.start(t); return o; });
      _humNodes = { gain: g, oscs: oscs };
    } catch (e) { _humNodes = null; /* sound is decoration */ }
  }
  function stopAmbientHum() {
    if (!_humNodes) return;
    try { _humNodes.oscs.forEach(function (o) { try { o.stop(); } catch (e) {} try { o.disconnect(); } catch (e) {} }); _humNodes.gain.disconnect(); } catch (e) {}
    _humNodes = null;
  }
  function applyAmbientHum() {
    if (!humAllowed() || !_userGestured) { stopAmbientHum(); return; }
    if (!_humNodes) { startAmbientHum(); return; }
    try { _humNodes.gain.gain.setValueAtTime(0.012 * (ctx.settings.volume || 1), _uiAC.currentTime); } catch (e) {}
  }
  ctx.startAmbientHum = startAmbientHum; ctx.stopAmbientHum = stopAmbientHum; ctx.applyAmbientHum = applyAmbientHum;
  /* Batch 19: hub loading screen — progress bar + rotating tips.
   * updateHubLoader is called at real init stages (config, games,
   * first game load); hideHubLoader runs when the first game is
   * ready, and a 20s safety timeout hides it even if init fails, so
   * the overlay can never trap the user on a broken load. */
  var LOADING_TIPS = [
    'Tip: Protect the ATOM orb at the end of the glowing energy lane.',
    'Tip: Bosses arrive every 10 waves — save gold for upgraded towers.',
    'Tip: Press Space to start a wave early and earn a +25 gold skip bonus.',
    'Tip: Heroes level up inside a run — equip one from My Heroes.',
    'Tip: Marketplace buys send the full price to the CEO address — always check the memo in Keplr.'
  ];
  var _loaderTimer = null, _loaderTipIdx = 0;
  function updateHubLoader(pct, label) {
    try {
      var fill = document.getElementById('hubLoaderFill'), pctEl = document.getElementById('hubLoaderPct');
      var p = Math.max(0, Math.min(100, Number(pct) || 0));
      if (fill) fill.style.width = p + '%';
      if (pctEl) pctEl.textContent = p + '%' + (label ? ' · ' + label : '');
    } catch (e) {}
  }
  function hideHubLoader() {
    if (_loaderTimer) { clearInterval(_loaderTimer); _loaderTimer = null; }
    try { var el = document.getElementById('hubLoader'); if (el) el.remove(); } catch (e) {}
  }
  function startHubLoaderTips() {
    try {
      var tipEl = document.getElementById('hubLoaderTip'); if (!tipEl) return;
      _loaderTimer = setInterval(function () { _loaderTipIdx = (_loaderTipIdx + 1) % LOADING_TIPS.length; var el = document.getElementById('hubLoaderTip'); if (el) el.textContent = LOADING_TIPS[_loaderTipIdx]; }, 3000);
      setTimeout(hideHubLoader, 20000);
    } catch (e) {}
  }
  ctx.updateHubLoader = updateHubLoader; ctx.hideHubLoader = hideHubLoader; ctx.LOADING_TIPS = LOADING_TIPS;
  startHubLoaderTips(); updateHubLoader(5, 'Starting…');
  /* Batch 19: hub footer — version + build date from /api/config,
   * links to AtomStaking + Swap. Static HTML already carries the
   * same links and a fallback version/date, so a failed config
   * fetch never leaves the footer empty. */
  function renderHubFooter() {
    try {
      var v = document.getElementById('hubFooterVersion'); if (v && ctx.config && ctx.config.version) v.textContent = 'v' + ctx.config.version;
      var d = document.getElementById('hubFooterDate'); if (d && ctx.config && ctx.config.buildDate) d.textContent = 'Build ' + ctx.config.buildDate;
    } catch (e) {}
  }
  ctx.renderHubFooter = renderHubFooter;
  async function api(path, method, body) {
    var res = await fetch(path, { method: method || 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    var json = null; try { json = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error((json && json.error) || ('Request failed: ' + res.status));
    return json;
  }
  ctx.api = api;
  // CEO-signed fetch: fresh ADR-36 signature over path + canonical body + ts.
  async function ceoFetch(path, body) {
    body = body || {};
    var ts = Date.now();
    var message = path + '\n' + ctx.wallet.canonicalJson(body) + '\n' + String(ts);
    var sig = await ctx.wallet.ceoSign(message);
    var res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ceo-address': sig.address, 'x-ceo-signature': sig.signature, 'x-ceo-pubkey': sig.pubkey, 'x-ceo-timestamp': String(ts) }, body: JSON.stringify(body) });
    var json = null; try { json = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error((json && json.error) || ('CEO request failed: ' + res.status));
    return json;
  }
  ctx.ceoFetch = ceoFetch;
  async function ceoGet(path) {
    var ts = Date.now();
    var message = path + '\n' + ctx.wallet.canonicalJson({}) + '\n' + String(ts);
    var sig = await ctx.wallet.ceoSign(message);
    var res = await fetch(path, { headers: { 'x-ceo-address': sig.address, 'x-ceo-signature': sig.signature, 'x-ceo-pubkey': sig.pubkey, 'x-ceo-timestamp': String(ts) } });
    var json = null; try { json = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error((json && json.error) || ('CEO request failed: ' + res.status));
    return json;
  }
  ctx.ceoGet = ceoGet;

  function renderWallet() {
    var w = ctx.wallet;
    document.getElementById('walletStatus').textContent = w.address ? shortAddr(w.address) + (w.provider ? ' · ' + w.provider : '') : 'Not connected';
    document.getElementById('walletBalance').textContent = w.address && w.balanceAtom() !== null ? w.balanceAtom() + ' ATOM' : '';
    document.getElementById('btnDisconnect').hidden = !w.address;
    var avail = (w.availableProviders ? w.availableProviders() : []);
    var kb = document.getElementById('btnConnectKeplr');
    if (kb) { var missing = avail.indexOf('keplr') < 0; kb.disabled = missing; kb.title = missing ? 'Keplr extension not detected in this browser.' : ''; }
  }
  async function ensurePlayer() {
    var w = ctx.wallet; if (!w.address) return;
    try {
      var storedRef = null; try { storedRef = localStorage.getItem('game-referral') || null; } catch (e) {}
      var r = await api('/api/player', 'POST', { address: w.address, name: w.name, referredBy: storedRef || undefined });
      ctx.player = r.player;
      ctx.host.setPlayer(r.player, r.heroes || []);
      renderHeroes(r.heroes || []);
    } catch (e) { toast(e.message, 'err'); }
  }
  async function refreshState() {
    try {
      ctx.state = await api('/api/state');
      renderLeaderMini(); renderAnnouncements(); renderProfile(); renderChallenges(); renderReferral(); renderFriends(); renderMarketPreview(); renderInspectorMarket();
      if (ctx.player) { var mine = ctx.state.heroes.filter(function (h) { return h.owner === ctx.player.address; }); ctx.host.setPlayer(ctx.player, mine); renderHeroes(mine); }
      if (document.getElementById('view-marketplace').classList.contains('active') && window.MarketplaceUI) window.MarketplaceUI.render(document.getElementById('marketplace'), ctx);
    } catch (e) { /* state refresh is best-effort */ }
  }
  ctx.refreshState = refreshState; ctx.ensurePlayer = ensurePlayer;
  var leaderGame = '';
  var leaderSeason = '';
  async function renderLeaderMini() {
    var el = document.getElementById('leaderMini'); if (!el) return;
    var rows, seasonInfo = null;
    if (leaderSeason || leaderGame) { try { var r = await api('/api/leaderboard?game=' + leaderGame + (leaderSeason ? '&season=' + leaderSeason : '')); rows = r.leaderboard || []; seasonInfo = r.season || null; } catch (e) { rows = []; } }
    else rows = (ctx.state && ctx.state.leaderboard) || [];
    var seasonKeyNow = new Date().toISOString().slice(0, 7);
    el.innerHTML = '<p class="small"><span class="muted">Cosmos BTD leaderboard</span></p>'
      + '<p class="small"><button data-season="" class="ghost">All-time</button> <button data-season="' + seasonKeyNow + '" class="ghost">This month (' + seasonKeyNow + ')</button>'
      + (seasonInfo && seasonInfo.previousKey ? '<br><span class="muted">Last month (' + esc(seasonInfo.previousKey) + ') top 3: ' + esc((seasonInfo.top3 || []).map(function (t) { return '#' + t.rank + ' ' + (t.name || shortAddr(t.address)); }).join(', ') || 'none') + '</span>' : '') + '</p>'
      + (rows.length ? rows.slice(0, 5).map(function (r, i) { return '<p class="small">' + (leaderSeason && i < 3 ? '🏆 ' : '') + (i + 1) + '. ' + esc(r.name || shortAddr(r.address)) + ' — ' + r.bestScore + ' pts · Lv ' + r.level + '</p>'; }).join('') : '<p class="muted small">No scores yet' + (leaderSeason ? ' this month' : '') + '.</p>');
    el.querySelectorAll('[data-lb]').forEach(function (btn) { btn.addEventListener('click', function () { leaderGame = btn.getAttribute('data-lb'); renderLeaderMini(); }); });
    el.querySelectorAll('[data-season]').forEach(function (btn) { btn.addEventListener('click', function () { leaderSeason = btn.getAttribute('data-season'); renderLeaderMini(); }); });
  }
  async function renderFriends() {
    var box = document.getElementById('friendsBox'); if (!box) return;
    var rivals = {};
    if (ctx.player) {
      try { var hr = await api('/api/duels/history?address=' + encodeURIComponent(ctx.player.address)); (hr.history || []).forEach(function (d) { var other = d.challenger === ctx.player.address ? d.rival : d.challenger; var nm = d.challenger === ctx.player.address ? (d.rivalName || null) : (d.challengerName || null); if (other && other !== ctx.player.address) rivals[other] = nm || shortAddr(other); }); } catch (e) {}
      try { var dr = await api('/api/duels?address=' + encodeURIComponent(ctx.player.address)); (dr.duels || []).forEach(function (d) { var other = d.challenger === ctx.player.address ? d.rival : d.challenger; var nm = d.challenger === ctx.player.address ? (d.rivalName || null) : (d.challengerName || null); if (other && other !== ctx.player.address) rivals[other] = nm || shortAddr(other); }); } catch (e) {}
    }
    var names = Object.keys(rivals);
    box.innerHTML = names.length ? names.slice(0, 8).map(function (a) { return '<p class="small">👤 ' + esc(rivals[a]) + ' <span class="muted">' + esc(shortAddr(a)) + '</span></p>'; }).join('') : '<p class="muted small">' + (ctx.player ? 'No duels yet — send an invite from Challenges below.' : 'Connect Keplr to see players you have dueled.') + '</p>';
  }
  /* Batch 18: live duel races (polling), credits-only entry fee,
   * duel history + rematch. Polling updates only the live score/clock
   * spans so a score being typed is never wiped by a re-render. */
  var duelPollTimer = null, duelPollId = null;
  function stopDuelPolling() { if (duelPollTimer) { clearInterval(duelPollTimer); duelPollTimer = null; duelPollId = null; } }
  async function pollLiveDuel() {
    var box = document.getElementById('challengeBox'); if (!box || !duelPollId || !ctx.player) { stopDuelPolling(); return; }
    try {
      var r = await api('/api/duels/' + duelPollId + '/live?address=' + encodeURIComponent(ctx.player.address));
      var d = r.duel;
      var mineFirst = d.challenger === ctx.player.address;
      var scoreEl = box.querySelector('[data-live-scores="' + d.id + '"]');
      if (scoreEl) scoreEl.textContent = 'You ' + (mineFirst ? d.liveScores.challenger : d.liveScores.rival) + ' — Rival ' + (mineFirst ? d.liveScores.rival : d.liveScores.challenger) + ' · leader: ' + (d.leader === 'tie' ? 'tied' : d.leader === 'challenger' ? (d.challengerName || 'challenger') : (d.rivalName || 'rival'));
      var clockEl = box.querySelector('[data-live-clock="' + d.id + '"]');
      if (clockEl) clockEl.textContent = d.secondsLeft + 's left';
      if (d.status !== 'live') { stopDuelPolling(); renderChallenges(); refreshState(); }
    } catch (e) { /* polling is best-effort; the panel stays until the next render */ }
  }
  function startDuelPolling(id) {
    if (duelPollId === id && duelPollTimer) return;
    stopDuelPolling(); duelPollId = id;
    duelPollTimer = setInterval(pollLiveDuel, 5000);
  }
  function applyDuelSeed(seed) {
    var handle = ctx.host && ctx.host.current && ctx.host.current.handle;
    if (handle && handle.setDuelSeed) { handle.setDuelSeed(seed); toast('Duel seed applied: ' + seed + '. Both players share this seed.', 'ok'); }
    else toast('Load Cosmos BTD first, then apply seed ' + seed + '.', 'warn');
  }
  async function renderChallenges() {
    var box = document.getElementById('challengeBox'); if (!box) return;
    if (!ctx.player) { stopDuelPolling(); box.innerHTML = '<p class="muted small">Connect your wallet to send or answer duel invites.</p>'; return; }
    var duels = [], history = [];
    try { var r = await api('/api/duels?address=' + encodeURIComponent(ctx.player.address)); duels = r.duels || []; } catch (e) {}
    try { var hr = await api('/api/duels/history?address=' + encodeURIComponent(ctx.player.address)); history = hr.history || []; } catch (e) {}
    var me = ctx.player.address;
    var feeOpts = (ctx.config && ctx.config.duels && ctx.config.duels.entryFees) || [0, 50, 100, 250];
    var rows = duels.slice(0, 5).map(function (d) {
      var other = d.challenger === me ? d.rival : d.challenger;
      var otherName = d.challenger === me ? (d.rivalName || shortAddr(d.rival)) : (d.challengerName || shortAddr(d.challenger));
      var feeText = (d.entryFee || 0) > 0 ? ' · fee ' + d.entryFee + ' credits' : ' · free';
      var seedText = d.seed ? ' · seed ' + d.seed : '';
      var statusText = d.status === 'live' ? 'LIVE RACE' : d.status === 'pending' ? (d.rivalResponse === 'accepted' ? 'Accepted — start the race' : 'Invite pending') : d.status.replace(/_/g, ' ');
      var actions = '';
      if (d.status === 'pending' && d.rival === me && !d.rivalResponse) actions = '<button data-accept="' + d.id + '">Accept</button> <button data-decline="' + d.id + '" class="ghost">Decline</button>';
      else if (d.status === 'pending' && d.rivalResponse === 'accepted') {
        actions = '<button data-start="' + d.id + '" class="primary">Start live race (10 min)</button> ';
        if ((d.entryFee || 0) === 0 && d.challenger === me) actions += '<input data-score="' + d.id + '" type="number" min="0" max="100000" placeholder="Your score" style="width:110px"> <button data-result="' + d.id + '">Submit result</button>';
      }
      else if (d.status === 'live') {
        var mineFirst = d.challenger === me;
        actions = '<span class="small" data-live-scores="' + d.id + '">You ' + (mineFirst ? d.liveScores.challenger : d.liveScores.rival) + ' — Rival ' + (mineFirst ? d.liveScores.rival : d.liveScores.challenger) + '</span> <span class="small muted" data-live-clock="' + d.id + '">' + (d.secondsLeft || 0) + 's left</span><br>'
          + '<input data-live-score="' + d.id + '" type="number" min="0" max="100000" placeholder="Your live score" style="width:130px"> <button data-live-post="' + d.id + '">Post score</button> <button data-live-finish="' + d.id + '" class="primary">Finish race</button> <button data-seed="' + d.id + '" class="ghost">Apply seed</button>';
      }
      return '<div class="questCard"><strong>' + esc(otherName) + '</strong> <span class="small muted">' + esc(shortAddr(other)) + ' · ' + esc(statusText) + esc(feeText) + esc(seedText) + (d.score != null && d.status !== 'live' ? ' · score ' + d.score : '') + (d.payout ? ' · payout ' + d.payout + ' credits' : '') + '</span><p style="margin:6px 0 0">' + actions + '</p></div>';
    }).join('');
    var histRows = history.slice(0, 5).map(function (d) {
      var outcome = d.outcome === 'won' ? '🏆 Won' : d.outcome === 'lost' ? 'Lost' : d.outcome === 'draw' ? 'Draw' : 'Declined';
      return '<div class="questCard"><strong>' + esc(d.opponentName || shortAddr(d.opponent)) + '</strong> <span class="small muted">' + esc(outcome) + ' · ' + d.myScore + '–' + d.opponentScore + ' · fee ' + (d.entryFee || 0) + (d.payout ? ' · payout ' + d.payout : '') + ' · seed ' + (d.seed || 0) + '</span> <button data-rematch="' + d.id + '" class="ghost">Rematch</button></div>';
    }).join('');
    box.innerHTML = '<label>Challenge a friend by address</label><input id="challengeAddr" type="text" placeholder="cosmos1… rival address"><label>Entry fee (credits only — winner takes most)</label><select id="challengeFee">' + feeOpts.map(function (f) { return '<option value="' + f + '">' + (f === 0 ? 'Free (0)' : f + ' credits') + '</option>'; }).join('') + '</select><p><button id="btnChallenge" class="primary">Send duel invite</button></p>' + (rows || '<p class="muted small">No duels yet.</p>') + '<h4 style="margin-top:10px">Duel history</h4>' + (histRows || '<p class="muted small">No finished duels yet.</p>');
    var live = null;
    for (var i = 0; i < duels.length; i++) if (duels[i].status === 'live') { live = duels[i]; break; }
    if (live) startDuelPolling(live.id); else stopDuelPolling();
    var sendBtn = document.getElementById('btnChallenge');
    if (sendBtn) sendBtn.addEventListener('click', async function () {
      var rival = (document.getElementById('challengeAddr').value || '').trim();
      if (!rival || rival.indexOf('cosmos1') !== 0) return toast('Enter a valid rival Cosmos address (cosmos1…).', 'warn');
      var feeEl = document.getElementById('challengeFee');
      var entryFee = feeEl ? Number(feeEl.value) || 0 : 0;
      try { await api('/api/duels', 'POST', { challengerAddress: me, rivalAddress: rival, entryFee: entryFee }); toast('Duel invite sent to ' + shortAddr(rival) + (entryFee ? ' · ' + entryFee + ' credit entry fee, held at race start.' : '.'), 'ok'); renderChallenges(); } catch (e) { toast(e.message, 'err'); }
    });
    box.querySelectorAll('[data-accept]').forEach(function (btn) { btn.addEventListener('click', async function () { try { await api('/api/duels/respond', 'POST', { duelId: btn.getAttribute('data-accept'), address: me, accept: true }); toast('Duel accepted.', 'ok'); renderChallenges(); } catch (e) { toast(e.message, 'err'); } }); });
    box.querySelectorAll('[data-decline]').forEach(function (btn) { btn.addEventListener('click', async function () { try { await api('/api/duels/respond', 'POST', { duelId: btn.getAttribute('data-decline'), address: me, accept: false }); toast('Duel declined.', 'ok'); renderChallenges(); } catch (e) { toast(e.message, 'err'); } }); });
    box.querySelectorAll('[data-result]').forEach(function (btn) { btn.addEventListener('click', async function () {
      var id = btn.getAttribute('data-result');
      var input = box.querySelector('[data-score="' + id + '"]');
      var score = input ? Number(input.value) : 0;
      if (!score) return toast('Enter your score first.', 'warn');
      try { var res = await api('/api/duels/result', 'POST', { duelId: id, address: me, score: score }); toast(res.won ? 'You won the duel! +150 credits, +100 XP.' : 'Duel decided: rival best was ' + res.rivalBest + '. +20 XP.', res.won ? 'ok' : 'warn'); renderChallenges(); refreshState(); } catch (e) { toast(e.message, 'err'); }
    }); });
    box.querySelectorAll('[data-start]').forEach(function (btn) { btn.addEventListener('click', async function () {
      var id = btn.getAttribute('data-start');
      try { var res = await api('/api/duels/start', 'POST', { duelId: id, address: me }); toast('Live race started! Seed ' + res.duel.seed + ' · ' + (res.duel.secondsLeft || res.duel.raceSeconds) + 's. Play Cosmos BTD now.', 'ok'); applyDuelSeed(res.duel.seed); renderChallenges(); refreshState(); } catch (e) { toast(e.message, 'err'); }
    }); });
    box.querySelectorAll('[data-live-post]').forEach(function (btn) { btn.addEventListener('click', async function () {
      var id = btn.getAttribute('data-live-post');
      var input = box.querySelector('[data-live-score="' + id + '"]');
      var score = input ? Number(input.value) : 0;
      if (!score && !(ctx.hud && ctx.hud.score)) return toast('Enter your live score first.', 'warn');
      var wave = (ctx.currentGame === 'cosmos-btd' && ctx.hud) ? (ctx.hud.wave || 0) : undefined;
      try { await api('/api/duels/live', 'POST', { duelId: id, address: me, score: score || ctx.hud.score, wave: wave }); toast('Live score posted.', 'ok'); pollLiveDuel(); } catch (e) { toast(e.message, 'err'); }
    }); });
    box.querySelectorAll('[data-live-finish]').forEach(function (btn) { btn.addEventListener('click', async function () {
      var id = btn.getAttribute('data-live-finish');
      try { var res = await api('/api/duels/finish', 'POST', { duelId: id, address: me }); toast(res.isDraw ? 'Duel drawn — entry fees refunded.' : res.winner === me ? 'You won the race! Payout recorded.' : 'Race finished — the rival won.', res.winner === me ? 'ok' : 'warn'); renderChallenges(); refreshState(); } catch (e) { toast(e.message, 'err'); }
    }); });
    box.querySelectorAll('[data-seed]').forEach(function (btn) { btn.addEventListener('click', function () {
      var id = btn.getAttribute('data-seed');
      var d = null; for (var k = 0; k < duels.length; k++) if (duels[k].id === id) d = duels[k];
      if (d) applyDuelSeed(d.seed);
    }); });
    box.querySelectorAll('[data-rematch]').forEach(function (btn) { btn.addEventListener('click', async function () {
      try { var res = await api('/api/duels/rematch', 'POST', { duelId: btn.getAttribute('data-rematch'), address: me }); toast('Rematch invite sent (seed ' + res.duel.seed + ').', 'ok'); renderChallenges(); } catch (e) { toast(e.message, 'err'); }
    }); });
  }
  async function renderReferral() {
    var box = document.getElementById('referralBox'); if (!box) return;
    if (!ctx.player) { box.innerHTML = '<p class="muted small">Connect your wallet for your referral code.</p>'; return; }
    try {
      var r = await api('/api/referral?address=' + encodeURIComponent(ctx.player.address));
      var link = window.location.origin + window.location.pathname + '?ref=' + r.referralCode;
      box.innerHTML = '<p class="small">Your code: <b class="mono">' + esc(r.referralCode) + '</b> <button id="btnCopyRef" class="ghost">Copy link</button><br>Invited: <b>' + r.referralCount + '</b>' + (r.referrals && r.referrals.length ? ' — ' + esc(r.referrals.map(function (x) { return x.name || shortAddr(x.address); }).join(', ')) : ' · no invites yet') + '<br><span class="muted">A friend opens your link, connects Keplr, and is counted. Tracked only — referrals pay nothing.</span></p>';
      var copyBtn = document.getElementById('btnCopyRef');
      if (copyBtn) copyBtn.addEventListener('click', function () {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(function () { toast('Referral link copied.', 'ok'); }, function () { toast(link, 'ok'); });
        else toast(link, 'ok');
      });
    } catch (e) { box.innerHTML = '<p class="muted small">Referral info unavailable.</p>'; }
  }
  function shareRunCard() {
    var vp = document.getElementById('game-viewport'); if (!vp) return;
    var canvas = vp.querySelector('canvas');
    if (!canvas) { toast('No game canvas to snapshot yet — load a game first.', 'warn'); return; }
    try {
      var out = document.createElement('canvas'); out.width = 960; out.height = 700;
      var c = out.getContext('2d');
      c.fillStyle = '#070b18'; c.fillRect(0, 0, 960, 700);
      c.drawImage(canvas, 0, 0, 960, 600);
      c.fillStyle = 'rgba(7,11,24,.92)'; c.fillRect(0, 600, 960, 100);
      var hud = ctx.hud || {};
      c.fillStyle = '#e8ecf8'; c.font = 'bold 26px system-ui, sans-serif';
      c.fillText((ctx.currentGame || 'game') + ' — GAME · game.atomstaking.app', 24, 638);
      c.fillStyle = '#ffd166'; c.font = '18px system-ui, sans-serif';
      c.fillText(('Score ' + (hud.score != null ? hud.score : '—') + ' · Wave ' + (hud.wave || '—') + ' · Pops ' + (hud.pops || 0) + (ctx.player ? ' · ' + (ctx.player.name || '') : '')).slice(0, 80), 24, 666);
      c.fillStyle = '#9fb4d8'; c.font = '14px system-ui, sans-serif';
      c.fillText(new Date().toISOString().slice(0, 10), 24, 690);
      out.toBlob(function (blob) {
        if (!blob) { toast('Could not create the share image.', 'err'); return; }
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a'); a.href = url; a.download = 'game-run-card.png';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        toast('Run card downloaded.', 'ok');
      }, 'image/png');
    } catch (e) { toast('Share card failed: ' + e.message, 'err'); }
  }
  ctx.shareRunCard = shareRunCard;
  function renderAnnouncements() {
    var el = document.getElementById('announceBar'); if (!el) return;
    var ann = (ctx.state && ctx.state.announcements) || [];
    if (!ann.length) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = ann.map(function (a) { return '<p><strong>📢 ' + esc(a.title) + '</strong> — ' + esc(a.body) + ' <span class="muted small">' + esc((a.at || '').slice(0, 10)) + '</span></p>'; }).join('');
  }
  async function renderProfile() {
    var box = document.getElementById('profileBox'); if (!box) return;
    if (!ctx.player) { box.innerHTML = '<p class="muted small">Connect your wallet.</p>'; return; }
    var p = ctx.player;
    var mine = ((ctx.state && ctx.state.players) || []).find(function (x) { return x.address === p.address; }) || {};
    box.innerHTML = '<p class="small"><strong>' + esc(p.name || 'Player') + '</strong> · Lv ' + (p.level || 1) + '<br>Credits <b>' + (p.credits || 0) + '</b> · XP ' + (p.xp || 0) + '<br>Best score ' + (mine.bestScore != null ? mine.bestScore : (p.bestScore || 0)) + ' · Best wave ' + (mine.bestWave || 0) + ' · Total pops ' + (mine.totalPops || 0) + ' · Achievements ' + (mine.achievements || 0) + '</p>';
    var qb = document.getElementById('questBox');
    if (qb) { try { var q = await api('/api/quests?address=' + encodeURIComponent(p.address)); qb.innerHTML = q.quests.map(function (x) { return '<div class="questCard"><strong>' + esc(x.name) + '</strong><br><span class="small">' + x.progress + '/' + x.target + ' · ' + x.reward + ' credits</span> ' + (x.claimed ? '<span class="pill closed">Claimed</span>' : x.done ? '<button data-claim="' + x.id + '">Claim</button>' : '<span class="pill">In progress</span>') + '</div>'; }).join(''); qb.querySelectorAll('[data-claim]').forEach(function (btn) { btn.addEventListener('click', async function () { try { var r = await api('/api/quests/claim', 'POST', { address: p.address, questId: btn.getAttribute('data-claim') }); ctx.player = r.player; toast('Quest reward: +' + r.reward + ' credits.', 'ok'); renderProfile(); refreshState(); } catch (e) { toast(e.message, 'err'); } }); }); } catch (e) { qb.innerHTML = '<p class="muted small">Quests unavailable.</p>'; } }
    var ab = document.getElementById('achBox');
    if (ab) { try { var a = await api('/api/achievements?address=' + encodeURIComponent(p.address)); ab.innerHTML = '<div class="achGrid">' + a.achievements.map(function (x) { return '<div class="ach ' + (x.unlocked ? 'got' : 'locked') + '" title="' + esc(x.desc) + '">' + (x.unlocked ? '🏆' : '🔒') + ' ' + esc(x.name) + '</div>'; }).join('') + '</div>'; } catch (e) {} }
  }
  function settingsFormHtml() {
    return '<label>Master audio</label><input id="setVol" type="range" min="0" max="1" step="0.1" value="' + ctx.settings.volume + '">'
      + '<label>Graphics quality</label><select id="setQuality"><option value="high">High</option><option value="low">Low (faster)</option></select>'
      + '<label>FPS target</label><select id="setFps"><option value="30">30</option><option value="60">60</option><option value="120">120 (display-limited)</option></select>'
      + '<label>Particle density</label><select id="setParticles"><option value="low">Low</option><option value="med">Medium</option><option value="high">High</option></select>'
      + '<label>Display scaling (Retina/HiDPI)</label><select id="setDisplay"><option value="auto">Auto (device pixel ratio)</option><option value="1">1x</option><option value="1.5">1.5x</option><option value="2">2x</option></select>'
      + '<label>UI text scale</label><select id="setUiScale"><option value="0.9">Small (0.9x)</option><option value="1">Normal (1x)</option><option value="1.15">Large (1.15x)</option></select>'
      + '<label class="checkRow"><input id="setColorblind" type="checkbox" ' + (ctx.settings.colorblind ? 'checked' : '') + '> Colorblind palette (distinct hues + 3-letter balloon labels)</label>'
      + '<label class="checkRow"><input id="setReducedMotion" type="checkbox" ' + (ctx.settings.reducedMotion ? 'checked' : '') + '> Reduced motion (no screen shake, no particle bursts, no tilt-shift bands)</label>'
      + '<label class="checkRow"><input id="setMotionBlur" type="checkbox" ' + (ctx.settings.motionBlur ? 'checked' : '') + '> Motion blur (projectile streaks / beam glow)</label>'
      + '<label class="checkRow"><input id="setPostFx" type="checkbox" ' + (ctx.settings.postfx !== false ? 'checked' : '') + '> Post-processing (bloom / lighting / vignette)</label>'
      + '<label class="checkRow"><input id="setDof" type="checkbox" ' + (ctx.settings.dof !== false ? 'checked' : '') + '> Cinematic tilt-shift bands</label>'
      + '<label class="checkRow"><input id="setGlass" type="checkbox" ' + (ctx.settings.glass !== false ? 'checked' : '') + '> Glassmorphism theme (translucent panels, blur, glowing borders)</label>'
      + '<label class="checkRow"><input id="setUiSounds" type="checkbox" ' + (ctx.settings.uiSounds !== false ? 'checked' : '') + '> UI hover / click sounds</label>'
      + '<label class="checkRow"><input id="setAmbientHum" type="checkbox" ' + (ctx.settings.ambientHum !== false ? 'checked' : '') + '> Ambient space hum (quiet Web Audio drone, starts after your first click or keypress)</label>';
  }
  function wireSettingsControls(root) {
    var q = function (sel) { return root.querySelector(sel); };
    var handle = function () { return ctx.host.current && ctx.host.current.handle; };
    var s = q('#setQuality'); if (s) { s.value = ctx.settings.quality; s.addEventListener('change', function () { ctx.settings.quality = s.value; saveSettings(); applySettings(handle()); }); }
    var f = q('#setFps'); if (f) { f.value = String(ctx.settings.fpsTarget || 60); f.addEventListener('change', function () { ctx.settings.fpsTarget = Number(f.value); saveSettings(); applySettings(handle()); }); }
    var p = q('#setParticles'); if (p) { p.value = ctx.settings.particleDensity || 'high'; p.addEventListener('change', function () { ctx.settings.particleDensity = p.value; saveSettings(); applySettings(handle()); }); }
    var d = q('#setDisplay'); if (d) { d.value = ctx.settings.displayScale || 'auto'; d.addEventListener('change', function () { ctx.settings.displayScale = d.value; saveSettings(); applySettings(handle()); }); }
    var u = q('#setUiScale'); if (u) { u.value = String(ctx.settings.uiScale || 1); u.addEventListener('change', function () { ctx.settings.uiScale = Number(u.value); saveSettings(); applyUiPrefs(); }); }
    var v = q('#setVol'); if (v) v.addEventListener('input', function () { ctx.settings.volume = Number(v.value); saveSettings(); applySettings(handle()); });
    [['#setPostFx', 'postfx'], ['#setDof', 'dof'], ['#setMotionBlur', 'motionBlur'], ['#setGlass', 'glass'], ['#setUiSounds', 'uiSounds'], ['#setAmbientHum', 'ambientHum'], ['#setColorblind', 'colorblind'], ['#setReducedMotion', 'reducedMotion']].forEach(function (pair) {
      var el = q(pair[0]); if (!el) return;
      el.addEventListener('change', function (ev) { ctx.settings[pair[1]] = ev.target.checked; saveSettings(); applySettings(handle()); });
    });
  }
  function openSettings() { renderSettingsPanel(); var m = document.getElementById('settingsModal'); if (m) m.hidden = false; }
  function closeSettings() { var m = document.getElementById('settingsModal'); if (m) m.hidden = true; }
  /* ---- Batch 20: keyboard shortcuts overlay ---- * Press ? anywhere
   * in the hub to see every game key in one place; Escape or the
   * Close button hides it. The list mirrors the real bindings in
   * btd.js (1-8/Space/P/R/U/X/Enter/arrows/~) — no invented keys. */
  var SHORTCUTS_HTML = '<table class="shortcutTable">'
    + '<tr><td><b>1–8</b></td><td>Pick a tower (Cosmos BTD)</td></tr>'
    + '<tr><td><b>Space</b></td><td>Start the next wave</td></tr>'
    + '<tr><td><b>Enter</b></td><td>Place / select at the keyboard cursor</td></tr>'
    + '<tr><td><b>Arrow keys</b></td><td>Move the keyboard cursor (Shift = big step)</td></tr>'
    + '<tr><td><b>U</b></td><td>Upgrade the selected tower</td></tr>'
    + '<tr><td><b>X</b></td><td>Sell the selected tower</td></tr>'
    + '<tr><td><b>P</b></td><td>Pause / resume</td></tr>'
    + '<tr><td><b>R</b></td><td>Restart the run</td></tr>'
    + '<tr><td><b>Esc</b></td><td>Cancel placement / close panels</td></tr>'
    + '<tr><td><b>~</b></td><td>Debug console + performance monitor</td></tr>'
    + '<tr><td><b>?</b></td><td>Show / hide this shortcuts panel</td></tr></table>';
  function toggleShortcuts() { var m = document.getElementById('shortcutsOverlay'); if (!m) return; m.hidden = !m.hidden; if (!m.hidden) { var b = document.getElementById('shortcutsOverlayBody'); if (b) b.innerHTML = SHORTCUTS_HTML; } }
  function closeShortcuts() { var m = document.getElementById('shortcutsOverlay'); if (m) m.hidden = true; }
  function renderSettingsPanel() {
    var modal = document.getElementById('settingsModalBody');
    if (modal) { modal.innerHTML = settingsFormHtml(); wireSettingsControls(modal); }
    var el = document.getElementById('settingsBox');
    if (el) el.innerHTML = '<button id="btnOpenSettings" class="primary">⚙ Open settings</button><p class="small muted">FPS target, motion blur, particle density, display scaling, glass theme, UI scale, UI sounds, ambient hum, colorblind palette &amp; reduced motion.</p>';
    var openBtn = document.getElementById('btnOpenSettings'); if (openBtn) openBtn.onclick = openSettings;
    var topBtn = document.getElementById('btnSettings'); if (topBtn) topBtn.onclick = openSettings;
    var closeBtn = document.getElementById('btnCloseSettings'); if (closeBtn) closeBtn.onclick = closeSettings;
    var overlay = document.getElementById('settingsModal'); if (overlay) overlay.onclick = function (ev) { if (ev.target === overlay) closeSettings(); };
    /* Batch 20: shortcuts overlay wiring (same modal pattern). */
    var scBtn = document.getElementById('btnCloseShortcuts'); if (scBtn) scBtn.onclick = closeShortcuts;
    var scTop = document.getElementById('btnShortcuts'); if (scTop) scTop.onclick = toggleShortcuts;
    var scOverlay = document.getElementById('shortcutsOverlay'); if (scOverlay) scOverlay.onclick = function (ev) { if (ev.target === scOverlay) closeShortcuts(); };
    applyUiPrefs();
  }
  /* Inspection stat card: hover/select a BTD tower to see animated stat
   * bars, the upgrade tree step, sell refund, and a tactical
   * effectiveness chart. Re-rendered only when the payload changes so
   * the CSS bar transitions actually animate. */
  var _inspectKey = '';
  function renderInspectCard() {
    var card = document.getElementById('inspectBars'); if (!card) return;
    var hud = ctx.hud || {};
    var ins = ctx.currentGame === 'cosmos-btd' ? hud.inspect : null;
    if (!ins) { if (!card.hidden || card.innerHTML) { card.hidden = true; card.innerHTML = ''; _inspectKey = ''; } return; }
    var key = JSON.stringify(ins);
    if (key === _inspectKey && !card.hidden) return;
    _inspectKey = key;
    var eff = ins.effectiveness || {};
    var bar = function (label, val, max, color) {
      return '<div class="effRow"><span>' + esc(label) + '</span><div class="statBar"><div style="width:' + Math.round(100 * Math.max(0, Math.min(max, val)) / max) + '%;' + (color ? 'background:' + color + ';' : '') + '"></div></div><span>' + val + '</span></div>';
    };
    card.hidden = false;
    card.innerHTML = '<h3>🔍 ' + esc(ins.name) + ' — Lv ' + ins.level + (ins.maxed ? ' (MAX)' : '') + '</h3>'
      + bar('Damage', ins.dmg, 10, '#ff6b35')
      + bar('Range', ins.range, 350, '#00f6ff')
      + bar('Shots/sec', (1 / Math.max(0.22, ins.rate)).toFixed(1), 5, '#ffd166')
      + '<p class="small"><strong>Upgrade tree:</strong> ' + (ins.upgradeCost ? ins.upgradeCost + 'g → Lv ' + (ins.level + 1) + ' (dmg ' + ins.nextDmg + ', range ' + ins.nextRange + ')' : 'MAX — fully upgraded') + ' · Sell refund ' + ins.sellRefund + 'g · Cost ' + ins.cost + 'g</p>'
      + (ins.evolution || ins.branch ? '<p class="small"><strong>Branch:</strong> ' + esc(ins.evolution ? ins.evolution + (ins.branch ? ' · ' + esc(ins.branch) + ' ' + ins.branchLevel + '/3' : '') : (ins.branch ? esc(ins.branch) + ' ' + ins.branchLevel + '/3' : 'none yet — reach Lv 2')) + '</p>' : '')
      + '<p class="small"><strong>Tactical effectiveness</strong></p>'
      + bar('vs Fast', eff.fast || 0, 100, '#3ddc5f')
      + bar('vs Armored', eff.armored || 0, 100, '#c9ced6')
      + bar('vs Camo', eff.camo || 0, 100, '#1f2937')
      + bar('vs Boss', eff.boss || 0, 100, '#ff5a5a');
  }
  async function renderFeatures() {
    var el = document.getElementById('updatesList'); if (!el) return;
    try {
      var res = await fetch('/features.json'); var data = await res.json();
      var groups = {};
      (data.features || []).forEach(function (f) { (groups[f.category] = groups[f.category] || []).push(f); });
      el.innerHTML = '<p class="small">Version <b>' + esc(data.version || '') + '</b> · ' + (data.features || []).length + ' tracked features · each tested locally before deploy.</p>' + Object.keys(groups).map(function (cat) { return '<h4>' + esc(cat) + '</h4><ul class="featureList">' + groups[cat].map(function (f) { return '<li><span class="ok">✓</span> <strong>' + esc(f.title) + '</strong> <span class="muted small">— ' + esc(f.tested || 'tested') + '</span></li>'; }).join('') + '</ul>'; }).join('');
    } catch (e) { el.innerHTML = '<p class="muted">Feature list unavailable.</p>'; }
  }
  function heroImg(h) {
    var map = { astra: 'hero-astra', lyra: 'hero-lyra', koda: 'hero-koda', nova7: 'hero-nova7', vex: 'hero-vex', orin: 'hero-orin' };
    var src = 'assets/sprites/' + (map[h.defId] || 'hero-orin') + '.png';
    return '<img src="' + src + '" alt="" onerror="this.outerHTML=\'<span class=heroDot style=background:' + (h.color || '#333') + '>★</span>\'">';
  }
  ctx.heroImg = heroImg;
  function renderHeroes(heroes) {
    var el = document.getElementById('heroList'); if (!el) return;
    var equipped = ctx.host && ctx.host.equippedHero;
    el.innerHTML = heroes.length ? heroes.map(function (h) {
      var isEquipped = !!(equipped && equipped.id === h.id);
      return '<div class="heroCard' + (isEquipped ? ' equipped' : '') + '">' + heroImg(h) + '<div style="flex:1"><strong>' + esc(h.name) + '</strong><br><span class="small muted">Lv ' + h.level + ' · ' + esc(h.rarity) + ' · Power ' + h.basePower + '</span></div>'
        + '<button data-equip="' + h.id + '">' + (isEquipped ? 'Equipped ✓' : 'Equip') + '</button></div>';
    }).join('') : '<p class="muted small">No heroes yet. Claim a hero below (unlocks by level).</p>';
    el.querySelectorAll('[data-equip]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var h = heroes.find(function (x) { return x.id === btn.getAttribute('data-equip'); });
        ctx.host.equipHero(h); toast(h.name + ' equipped.', 'ok'); renderHeroes(heroes);
      });
    });
    var actions = document.getElementById('heroActions');
    var defs = (ctx.config && ctx.config.heroDefs) || [];
    var buyCosts = (ctx.config && ctx.config.heroBuyCosts) || {};
    var buyOpts = defs.map(function (d) { var c = buyCosts[d.rarity] || 5000; return '<option value="' + d.id + '">' + esc(d.name) + ' — ' + c + ' credits</option>'; }).join('');
    var bal = ctx.player ? (ctx.player.credits || 0) : 0;
    actions.innerHTML = '<label>Claim hero (if unlocked)</label><select id="claimHeroSel">' + defs.map(function (d) { return '<option value="' + d.id + '">' + esc(d.name) + ' — Lv ' + d.unlockLevel + '+</option>'; }).join('') + '</select>'
      + '<div style="display:flex;gap:6px;margin-top:6px"><button id="btnGetHero">Get hero</button><button id="btnUpgradeHero" class="ghost">Upgrade equipped (200×Lv)</button></div>'
      + '<label style="margin-top:8px">Buy hero with in-game credits (any player level — costs a lot)</label><select id="buyHeroSel">' + buyOpts + '</select>'
      + '<div style="display:flex;gap:6px;margin-top:6px;align-items:center"><button id="btnBuyHero">Buy hero</button><span class="small muted">Your credits: ' + bal + '</span></div>';
    document.getElementById('btnGetHero').addEventListener('click', async function () {
      if (!ctx.player) return toast('Connect your wallet first.', 'warn');
      try { var r = await api('/api/heroes/claim', 'POST', { address: ctx.player.address, defId: document.getElementById('claimHeroSel').value }); toast('Hero added: ' + r.hero.name, 'ok'); refreshState(); } catch (e) { toast(e.message, 'err'); }
    });
    document.getElementById('btnUpgradeHero').addEventListener('click', async function () {
      var h = ctx.host.equippedHero; if (!h) return toast('Equip a hero first.', 'warn');
      try { var r = await api('/api/heroes/upgrade', 'POST', { address: ctx.player.address, heroId: h.id }); toast('Upgraded to Lv ' + r.hero.level, 'ok'); refreshState(); } catch (e) { toast(e.message, 'err'); }
    });
    document.getElementById('btnBuyHero').addEventListener('click', async function () {
      if (!ctx.player) return toast('Connect your wallet first.', 'warn');
      try { var r = await api('/api/heroes/buy', 'POST', { address: ctx.player.address, defId: document.getElementById('buyHeroSel').value }); toast('Hero bought: ' + r.hero.name + ' (' + r.credits + ' credits left)', 'ok'); refreshState(); } catch (e) { toast(e.message, 'err'); }
    });
  }
  var GAME_IMAGES = { 'cosmos-btd': 'assets/sprites/battlefield.jpg' };
  function gameMeta(g) {
    return { id: g.id, name: g.name, tagline: g.tagline || '', status: g.status || 'playable',
      image: g.image || GAME_IMAGES[g.id] || 'assets/sprites/battlefield.jpg',
      tags: (g.tags || []).slice(),
      description: g.description || g.tagline || '' };
  }
  function recordRecent(id) {
    try {
      var list = JSON.parse(localStorage.getItem('game-recent') || '[]');
      list = list.filter(function (x) { return x.id !== id; });
      list.unshift({ id: id, at: new Date().toISOString().slice(0, 10) });
      localStorage.setItem('game-recent', JSON.stringify(list.slice(0, 5)));
    } catch (e) {}
  }
  function renderRecent() {
    var el = document.getElementById('recentBox'); if (!el) return;
    var list = [];
    try { list = JSON.parse(localStorage.getItem('game-recent') || '[]'); } catch (e) {}
    var games = ctx.host ? ctx.host.listGames() : [];
    if (!list.length) { el.innerHTML = '<p class="muted small">No games played yet. Pick a game above.</p>'; return; }
    el.innerHTML = list.map(function (r) {
      var g = games.filter(function (x) { return x.id === r.id; })[0];
      if (!g) return '';
      var m = gameMeta(g);
      return '<div class="recentRow"><img src="' + m.image + '" alt="" onerror="this.style.display=\'none\'"><div style="flex:1"><strong>' + esc(m.name) + '</strong><br><span class="small muted">Last played ' + esc(r.at || '') + '</span></div><button data-recent="' + m.id + '">Play</button></div>';
    }).join('');
    el.querySelectorAll('[data-recent]').forEach(function (btn) { btn.addEventListener('click', function () { loadGame(btn.getAttribute('data-recent')); }); });
  }
  function tagChipsHtml(tags) {
    if (!tags || !tags.length) return '';
    return '<p class="tagRow">' + tags.map(function (t) { return '<span class="tagChip">' + esc(t) + '</span>'; }).join('') + '</p>';
  }
  var activeTag = '';
  function renderTagFilter() {
    var el = document.getElementById('tagFilter'); if (!el) return;
    var seen = {};
    ctx.host.listGames().forEach(function (g) { (g.tags || []).forEach(function (t) { seen[t] = true; }); });
    var tags = Object.keys(seen).sort();
    el.innerHTML = '<button class="tagChip' + (!activeTag ? ' active' : '') + '" data-tag="">All</button>' + tags.map(function (t) { return '<button class="tagChip' + (activeTag === t ? ' active' : '') + '" data-tag="' + esc(t) + '">' + esc(t) + '</button>'; }).join('');
    el.querySelectorAll('[data-tag]').forEach(function (b) { b.addEventListener('click', function () { activeTag = b.getAttribute('data-tag'); renderTagFilter(); filterGameCards((document.getElementById('gameSearch') || {}).value || ''); }); });
  }
  function openGameInfo(id) {
    var games = ctx.host.listGames();
    var g = games.filter(function (x) { return x.id === id; })[0];
    if (!g) return;
    var m = gameMeta(g);
    var body = document.getElementById('gamePickerBody'); if (!body) return;
    body.innerHTML = '<img src="' + m.image + '" alt="">'
      + '<h3>' + esc(m.name) + ' <span class="pill">' + esc(m.status) + '</span></h3>'
      + '<p class="gameDesc">' + esc(m.description) + '</p>'
      + '<p class="small muted">' + esc(m.tagline) + '</p>'
      + tagChipsHtml(m.tags);
    var pk = document.getElementById('gamePicker');
    pk.setAttribute('data-game', m.id);
    var play = document.getElementById('btnPlayPicker'); if (play) play.disabled = (m.status !== 'playable');
    pk.hidden = false;
  }
  function closeGamePicker() { var pk = document.getElementById('gamePicker'); if (pk) pk.hidden = true; }
  ctx.openGameInfo = openGameInfo; ctx.closeGamePicker = closeGamePicker;
  function filterGameCards(q) {
    q = (q || '').toLowerCase();
    document.querySelectorAll('#gameCards .gameCard').forEach(function (c) {
      var okQ = !q || (c.getAttribute('data-search') || '').indexOf(q) >= 0;
      var tags = (c.getAttribute('data-tags') || '').split(',').filter(Boolean);
      var okT = !activeTag || tags.indexOf(activeTag.toLowerCase()) >= 0;
      c.style.display = (okQ && okT) ? '' : 'none';
    });
  }
  function renderGameList() {
    var grid = document.getElementById('storeGrid'); if (!grid) return;
    var ver = (ctx.config && ctx.config.version) || '';
    grid.innerHTML = '<article class="storeCard hl" data-search="cosmos btd orb defense tower defense space heroes">'
      + '<div class="small muted">COSMOS BTD: ORB DEFENSE' + (ver ? ' (v' + esc(ver) + ')' : '') + '</div>'
      + '<img class="thumb" src="assets/sprites/battlefield.jpg" alt="Cosmos BTD battlefield under a nebula sky" onerror="this.style.display=\'none\'">'
      + '<h3>COSMOS BTD: ORB DEFENSE' + (ver ? ' (v' + esc(ver) + ')' : '') + '</h3>'
      + '<p>Protect the ATOM Orb! Deep Strategy Tower Defense.</p>'
      + '<p class="tagRow"><span class="tagChip">Tower Defense</span><span class="tagChip">Space</span><span class="tagChip">Heroes</span><span class="tagChip">50 Waves</span><span class="tagChip">2 Maps</span></p>'
      + '<p><button class="playNow" data-play-btd style="width:100%">▶ PLAY NOW (FULLSCREEN)</button></p>'
      + '<p><button data-dev-setup class="devSetup" style="width:100%">DEV STUDIO SETUP</button></p>'
      + '</article>'
      + '<button type="button" class="storeCard soon" data-search="coming soon title unannounced"><span>COMING SOON<small>(TITLE UNANNOUNCED)</small></span></button>'
      + '<button type="button" class="storeCard soon" data-search="coming soon title unannounced"><span>COMING SOON<small>(TITLE UNANNOUNCED)</small></span></button>';
    grid.querySelectorAll('[data-play-btd]').forEach(function (b) { b.addEventListener('click', function () { enterGameMode(true); }); });
    grid.querySelectorAll('[data-dev-setup]').forEach(function (b) { b.addEventListener('click', function () { showView('devtools'); }); });
    grid.querySelectorAll('.storeCard.soon').forEach(function (c) { c.addEventListener('click', function () { toast('Coming soon.'); }); });
  }
  async function startSession() {
    if (!ctx.player) return;
    try { ctx.session = await api('/api/session/start', 'POST', { address: ctx.player.address }); } catch (e) { ctx.session = null; }
  }
  async function loadGame(gameId) {
    ctx.currentGame = gameId;
    recordRecent(gameId); renderRecent();
    renderGameList();
    var opts = {
      onHud: function (hud) { ctx.hud = hud; renderActionBar(); },
      onToast: toast,
      sessionId: ctx.session && ctx.session.sessionId,
      sessionNonce: ctx.session && ctx.session.nonce,
      onWaveReport: submitWaveReport,
      onTowerSelect: function (t) { ctx.selectedTower = t; renderActionBar(); setInspectorOpen(!!t); }
    };
    try {
      await ctx.host.loadGame(gameId, opts);
      var handle = ctx.host.current && ctx.host.current.handle;
      if (handle && handle.setSession && ctx.session) handle.setSession(ctx.session.sessionId, ctx.session.nonce);
      applySettings(handle);
      renderActionBar();
    } catch (e) { ctx.host.unloadGame(); toast('Could not open ' + gameId + ': ' + e.message, 'err'); }
  }
  function openGameInTab(id) { try { window.open(window.location.pathname + '?game=' + encodeURIComponent(id), '_blank', 'noopener'); } catch (e) { loadGame(id); } }
  ctx.openGameInTab = openGameInTab;
  ctx.loadGame = loadGame;
  async function submitWaveReport(payload) {
    if (!ctx.player) return;
    if (payload.wave > 50) return; // endless mode beyond the 50-wave campaign: local score only
    try {
      var r = await api('/api/progress/secure', 'POST', { address: ctx.player.address, sessionId: payload.sessionId, waveReached: payload.wave, score: payload.score, pops: payload.pops, heroXp: payload.heroXp, stateHash: payload.stateHash, won: payload.wave >= 50 });
      if (r.flagged) { toast('Wave claim flagged for CEO audit: ' + (r.reasons || []).join(', '), 'warn'); bus.emit('game:session_flagged', { address: ctx.player.address, reasons: r.reasons }); }
      else if (r.player) { ctx.player = r.player; toast('Wave ' + payload.wave + ' saved: +' + r.xpGain + ' XP, +' + r.creditGain + ' credits.', 'ok'); if (r.achievementsUnlocked && r.achievementsUnlocked.length) toast('🏆 Achievement: ' + r.achievementsUnlocked.map(function (a) { return a.name; }).join(', '), 'ok'); }
      var hero = ctx.host.equippedHero;
      if (hero && payload.heroXp > 0) { try { await api('/api/heroes/add-xp', 'POST', { address: ctx.player.address, heroId: hero.id, xp: Math.min(1000, payload.heroXp), pops: payload.pops }); } catch (e) {} }
      refreshState();
    } catch (e) { /* wave already counted locally; server sync is best-effort */ }
  }
  var gameSideTab = 'towers';
  function setGameSideTab(t) { gameSideTab = t; renderActionBar(); }
  ctx.setGameSideTab = setGameSideTab;

  /* Hub + game-screen renders (blueprint build): the top deck, bottom
   * deck, slide-over inspector and perf overlay all read the live HUD
   * snapshot (ctx.hud) — every number shown is measured, never faked. */
  var DECK_ORDER = ['dart', 'mortar', 'frost', 'sniper', 'cannon', 'tesla', 'spikes', 'beacon'];
  var _deckBuilt = false;
  var _inspOpen = false;
  var _perfHist = { fps: [], particles: [] };

  function renderActionBar() {
    renderTopDeck();
    buildDeckOnce();
    updateDeck();
    renderInspectorHead();
    renderInspectCard();
    renderInspectorControls();
    renderInspectorMarket();
  }

  function renderTopDeck() {
    var hud = ctx.hud || {};
    var w = document.getElementById('gameWaveChip');
    if (w) w.textContent = '[WAVE ' + (hud.wave || 0) + (hud.endless ? '/∞' : '/50') + ']';
    var g = document.getElementById('gameGold');
    if (g) g.textContent = (hud.gold != null ? hud.gold : '—');
    var s = document.getElementById('gameShield');
    if (s) s.textContent = (hud.lives != null ? hud.lives : '—');
    var a = document.getElementById('btnGameAuto');
    if (a) a.textContent = hud.autoStart ? 'ON' : 'OFF';
    var sp = document.getElementById('gameSpeed');
    if (sp) sp.value = String(hud.speed || 1);
    var p = document.getElementById('btnGamePause');
    if (p) p.textContent = hud.paused ? '▶ Resume' : '⏸ Pause';
  }

  function buildDeckOnce() {
    if (_deckBuilt) return;
    var bar = document.getElementById('buildBar'); if (!bar) return;
    var defs = (window.CosmosBTD && window.CosmosBTD.TOWER_DEFS) || {};
    var sprMap = (window.CosmosBTD && window.CosmosBTD.TOWER_SPRITES) || {};
    if (!defs.dart) return;
    var html = DECK_ORDER.map(function (k) {
      var d = defs[k]; if (!d) return '';
      var spr = sprMap[k] || 'tower-validator';
      return '<button class="deckTile" data-tower="' + k + '" title="' + esc(d.desc) + '"><img src="assets/sprites/' + spr + '.png" alt="" onerror="this.outerHTML=\'<span class=towerDot style=background:' + d.color + '></span>\'"><strong>' + d.name + '</strong><small>' + d.cost + 'g (' + d.key + ')</small></button>';
    }).join('');
    var hero = (ctx.host && ctx.host.equippedHero) || null;
    var heroImgHtml = hero ? heroImg(hero) : '<img src="assets/sprites/hero-astra.png" alt="" onerror="this.style.display=\'none\'">';
    var heroName = hero ? hero.name : 'Hero Commander';
    html += '<button class="deckTile heroTile" data-hero-tile title="Hero ability">' + heroImgHtml + '<strong>' + esc(heroName) + '</strong><small data-hero-sub>Ability</small></button>';
    bar.innerHTML = html;
    bar.querySelectorAll('[data-tower]').forEach(function (btn) {
      btn.addEventListener('click', function () { var h = btdHandle(); if (h) h.setPlacing(btn.getAttribute('data-tower')); });
    });
    var hb = bar.querySelector('[data-hero-tile]');
    if (hb) hb.addEventListener('click', function () { var h = btdHandle(); if (h) h.heroAbility(); });
    _deckBuilt = true;
  }

  function updateDeck() {
    var bar = document.getElementById('buildBar'); if (!bar || !_deckBuilt) return;
    var hud = ctx.hud || {};
    var defs = (window.CosmosBTD && window.CosmosBTD.TOWER_DEFS) || {};
    bar.querySelectorAll('[data-tower]').forEach(function (btn) {
      var d = defs[btn.getAttribute('data-tower')];
      btn.classList.toggle('active', hud.placing === btn.getAttribute('data-tower'));
      btn.classList.toggle('cant', !!d && (hud.gold == null || hud.gold < d.cost));
    });
    var sub = bar.querySelector('[data-hero-sub]');
    if (sub) { var cd = Math.max(0, hud.heroCd || 0); sub.textContent = cd > 0 ? 'Ability (' + cd + 's)' : 'Ability ready'; }
  }

  function renderInspectorHead() {
    var el = document.getElementById('inspectorHead'); if (!el) return;
    var hud = ctx.hud || {};
    var ins = hud.inspect || null;
    if (ins) {
      var sprMap = (window.CosmosBTD && window.CosmosBTD.TOWER_SPRITES) || {};
      var spr = sprMap[ins.kind || ins.defId] || 'tower-validator';
      el.innerHTML = '<img src="assets/sprites/' + spr + '.png" alt="" onerror="this.style.display=\'none\'"><div><strong>' + esc(ins.name) + '</strong><br><span class="small muted">Level ' + ins.level + (ins.maxed ? ' (MAX)' : '') + ' · BTD Tower</span></div>';
    } else if (ctx.host && ctx.host.equippedHero) {
      var h = ctx.host.equippedHero;
      el.innerHTML = heroImg(h) + '<div><strong>' + esc(h.name) + '</strong><br><span class="small muted">Level ' + h.level + ' · ' + esc(h.rarity || '') + ' · Power ' + h.basePower + '</span></div>';
    } else {
      el.innerHTML = '<img src="assets/sprites/battlefield.jpg" alt=""><div><strong>Cosmos BTD</strong><br><span class="small muted">Click a tower on the board to inspect it.</span></div>';
    }
  }

  function renderInspectorControls() {
    var box = document.getElementById('inspectorControls'); if (!box) return;
    var hud = ctx.hud || {};
    var handle = btdHandle();
    var ins = hud.inspect || null;
    var sellLabel = (ins && ins.sellRefund != null) ? 'Sell +' + ins.sellRefund + 'g' : 'Sell 70%';
    var branchHtml = '';
    if (ins && ins.branchOptions) {
      branchHtml = '<p>' + ins.branchOptions.map(function (o) {
        return '<button data-branch="' + o.branch + '"' + (o.locked || o.cost == null ? ' disabled' : '') + '>' + esc(o.name) + ' ' + (o.cost != null ? o.cost + 'g' : 'MAX') + '</button>';
      }).join(' ') + '</p>';
    }
    var upHtml = ins
      ? '<h4>Upgrade Paths</h4>'
        + '<p class="small">Upgrade: ' + (ins.upgradeCost ? ins.upgradeCost + 'g → Lv ' + (ins.level + 1) + ' (dmg ' + ins.nextDmg + ', range ' + ins.nextRange + ')' : 'MAX — fully upgraded') + '</p>'
        + '<p class="small">Sell refund ' + ins.sellRefund + 'g · Cost ' + ins.cost + 'g</p>'
        + '<p><button id="abUpgrade">Upgrade ★</button> <button id="abSell" class="ghost">' + esc(sellLabel) + '</button></p>' + branchHtml
      : '<p class="muted small">Click a placed tower on the board to inspect it here, then upgrade or sell it.</p>';
    var cdLeft = Math.max(0, hud.heroCd || 0);
    var cdMax = hud.heroCdMax || 12;
    var cdPct = cdLeft > 0 ? Math.max(0, Math.round(100 * (1 - cdLeft / cdMax))) : 100;
    var heroName = (ctx.host && ctx.host.equippedHero && ctx.host.equippedHero.name) || 'Hero';
    var heroHtml = '<h4>🦸 ' + esc(heroName) + '</h4>'
      + '<p class="small">Tier ' + (hud.heroTier || 1) + ' · ' + (hud.heroKills || 0) + ' kills · Patrol: ' + (hud.heroPatrol ? 'ON' : 'OFF') + '</p>'
      + '<p><button id="abAbility">Hero ability' + (cdLeft > 0 ? ' (' + cdLeft + 's)' : '') + '</button> <button id="abPatrol">Hero patrol: ' + (hud.heroPatrol ? 'ON' : 'OFF') + '</button></p>'
      + '<p class="small"><span style="display:inline-block;width:100%;height:8px;background:#26314a;border-radius:4px;overflow:hidden"><span style="display:block;height:100%;width:' + cdPct + '%;background:#ffd166"></span></span>' + (cdLeft > 0 ? 'Ability recharging: ' + cdLeft + 's' : 'Ability ready') + '</p>';
    var playHtml = '<h4>Targeting &amp; Play</h4>'
      + '<label class="small" style="margin:0">Target <select id="abTarget" style="width:auto"><option value="first">First</option><option value="last">Last</option><option value="strong">Strong</option><option value="weak">Weak</option><option value="closest">Closest</option><option value="elite">Elite-only</option></select></label>'
      + '<p><button id="abWave" class="primary">▶ Start wave</button> <button id="abEndless">Endless: ' + (hud.endless ? 'ON' : 'OFF') + '</button> <button id="abChallenge">Challenge: ' + (hud.challenge ? 'ON' : 'OFF') + '</button></p>'
      + '<p><button id="abHelp" class="ghost">⌨ Shortcuts</button> <button id="abShareCard" class="ghost">📤 Share run card</button></p>';
    box.innerHTML = upHtml + heroHtml + playHtml;
    var ts = document.getElementById('abTarget'); if (ts) { ts.value = hud.targeting || 'first'; ts.addEventListener('change', function () { if (handle) handle.setTargeting(ts.value); }); }
    var bind = function (id, fn) { var el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
    bind('abWave', function () { if (handle) handle.startWave(); });
    bind('abUpgrade', function () { if (handle) handle.upgradeSelected(); });
    bind('abSell', function () { if (handle) handle.sellSelected(); });
    bind('abAbility', function () { if (handle) handle.heroAbility(); });
    box.querySelectorAll('[data-branch]').forEach(function (btn) { btn.addEventListener('click', function () { if (handle && handle.upgradeBranch) handle.upgradeBranch(btn.getAttribute('data-branch')); }); });
    bind('abPatrol', function () { if (handle && handle.setHeroPatrol) handle.setHeroPatrol(!hud.heroPatrol); });
    bind('abEndless', function () { if (handle && handle.setEndless) { handle.setEndless(!hud.endless); toast(!hud.endless ? 'Endless mode ON: waves continue past 50.' : 'Endless mode OFF.'); } });
    bind('abChallenge', function () { if (handle && handle.setChallenge) { handle.setChallenge(!hud.challenge); toast(!hud.challenge ? 'Challenge mode: 100 gold, 20 lives. Applies on restart.' : 'Challenge mode OFF.'); } });
    bind('abHelp', function () { toggleShortcuts(); });
    bind('abShareCard', function () { shareRunCard(); });
  }

  function renderInspectorMarket() {
    var el = document.getElementById('inspectorMarket'); if (!el) return;
    var q = '';
    var qi = document.getElementById('mkSearch'); if (qi) q = (qi.value || '').toLowerCase();
    var listings = (ctx.state && ctx.state.listings) || [];
    var heroes = (ctx.state && ctx.state.heroes) || [];
    var rows = listings.filter(function (l) { return !q || (l.heroName || '').toLowerCase().indexOf(q) >= 0; });
    if (!rows.length) {
      el.innerHTML = '<p class="muted small">' + (listings.length ? 'No listings match your search.' : 'No heroes listed yet. List one from the Hero Shop.') + '</p><p><button data-open-shop class="ghost">Open Hero Shop</button></p>';
    } else {
      el.innerHTML = rows.slice(0, 12).map(function (l) {
        var h = null; for (var i = 0; i < heroes.length; i++) if (heroes[i].id === l.heroId) h = heroes[i];
        var img = h ? heroImg(h) : '<span class="heroDot">★</span>';
        return '<button class="marketRow" data-shop>' + img + '<span style="flex:1;text-align:left"><strong>' + esc(l.heroName) + '</strong><br><span class="mLvl">Level ' + l.level + ' · ' + esc(l.rarity || '') + ' · BTD Hero</span></span><span class="mPrice">' + l.priceAtom + ' ATOM</span><span>›</span></button>';
      }).join('');
    }
    el.querySelectorAll('[data-open-shop],[data-shop]').forEach(function (b) { b.addEventListener('click', function () { exitGameMode(); showView('marketplace'); }); });
  }

  function renderMarketPreview() {
    var el = document.getElementById('marketPreview'); if (!el) return;
    var listings = (ctx.state && ctx.state.listings) || [];
    var heroes = (ctx.state && ctx.state.heroes) || [];
    if (!listings.length) { el.innerHTML = '<p class="muted small">No heroes listed yet. The feed fills when a hero is listed in the Hero Shop.</p>'; return; }
    el.innerHTML = listings.slice(0, 8).map(function (l) {
      var h = null; for (var i = 0; i < heroes.length; i++) if (heroes[i].id === l.heroId) h = heroes[i];
      var img = h ? heroImg(h) : '<span class="heroDot">★</span>';
      return '<button class="marketRow" data-preview-shop>' + img + '<span style="flex:1;text-align:left"><strong>' + esc(l.heroName) + '</strong><br><span class="mLvl">Level ' + l.level + ' · BTD Hero</span></span><span class="mPrice">' + l.priceAtom + ' ATOM</span><span>›</span></button>';
    }).join('');
    el.querySelectorAll('[data-preview-shop]').forEach(function (b) { b.addEventListener('click', function () { showView('marketplace'); }); });
  }

  function drawSpark(id, arr, color) {
    var c = document.getElementById(id); if (!c || arr.length < 2) return;
    var x = c.getContext('2d'); if (!x) return;
    var w = c.width, h = c.height;
    x.clearRect(0, 0, w, h);
    var max = Math.max.apply(null, arr.concat([1]));
    x.strokeStyle = color; x.lineWidth = 1.5; x.beginPath();
    arr.forEach(function (v, i) { var px = (w - 4) * i / (arr.length - 1) + 2; var py = h - 3 - (h - 6) * (v / max); if (i === 0) x.moveTo(px, py); else x.lineTo(px, py); });
    x.stroke();
  }

  function renderPerf() {
    var hud = ctx.hud || {};
    var fps = (hud.fps != null) ? hud.fps : null;
    var parts = (hud.particles != null) ? hud.particles : null;
    var ent = (hud.towers != null || hud.balloonsRemaining != null) ? ((hud.towers || 0) + (hud.balloonsRemaining || 0)) : null;
    var set = function (id, v) { var el = document.getElementById(id); if (el) el.textContent = (v == null ? '—' : String(v)); };
    set('perfFps', fps == null ? null : fps + ' FPS');
    set('perfEntities', ent);
    set('perfParticles', parts);
    var mem = null;
    try { if (window.performance && window.performance.memory) mem = Math.round(window.performance.memory.usedJSHeapSize / 1048576 * 10) / 10 + 'MB'; } catch (e) {}
    set('perfMemory', mem == null ? 'n/a' : mem);
    if (fps != null) { _perfHist.fps.push(fps); if (_perfHist.fps.length > 40) _perfHist.fps.shift(); drawSpark('sparkFps', _perfHist.fps, '#ff6ec7'); }
    if (parts != null) { _perfHist.particles.push(parts); if (_perfHist.particles.length > 40) _perfHist.particles.shift(); drawSpark('sparkParticles', _perfHist.particles, '#00f6ff'); }
  }

  function setInspectorOpen(open) {
    _inspOpen = !!open;
    var so = document.getElementById('slideOver'); if (so) so.classList.toggle('open', _inspOpen);
    var ob = document.getElementById('btnOpenInspector'); if (ob) ob.hidden = _inspOpen;
  }
  ctx.setInspectorOpen = setInspectorOpen;

  /* Routing: Home Hub (/) vs dedicated game screen (/game/cosmos-btd).
   * The game module stays loaded in both; only the visible shell swaps. */
  var gameMode = false;
  function setGameMode(on, silent) {
    gameMode = !!on;
    document.body.classList.toggle('game-mode', gameMode);
    document.title = gameMode ? 'Cosmos BTD — GAME' : 'GAME — game.atomstaking.app';
    if (!silent) { try { window.history.pushState({}, '', gameMode ? '/game/cosmos-btd' : '/'); } catch (e) {} }
    if (gameMode) renderActionBar();
  }
  function enterGameMode(fullscreen) {
    setGameMode(true);
    if (fullscreen) {
      try { var gv = document.getElementById('gameView'); if (gv && gv.requestFullscreen && !document.fullscreenElement) { var pr = gv.requestFullscreen(); if (pr && pr.catch) pr.catch(function () {}); } } catch (e) {}
    }
  }
  function exitGameMode() { setGameMode(false); }
  function syncModeFromUrl() {
    var p = ''; try { p = window.location.pathname || ''; } catch (e) {}
    var g = null; try { g = new URLSearchParams(window.location.search).get('game'); } catch (e) {}
    setGameMode(p === '/game/cosmos-btd' || g === 'cosmos-btd', true);
  }
  ctx.enterGameMode = enterGameMode; ctx.exitGameMode = exitGameMode;
  window.addEventListener('popstate', syncModeFromUrl);

  function filterStore(q) {
    q = (q || '').toLowerCase();
    document.querySelectorAll('#storeGrid .storeCard').forEach(function (c) {
      var t = (c.getAttribute('data-search') || '') + ' ' + (c.textContent || '').toLowerCase();
      c.style.display = (!q || t.indexOf(q) >= 0) ? '' : 'none';
    });
  }
  /* Batch 7 (Pillar 5): Dev Tools view — map editor, mod loader,
   * debug console. All three work on the live BTD handle only; with
   * no game loaded they explain that instead of failing. Maps and
   * mods are plain JSON, stored in localStorage only (never sent). */
  function btdHandle() { return (ctx.host && ctx.host.current && ctx.host.current.handle) || null; }
  function renderDevTools() {
    var box = document.getElementById('devToolsBox'); if (!box) return;
    var handle = btdHandle();
    var savedMap = null, savedMod = null;
    try { savedMap = localStorage.getItem('game-custom-map'); savedMod = localStorage.getItem('game-custom-mod'); } catch (e) {}
    box.innerHTML = '<h4>🗺 Map editor — Cosmos BTD custom track</h4>'
      + '<p class="small muted">Edit the control points (Catmull-Rom spline, 960×600 board) and terrain, then Apply. Export copies the current track as JSON. Applying a track rebuilds the path, hazards and branch lane; it does not touch money, heroes or the server.</p>'
      + '<p class="small">' + (handle ? 'BTD loaded' + (handle.getState && handle.getState().customMap ? ' · custom map: ' + esc(handle.getState().customMap) : ' · default track') : 'Load Cosmos BTD first (Games tab) to edit the live track.') + '</p>'
      + '<textarea id="devMapJson" rows="6" style="width:100%" placeholder=\'{"name":"My map","controlPoints":[[0,100],[200,100],[300,300],[600,300],[900,500]],"terrain":[{"x":120,"y":420,"kind":"tree"}]}\'></textarea>'
      + '<p><button id="devMapExport">Export current track</button> <button id="devMapApply" class="primary">Apply map</button> <button id="devMapReset" class="ghost">Reset default track</button> <button id="devMapSave" class="ghost">Save map</button> <button id="devMapLoad" class="ghost">Load saved map</button></p>'
      + '<p class="small" id="devMapOut">' + (savedMap ? 'A saved map is in this browser.' : 'No saved map in this browser.') + '</p>'
      + '<h4>🧩 Mod loader — towers, enemies, waves (JSON)</h4>'
      + '<p class="small muted">Mods add towers/enemies/waves to the running BTD game only. They never move ATOM or touch the server. Invalid mods are rejected with the exact errors.</p>'
      + '<textarea id="devModJson" rows="6" style="width:100%" placeholder="Paste a mod JSON here…"></textarea>'
      + '<p><button id="devModExample">Show example mod</button> <button id="devModApply" class="primary">Validate + apply mod</button> <button id="devModSave" class="ghost">Save mod</button> <button id="devModLoad" class="ghost">Load saved mod</button></p>'
      + '<p class="small" id="devModOut">' + (savedMod ? 'A saved mod is in this browser.' : 'No saved mod in this browser.') + '</p>'
      + '<h4>🐞 Debug console + performance monitor</h4>'
      + '<p class="small">Press <b>~</b> anywhere (outside text fields) to toggle the overlay: FPS graph, frame time, entity/particle/grid counts, JS heap when the browser exposes it. Or open it here:</p>'
      + '<p><button id="devConsoleOpen">Open debug console (~)</button></p>'
      + '<p class="small" id="devPerfOut">Perf stats appear in the overlay; the shell HUD already shows FPS, particles and grid stats.</p>';
    var out = function (id, msg, kind) { var el = document.getElementById(id); if (el) { el.textContent = msg; } toast(msg, kind); };
    document.getElementById('devMapExport').addEventListener('click', function () {
      var h = btdHandle(); if (!h || !h.getMap) { out('devMapOut', 'Load Cosmos BTD first.', 'warn'); return; }
      document.getElementById('devMapJson').value = JSON.stringify(h.getMap(), null, 2);
      out('devMapOut', 'Current track exported to the editor.', 'ok');
    });
    document.getElementById('devMapApply').addEventListener('click', function () {
      var h = btdHandle(); if (!h || !h.applyMap) { out('devMapOut', 'Load Cosmos BTD first.', 'warn'); return; }
      var parsed; try { parsed = JSON.parse(document.getElementById('devMapJson').value); } catch (e) { out('devMapOut', 'Invalid JSON: ' + e.message, 'err'); return; }
      var r = h.applyMap(parsed);
      if (r && r.ok) { out('devMapOut', 'Map applied: ' + (r.map.name || 'custom') + ' · track ' + r.map.trackLength + 'px · spawn ' + r.map.spawn.join(',') + '.', 'ok'); renderDevTools(); }
      else out('devMapOut', 'Map rejected: ' + ((r && r.errors) || ['unknown error']).join('; '), 'err');
    });
    document.getElementById('devMapReset').addEventListener('click', function () {
      var h = btdHandle(); if (!h || !h.resetMap) { out('devMapOut', 'Load Cosmos BTD first.', 'warn'); return; }
      h.resetMap(); out('devMapOut', 'Default track restored.', 'ok'); renderDevTools();
    });
    document.getElementById('devMapSave').addEventListener('click', function () { try { localStorage.setItem('game-custom-map', document.getElementById('devMapJson').value); out('devMapOut', 'Map saved in this browser.', 'ok'); } catch (e) { out('devMapOut', 'Could not save: ' + e.message, 'err'); } });
    document.getElementById('devMapLoad').addEventListener('click', function () { try { var v = localStorage.getItem('game-custom-map'); if (v) { document.getElementById('devMapJson').value = v; out('devMapOut', 'Saved map loaded into the editor.', 'ok'); } else out('devMapOut', 'No saved map in this browser.', 'warn'); } catch (e) { out('devMapOut', 'Could not load: ' + e.message, 'err'); } });
    document.getElementById('devModExample').addEventListener('click', function () {
      if (window.ModLoader) document.getElementById('devModJson').value = JSON.stringify(window.ModLoader.example(), null, 2);
    });
    document.getElementById('devModApply').addEventListener('click', function () {
      if (!window.ModLoader) { out('devModOut', 'Mod loader unavailable.', 'err'); return; }
      var parsed = window.ModLoader.parse(document.getElementById('devModJson').value);
      if (!parsed.ok) { out('devModOut', 'Mod rejected: ' + parsed.errors.join('; '), 'err'); return; }
      var h = btdHandle(); if (!h) { out('devModOut', 'Mod is valid, but load Cosmos BTD first to apply it.', 'warn'); return; }
      var r = window.ModLoader.applyToGame(h, parsed.mod);
      if (!r.ok) { out('devModOut', 'Mod rejected: ' + r.errors.join('; '), 'err'); return; }
      var a = r.applied;
      out('devModOut', 'Mod applied: ' + a.towers.length + ' tower(s), ' + a.enemies.length + ' enem(ies), ' + a.waves.length + ' wave(s)' + (a.skipped.length ? ' · skipped ' + a.skipped.length + ': ' + a.skipped.map(function (s) { return s.id + ' (' + s.errors.join('; ') + ')'; }).join('; ') : '') + '.', 'ok');
      renderActionBar();
    });
    document.getElementById('devModSave').addEventListener('click', function () { try { localStorage.setItem('game-custom-mod', document.getElementById('devModJson').value); out('devModOut', 'Mod saved in this browser.', 'ok'); } catch (e) { out('devModOut', 'Could not save: ' + e.message, 'err'); } });
    document.getElementById('devModLoad').addEventListener('click', function () { try { var v = localStorage.getItem('game-custom-mod'); if (v) { document.getElementById('devModJson').value = v; out('devModOut', 'Saved mod loaded into the editor.', 'ok'); } else out('devModOut', 'No saved mod in this browser.', 'warn'); } catch (e) { out('devModOut', 'Could not load: ' + e.message, 'err'); } });
    document.getElementById('devConsoleOpen').addEventListener('click', function () {
      if (window.GameDevTools) { if (!window.GameDevTools.isOpen()) window.GameDevTools.toggle(); out('devPerfOut', 'Debug console open (bottom-left). Press ~ to close.', 'ok'); }
      else out('devPerfOut', 'Debug console unavailable.', 'err');
    });
  }
  function showView(name) {
    if (name === 'games') name = 'store';
    document.querySelectorAll('.topnav [data-nav]').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-nav') === name); });
    var grid = document.querySelector('.hubGrid');
    var isHub = (name === 'store' || name === 'library');
    if (grid) grid.style.display = isHub ? '' : 'none';
    document.querySelectorAll('#hubWrap .view').forEach(function (v) { v.classList.remove('active'); });
    var sec = document.getElementById('view-' + name);
    if (sec) sec.classList.add('active');
    var sg = document.getElementById('storeGrid');
    if (sg) sg.classList.toggle('owned-only', name === 'library');
    var ln = document.getElementById('libNote');
    if (ln) ln.hidden = (name !== 'library');
    if (name === 'marketplace' && window.MarketplaceUI) window.MarketplaceUI.render(document.getElementById('marketplace'), ctx);
    if (name === 'updates') renderFeatures();
    if (name === 'devtools') renderDevTools();
    if (name === 'ceo' && window.CeoUI) window.CeoUI.mountGate(document.getElementById('ceoGate'), document.getElementById('ceoPanel'), ctx);
    if (isHub) { renderGameList(); renderMarketPreview(); }
  }
  document.querySelectorAll('.topnav [data-nav]').forEach(function (b) { b.addEventListener('click', function () { showView(b.getAttribute('data-nav')); }); });
  async function init() {
    try { var refParam = new URLSearchParams(window.location.search).get('ref'); if (refParam) localStorage.setItem('game-referral', refParam); } catch (e) {}
    var startGame = 'cosmos-btd';
    try { var gp = new URLSearchParams(window.location.search).get('game'); if (gp) startGame = gp; } catch (e) {}
    updateHubLoader(10, 'Fetching hub config…');
    ctx.config = await api('/api/config');
    updateHubLoader(35, 'Config loaded — starting wallet + engine…');
    renderHubFooter();
    var _lv = document.getElementById('launcherVersion'); if (_lv && ctx.config && ctx.config.version) _lv.textContent = 'v' + ctx.config.version;
    ctx.wallet = new window.WalletManager(bus, ctx.config);
    ctx.host = new window.EngineHost(bus, ctx.wallet, ctx.config);
    ctx.watcher = new window.RpcWatcher(bus, ctx.config);
    ctx.host.setViewport(document.getElementById('game-viewport'));
    /* Batch 15: lazy-load — each game's script is injected on first
     * selection and cached by GameScriptLoader, so the hub no longer
     * downloads all five game bundles up front. Shooter/Miner are
     * registered only when /api/config lists them playable (the
     * server checks the files exist), matching the old behaviour
     * where a missing file meant no global and no registration. */
    var cfgStatus = function (id) { var gs = (ctx.config && ctx.config.games) || []; for (var i = 0; i < gs.length; i++) if (gs[i].id === id) return gs[i].status; return 'playable'; };
    var lazyGame = function (src, globalName) { return async function () { var mod = await window.GameScriptLoader.load(src, globalName); if (!mod) throw new Error('Game module did not load: ' + src); return mod; }; };
    ctx.host.registerGame({ id: 'cosmos-btd', name: 'Cosmos BTD', tagline: '50 waves · 8 towers · heroes', image: 'assets/sprites/battlefield.jpg', description: 'Space tower defense: protect the ATOM orb across 50 waves — 8 towers, heroes, targeting, 1x-3x speed.', status: 'playable', tags: ['Tower Defense', 'Space', 'Heroes', '50 Waves'], load: lazyGame('games/cosmos-btd/btd.js', 'CosmosBTD') });
    updateHubLoader(60, 'Games registered…');
    renderGameList(); renderWallet(); renderSettingsPanel(); renderMarketPreview();
    /* Batch 19: first user gesture unlocks the ambient hum (no autoplay). */
    var _gestureOnce = function () { if (_userGestured) return; _userGestured = true; applyAmbientHum(); };
    document.addEventListener('pointerdown', _gestureOnce);
    document.addEventListener('keydown', _gestureOnce);
    document.addEventListener('click', function (ev) { if (ev.target && ev.target.closest && ev.target.closest('button')) uiTick('click'); });
    document.addEventListener('mouseover', function (ev) { if (ev.target && ev.target.closest && ev.target.closest('button')) uiTick('hover'); });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { closeSettings(); closeGamePicker(); closeShortcuts(); setInspectorOpen(false); } else if (ev.key === '?') { var t = ev.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return; toggleShortcuts(); } });
    bus.on('wallet:connected', function () { renderWallet(); });
    bus.on('wallet:disconnected', function () { ctx.player = null; renderWallet(); renderHeroes([]); });
    bus.on('wallet:balance', function () { renderWallet(); });
    bus.on('rpc:watcher_status', function (s) { if (window.CeoUI) window.CeoUI.setWatcherStatus(s); });
    async function connectWallet() {
      try { await ctx.wallet.connect('keplr'); ctx.wallet.startBalancePolling(60000); toast('Wallet connected (Keplr): ' + shortAddr(ctx.wallet.address), 'ok'); await ensurePlayer(); await startSession(); refreshState(); if (ctx.currentGame) loadGame(ctx.currentGame); } catch (e) { toast(e.message, 'err'); }
    }
    document.getElementById('btnConnectKeplr').addEventListener('click', function () { connectWallet(); });
    document.getElementById('btnDisconnect').addEventListener('click', function () { ctx.wallet.disconnect(); toast('Disconnected.'); });
    var exBtn = document.getElementById('btnExploreStore'); if (exBtn) exBtn.addEventListener('click', function () { showView('marketplace'); });
    var bellBtn = document.getElementById('btnBell'); if (bellBtn) bellBtn.addEventListener('click', function () { showView('updates'); });
    var shareBtn = document.getElementById('btnShareCard'); if (shareBtn) shareBtn.addEventListener('click', shareRunCard);
    var closePk = document.getElementById('btnClosePicker'); if (closePk) closePk.addEventListener('click', closeGamePicker);
    var playPk = document.getElementById('btnPlayPicker'); if (playPk) playPk.addEventListener('click', function () { var id = document.getElementById('gamePicker').getAttribute('data-game'); closeGamePicker(); if (id) openGameInTab(id); });
    var pkOverlay = document.getElementById('gamePicker'); if (pkOverlay) pkOverlay.addEventListener('click', function (ev) { if (ev.target === pkOverlay) closeGamePicker(); });
    var gsInput = document.getElementById('gameSearch'); if (gsInput) gsInput.addEventListener('input', function () { filterStore(gsInput.value); });
    var restored = ctx.wallet.restore();
    if (restored) { renderWallet(); await ensurePlayer(); await startSession(); }
    await refreshState();
    updateHubLoader(80, 'Loading Cosmos BTD…');
    if (!ctx.host.listGames().some(function (g) { return g.id === startGame; })) startGame = 'cosmos-btd';
    await loadGame(startGame);
    syncModeFromUrl();
    /* Map skins: Space / Jungle switch in the game top bar. */
    document.querySelectorAll('[data-map-skin]').forEach(function (btn) { btn.addEventListener('click', function () {
      var skin = btn.getAttribute('data-map-skin');
      var h = ctx.host && ctx.host.current && ctx.host.current.handle;
      if (h && h.setMapSkin) h.setMapSkin(skin);
      document.querySelectorAll('[data-map-skin]').forEach(function (x) { x.classList.toggle('on', x === btn); });
    }); });
    try { var mh = ctx.host.current && ctx.host.current.handle; var cur = (mh && mh.getMapSkin && mh.getMapSkin()) || 'space'; document.querySelectorAll('[data-map-skin]').forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-map-skin') === cur); }); } catch (e) {}
    var _exitBtn = document.getElementById('btnExitGame'); if (_exitBtn) _exitBtn.addEventListener('click', function () { exitGameMode(); showView('store'); });
    var _pauseBtn = document.getElementById('btnGamePause'); if (_pauseBtn) _pauseBtn.addEventListener('click', function () { var h = btdHandle(); if (h && h.setPaused) h.setPaused(!(ctx.hud && ctx.hud.paused)); });
    var _autoBtn = document.getElementById('btnGameAuto'); if (_autoBtn) _autoBtn.addEventListener('click', function () { var h = btdHandle(); if (h) h.setAutoStart(!(ctx.hud && ctx.hud.autoStart)); });
    var _spd = document.getElementById('gameSpeed'); if (_spd) _spd.addEventListener('change', function () { var h = btdHandle(); if (h) h.setSpeed(Number(_spd.value)); });
    var _mk = document.getElementById('mkSearch'); if (_mk) _mk.addEventListener('input', renderInspectorMarket);
    var _dp = document.getElementById('deckPrev'); if (_dp) _dp.addEventListener('click', function () { var sc = document.getElementById('buildBar'); if (sc) sc.scrollBy({ left: -220, behavior: 'smooth' }); });
    var _dn = document.getElementById('deckNext'); if (_dn) _dn.addEventListener('click', function () { var sc = document.getElementById('buildBar'); if (sc) sc.scrollBy({ left: 220, behavior: 'smooth' }); });
    var _ci = document.getElementById('btnCloseInspector'); if (_ci) _ci.addEventListener('click', function () { setInspectorOpen(false); });
    var _oi = document.getElementById('btnOpenInspector'); if (_oi) _oi.addEventListener('click', function () { setInspectorOpen(true); });
    var _pt = document.getElementById('btnPerfToggle'); if (_pt) _pt.addEventListener('click', function () { var po = document.getElementById('perfOverlay'); if (po) po.style.display = 'none'; var ps = document.getElementById('btnPerfShow'); if (ps) ps.hidden = false; });
    var _ps = document.getElementById('btnPerfShow'); if (_ps) _ps.addEventListener('click', function () { var po = document.getElementById('perfOverlay'); if (po) po.style.display = ''; _ps.hidden = true; });
    var _ceo = document.getElementById('btnOpenCeo'); if (_ceo) _ceo.addEventListener('click', function () { showView('ceo'); });
    var _lh = document.getElementById('btnListHero'); if (_lh) _lh.addEventListener('click', function () { if (!ctx.player) { toast('Connect your wallet first.', 'warn'); return; } showView('marketplace'); });
    var _ts2 = document.getElementById('btnTopSettings'); if (_ts2) _ts2.addEventListener('click', openSettings);
    var _lm = document.getElementById('btnLibMenu'); if (_lm) _lm.addEventListener('click', function () { var m = document.getElementById('libMenu'); if (m) m.hidden = !m.hidden; });
    document.querySelectorAll('#libMenu [data-libmenu]').forEach(function (b) { b.addEventListener('click', function () { var m = document.getElementById('libMenu'); if (m) m.hidden = true; var k = b.getAttribute('data-libmenu'); if (k === 'updates') showView('updates'); else if (k === 'devtools') showView('devtools'); else if (k === 'settings') openSettings(); else if (k === 'shortcuts') toggleShortcuts(); }); });
    setInterval(renderPerf, 500);
    updateHubLoader(100, 'Ready');
    hideHubLoader();
    setInterval(refreshState, 30000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { var p = init(); if (p && p.catch) p.catch(function () { hideHubLoader(); }); });
  else { var _initP = init(); if (_initP && _initP.catch) _initP.catch(function () { hideHubLoader(); }); }
})();

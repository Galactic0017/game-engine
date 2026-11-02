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
  function loadSettings() { try { return Object.assign({ volume: 1, quality: 'high', postfx: true, dof: true, fpsTarget: 60, particleDensity: 'high', motionBlur: false, displayScale: 'auto', uiScale: 1, glass: true, uiSounds: true, colorblind: false, reducedMotion: prefersReducedMotion() }, JSON.parse(localStorage.getItem('game-settings') || '{}')); } catch (e) { return { volume: 1, quality: 'high', postfx: true, dof: true, fpsTarget: 60, particleDensity: 'high', motionBlur: false, displayScale: 'auto', uiScale: 1, glass: true, uiSounds: true, colorblind: false, reducedMotion: prefersReducedMotion() }; } }
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
  function applySettings(handle) { if (!handle) { applyUiPrefs(); return; } if (handle.setVolume) handle.setVolume(ctx.settings.volume); if (handle.setQuality) handle.setQuality(ctx.settings.quality); if (handle.setPostFx) handle.setPostFx(ctx.settings.postfx !== false); if (handle.setDof) handle.setDof(ctx.settings.dof !== false); if (handle.setFpsTarget) handle.setFpsTarget(ctx.settings.fpsTarget); if (handle.setParticleDensity) handle.setParticleDensity(ctx.settings.particleDensity); if (handle.setMotionBlur) handle.setMotionBlur(ctx.settings.motionBlur); if (handle.setDisplayScale) handle.setDisplayScale(ctx.settings.displayScale); if (handle.setColorblind) handle.setColorblind(ctx.settings.colorblind === true); if (handle.setReducedMotion) handle.setReducedMotion(ctx.settings.reducedMotion === true); applyUiPrefs(); }
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
      renderLeaderMini(); renderAnnouncements(); renderProfile(); renderChallenges(); renderReferral();
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
    el.innerHTML = '<p class="small"><button data-lb="" class="ghost">All</button> <button data-lb="cosmos-btd" class="ghost">BTD</button> <button data-lb="space-shooter" class="ghost">Shooter</button> <button data-lb="asteroid-miner" class="ghost">Miner</button></p>'
      + '<p class="small"><button data-season="" class="ghost">All-time</button> <button data-season="' + seasonKeyNow + '" class="ghost">This month (' + seasonKeyNow + ')</button>'
      + (seasonInfo && seasonInfo.previousKey ? '<br><span class="muted">Last month (' + esc(seasonInfo.previousKey) + ') top 3: ' + esc((seasonInfo.top3 || []).map(function (t) { return '#' + t.rank + ' ' + (t.name || shortAddr(t.address)); }).join(', ') || 'none') + '</span>' : '') + '</p>'
      + (rows.length ? rows.slice(0, 5).map(function (r, i) { return '<p class="small">' + (leaderSeason && i < 3 ? '🏆 ' : '') + (i + 1) + '. ' + esc(r.name || shortAddr(r.address)) + ' — ' + r.bestScore + ' pts · Lv ' + r.level + '</p>'; }).join('') : '<p class="muted small">No scores yet' + (leaderSeason ? ' this month' : '') + '.</p>');
    el.querySelectorAll('[data-lb]').forEach(function (btn) { btn.addEventListener('click', function () { leaderGame = btn.getAttribute('data-lb'); renderLeaderMini(); }); });
    el.querySelectorAll('[data-season]').forEach(function (btn) { btn.addEventListener('click', function () { leaderSeason = btn.getAttribute('data-season'); renderLeaderMini(); }); });
  }
  /* Batch 11: friend challenges (duel invites with accept/decline +
   * async results), referral code display, and the PNG share card.
   * All three are shell-only views over the server endpoints; the
   * canvas snapshot is best-effort (a tainted canvas throws and
   * only shows a toast — the game keeps running). */
  async function renderChallenges() {
    var box = document.getElementById('challengeBox'); if (!box) return;
    if (!ctx.player) { box.innerHTML = '<p class="muted small">Connect your wallet to send or answer duel invites.</p>'; return; }
    var duels = [];
    try { var r = await api('/api/duels?address=' + encodeURIComponent(ctx.player.address)); duels = r.duels || []; } catch (e) {}
    var me = ctx.player.address;
    var rows = duels.slice(0, 5).map(function (d) {
      var other = d.challenger === me ? d.rival : d.challenger;
      var otherName = d.challenger === me ? (d.rivalName || shortAddr(d.rival)) : (d.challengerName || shortAddr(d.challenger));
      var statusText = d.status === 'pending' ? (d.rivalResponse === 'accepted' ? 'Accepted — awaiting result' : 'Invite pending') : d.status.replace(/_/g, ' ');
      var actions = '';
      if (d.status === 'pending' && d.rival === me && !d.rivalResponse) actions = '<button data-accept="' + d.id + '">Accept</button> <button data-decline="' + d.id + '" class="ghost">Decline</button>';
      else if (d.status === 'pending' && d.challenger === me) actions = '<input data-score="' + d.id + '" type="number" min="0" max="100000" placeholder="Your score" style="width:110px"> <button data-result="' + d.id + '">Submit result</button>';
      return '<div class="questCard"><strong>' + esc(otherName) + '</strong> <span class="small muted">' + esc(shortAddr(other)) + ' · ' + esc(statusText) + (d.score != null ? ' · score ' + d.score : '') + '</span><p style="margin:6px 0 0">' + actions + '</p></div>';
    }).join('');
    box.innerHTML = '<label>Challenge a friend by address</label><input id="challengeAddr" type="text" placeholder="cosmos1… rival address"><p><button id="btnChallenge" class="primary">Send duel invite</button></p>' + (rows || '<p class="muted small">No duels yet.</p>');
    var sendBtn = document.getElementById('btnChallenge');
    if (sendBtn) sendBtn.addEventListener('click', async function () {
      var rival = (document.getElementById('challengeAddr').value || '').trim();
      if (!rival || rival.indexOf('cosmos1') !== 0) return toast('Enter a valid rival Cosmos address (cosmos1…).', 'warn');
      try { await api('/api/duels', 'POST', { challengerAddress: me, rivalAddress: rival }); toast('Duel invite sent to ' + shortAddr(rival) + '.', 'ok'); renderChallenges(); } catch (e) { toast(e.message, 'err'); }
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
      + '<label class="checkRow"><input id="setUiSounds" type="checkbox" ' + (ctx.settings.uiSounds !== false ? 'checked' : '') + '> UI hover / click sounds</label>';
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
    [['#setPostFx', 'postfx'], ['#setDof', 'dof'], ['#setMotionBlur', 'motionBlur'], ['#setGlass', 'glass'], ['#setUiSounds', 'uiSounds'], ['#setColorblind', 'colorblind'], ['#setReducedMotion', 'reducedMotion']].forEach(function (pair) {
      var el = q(pair[0]); if (!el) return;
      el.addEventListener('change', function (ev) { ctx.settings[pair[1]] = ev.target.checked; saveSettings(); applySettings(handle()); });
    });
  }
  function openSettings() { renderSettingsPanel(); var m = document.getElementById('settingsModal'); if (m) m.hidden = false; }
  function closeSettings() { var m = document.getElementById('settingsModal'); if (m) m.hidden = true; }
  function renderSettingsPanel() {
    var modal = document.getElementById('settingsModalBody');
    if (modal) { modal.innerHTML = settingsFormHtml(); wireSettingsControls(modal); }
    var el = document.getElementById('settingsBox');
    if (el) el.innerHTML = '<button id="btnOpenSettings" class="primary">⚙ Open settings</button><p class="small muted">FPS target, motion blur, particle density, display scaling, glass theme, UI scale, UI sounds, colorblind palette &amp; reduced motion.</p>';
    var openBtn = document.getElementById('btnOpenSettings'); if (openBtn) openBtn.onclick = openSettings;
    var topBtn = document.getElementById('btnSettings'); if (topBtn) topBtn.onclick = openSettings;
    var closeBtn = document.getElementById('btnCloseSettings'); if (closeBtn) closeBtn.onclick = closeSettings;
    var overlay = document.getElementById('settingsModal'); if (overlay) overlay.onclick = function (ev) { if (ev.target === overlay) closeSettings(); };
    applyUiPrefs();
  }
  /* Inspection stat card: hover/select a BTD tower to see animated stat
   * bars, the upgrade tree step, sell refund, and a tactical
   * effectiveness chart. Re-rendered only when the payload changes so
   * the CSS bar transitions actually animate. */
  var _inspectKey = '';
  function renderInspectCard() {
    var card = document.getElementById('inspectCard'); if (!card) return;
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
    actions.innerHTML = '<label>Claim hero (if unlocked)</label><select id="claimHeroSel">' + defs.map(function (d) { return '<option value="' + d.id + '">' + esc(d.name) + ' — Lv ' + d.unlockLevel + '+</option>'; }).join('') + '</select>'
      + '<div style="display:flex;gap:6px;margin-top:6px"><button id="btnGetHero">Get hero</button><button id="btnUpgradeHero" class="ghost">Upgrade equipped (200×Lv)</button></div>';
    document.getElementById('btnGetHero').addEventListener('click', async function () {
      if (!ctx.player) return toast('Connect your wallet first.', 'warn');
      try { var r = await api('/api/heroes/claim', 'POST', { address: ctx.player.address, defId: document.getElementById('claimHeroSel').value }); toast('Hero added: ' + r.hero.name, 'ok'); refreshState(); } catch (e) { toast(e.message, 'err'); }
    });
    document.getElementById('btnUpgradeHero').addEventListener('click', async function () {
      var h = ctx.host.equippedHero; if (!h) return toast('Equip a hero first.', 'warn');
      try { var r = await api('/api/heroes/upgrade', 'POST', { address: ctx.player.address, heroId: h.id }); toast('Upgraded to Lv ' + r.hero.level, 'ok'); refreshState(); } catch (e) { toast(e.message, 'err'); }
    });
  }
  var GAME_IMAGES = { 'cosmos-btd': 'assets/sprites/battlefield.jpg', 'space-tycoon': 'assets/sprites/tower-validator.png', 'atom-clicker': 'assets/sprites/hero-astra.png', 'space-shooter': 'assets/sprites/monster-1.png', 'asteroid-miner': 'assets/sprites/monster-1.png' };
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
    renderTagFilter();
    var el = document.getElementById('gameList');
    var games = ctx.host.listGames();
    if (el) {
      el.innerHTML = games.map(function (g) {
        var m = gameMeta(g);
        return '<button class="gameItem ' + (ctx.currentGame === g.id ? 'active' : '') + '" data-game="' + g.id + '"><strong>' + esc(g.name) + '</strong><small>' + esc(g.tagline || '') + '</small></button>';
      }).join('');
      el.querySelectorAll('[data-game]').forEach(function (btn) {
        btn.addEventListener('click', function () { openGameInfo(btn.getAttribute('data-game')); });
      });
    }
    var cards = document.getElementById('gameCards');
    if (cards) {
      cards.innerHTML = games.map(function (g) {
        var m = gameMeta(g);
        return '<div class="gameCard" data-search="' + esc((m.name + ' ' + m.description + ' ' + m.tagline + ' ' + m.tags.join(' ')).toLowerCase()) + '" data-tags="' + esc(m.tags.join(',').toLowerCase()) + '">'
          + '<img class="gameThumb" src="' + m.image + '" alt="" onerror="this.style.display=\'none\'">'
          + '<div class="gameMeta"><strong>' + esc(m.name) + '</strong> <span class="pill">' + esc(m.status) + '</span>' + tagChipsHtml(m.tags)
          + '<p class="gameDesc">' + esc(m.description) + '</p></div>'
          + '<div class="gameRow"><button data-info="' + m.id + '">About</button><button data-play="' + m.id + '" class="primary"' + (m.status !== 'playable' ? ' disabled' : '') + '>▶ Play</button></div></div>';
      }).join('');
      cards.querySelectorAll('[data-info]').forEach(function (btn) { btn.addEventListener('click', function () { openGameInfo(btn.getAttribute('data-info')); }); });
      cards.querySelectorAll('[data-play]').forEach(function (btn) { btn.addEventListener('click', function () { loadGame(btn.getAttribute('data-play')); }); });
    }
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
      onTowerSelect: function (t) { ctx.selectedTower = t; renderActionBar(); }
    };
    try {
      await ctx.host.loadGame(gameId, opts);
      var handle = ctx.host.current && ctx.host.current.handle;
      if (handle && handle.setSession && ctx.session) handle.setSession(ctx.session.sessionId, ctx.session.nonce);
      applySettings(handle);
      renderActionBar();
    } catch (e) { ctx.host.unloadGame(); toast('Could not open ' + gameId + ': ' + e.message, 'err'); }
  }
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
  function renderActionBar() {
    renderInspectCard();
    var bar = document.getElementById('actionBar');
    if (ctx.currentGame !== 'cosmos-btd') { bar.innerHTML = '<span class="muted small">This game has its own controls inside the panel above.</span>'; return; }
    var hud = ctx.hud || {};
    var handle = ctx.host.current && ctx.host.current.handle;
    var branchHtml = '';
    if (hud.inspect && hud.inspect.branchOptions) {
      branchHtml = hud.inspect.branchOptions.map(function (o) {
        return '<button data-branch="' + o.branch + '"' + (o.locked || o.cost == null ? ' disabled' : '') + '>' + esc(o.name) + ' ' + (o.cost != null ? o.cost + 'g' : 'MAX') + '</button>';
      }).join('');
    }
    var defs = (window.CosmosBTD && window.CosmosBTD.TOWER_DEFS) || {};
    var sprMap = (window.CosmosBTD && window.CosmosBTD.TOWER_SPRITES) || {};
    var towersHtml = '<div class="towerGrid">' + Object.keys(defs).map(function (k) {
      var d = defs[k];
      var spr = sprMap[k] || 'tower-validator';
      return '<button class="towerBtn" data-tower="' + k + '"><img class="towerThumb" src="assets/sprites/' + spr + '.png" alt="" onerror="this.outerHTML=\'<span class=towerDot style=background:' + d.color + '></span>\'"><span class="towerMeta"><strong>' + d.name + ' (' + d.key + ')</strong><small>' + d.cost + 'g · ' + esc(d.desc) + '</small></span></button>';
    }).join('') + '</div>';
    /* Batch 8: sell preview (refund from the inspect payload) + hero
     * ability cooldown bar (seconds left, fill = charge recovered). */
    var sellLabel = (hud.inspect && hud.inspect.sellRefund != null) ? 'Sell +' + hud.inspect.sellRefund + 'g' : 'Sell 70%';
    var cdLeft = Math.max(0, hud.heroCd || 0);
    var cdMax = hud.heroCdMax || 12;
    var cdPct = cdLeft > 0 ? Math.max(0, Math.round(100 * (1 - cdLeft / cdMax))) : 100;
    var cdText = cdLeft > 0 ? 'Ability recharging: ' + cdLeft + 's' : 'Ability ready';
    var abilityLabel = 'Hero ability' + (cdLeft > 0 ? ' (' + cdLeft + 's)' : '');
    bar.innerHTML = '<div class="hud"><span>Gold <b>' + (hud.gold != null ? hud.gold : '—') + '</b></span><span>Lives <b>' + (hud.lives != null ? hud.lives : '—') + '</b></span><span>Wave <b>' + (hud.wave || 0) + (hud.endless ? '/∞' : '/50') + '</b></span><span>Score <b>' + (hud.score || 0) + '</b></span><span>Pops <b>' + (hud.pops || 0) + '</b></span><span class="muted small">FPS ' + (hud.fps || '—') + '</span><span class="muted small">Next: ' + esc(hud.nextWave || '—') + '</span></div>'
      + towersHtml
      + '<label class="small" style="margin:0">Target<select id="abTarget" style="width:auto"><option value="first">First</option><option value="last">Last</option><option value="strong">Strong</option><option value="weak">Weak</option><option value="closest">Closest</option><option value="elite">Elite-only</option></select></label>'
      + '<label class="small" style="margin:0">Speed<select id="abSpeed" style="width:auto"><option value="1">1x</option><option value="2">2x</option><option value="3">3x</option></select></label>'
      + '<button id="abWave" class="primary">▶ Start wave</button>'
      + '<button id="abAuto">Auto: ' + (hud.autoStart ? 'ON' : 'OFF') + '</button>'
      + '<button id="abPause">' + (hud.paused ? '▶ Resume' : '⏸ Pause') + '</button>'
      + '<button id="abEndless">Endless: ' + (hud.endless ? 'ON' : 'OFF') + '</button>'
      + '<button id="abChallenge">Challenge: ' + (hud.challenge ? 'ON' : 'OFF') + '</button>'
      + '<button id="abUpgrade">Upgrade ★</button><button id="abSell" class="ghost">' + esc(sellLabel) + '</button>' + branchHtml
      + '<button id="abAbility">' + esc(abilityLabel) + '</button><span class="small" style="display:inline-flex;align-items:center;gap:6px"><span style="display:inline-block;width:80px;height:8px;background:#26314a;border-radius:4px;overflow:hidden;vertical-align:middle"><span style="display:block;height:100%;width:' + cdPct + '%;background:#ffd166"></span></span>' + esc(cdText) + '</span>'
      + '<button id="abPatrol">Hero patrol: ' + (hud.heroPatrol ? 'ON' : 'OFF') + '</button>'
      + '<button id="abHelp" class="ghost">⌨ Shortcuts</button>';
    var ts = document.getElementById('abTarget'); if (ts) { ts.value = hud.targeting || 'first'; ts.addEventListener('change', function () { if (handle) handle.setTargeting(ts.value); }); }
    var sp = document.getElementById('abSpeed'); if (sp) { sp.value = String(hud.speed || 1); sp.addEventListener('change', function () { if (handle) handle.setSpeed(Number(sp.value)); }); }
    bar.querySelectorAll('[data-tower]').forEach(function (btn) {
      btn.addEventListener('click', function () { if (handle) handle.setPlacing(btn.getAttribute('data-tower')); bar.querySelectorAll('[data-tower]').forEach(function (b) { b.classList.remove('active'); }); btn.classList.add('active'); });
    });
    document.getElementById('abWave').addEventListener('click', function () { if (handle) handle.startWave(); });
    document.getElementById('abAuto').addEventListener('click', function () { if (handle) handle.setAutoStart(!hud.autoStart); });
    document.getElementById('abUpgrade').addEventListener('click', function () { if (handle) handle.upgradeSelected(); });
    document.getElementById('abSell').addEventListener('click', function () { if (handle) handle.sellSelected(); });
    document.getElementById('abAbility').addEventListener('click', function () { if (handle) handle.heroAbility(); });
    bar.querySelectorAll('[data-branch]').forEach(function (btn) { btn.addEventListener('click', function () { if (handle && handle.upgradeBranch) handle.upgradeBranch(btn.getAttribute('data-branch')); }); });
    var pb = document.getElementById('abPatrol'); if (pb) pb.addEventListener('click', function () { if (handle && handle.setHeroPatrol) handle.setHeroPatrol(!hud.heroPatrol); });
    document.getElementById('abPause').addEventListener('click', function () { if (handle && handle.setPaused) handle.setPaused(!hud.paused); });
    document.getElementById('abEndless').addEventListener('click', function () { if (handle && handle.setEndless) { handle.setEndless(!hud.endless); toast(!hud.endless ? 'Endless mode ON: waves continue past 50.' : 'Endless mode OFF.'); } });
    document.getElementById('abChallenge').addEventListener('click', function () { if (handle && handle.setChallenge) { handle.setChallenge(!hud.challenge); toast(!hud.challenge ? 'Challenge mode: 100 gold, 20 lives. Applies on restart.' : 'Challenge mode OFF.'); } });
    document.getElementById('abHelp').addEventListener('click', function () { var h = document.getElementById('helpCard'); if (h) h.hidden = !h.hidden; });
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
    document.querySelectorAll('nav.tabs button').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-nav') === name); });
    document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
    document.getElementById('view-' + name).classList.add('active');
    if (name === 'marketplace' && window.MarketplaceUI) window.MarketplaceUI.render(document.getElementById('marketplace'), ctx);
    if (name === 'updates') renderFeatures();
    if (name === 'devtools') renderDevTools();
    if (name === 'ceo' && window.CeoUI) window.CeoUI.mountGate(document.getElementById('ceoGate'), document.getElementById('ceoPanel'), ctx);
  }
  document.querySelectorAll('nav.tabs button').forEach(function (b) { b.addEventListener('click', function () { showView(b.getAttribute('data-nav')); }); });
  async function init() {
    try { var refParam = new URLSearchParams(window.location.search).get('ref'); if (refParam) localStorage.setItem('game-referral', refParam); } catch (e) {}
    ctx.config = await api('/api/config');
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
    ctx.host.registerGame({ id: 'space-tycoon', name: 'Space Tycoon', tagline: 'Rigs + offline earnings', image: 'assets/sprites/tower-validator.png', description: 'Build mining rigs, hire overseers, earn while away. Local save.', status: 'playable', tags: ['Idle', 'Tycoon', 'Space'], load: lazyGame('games/space-tycoon/tycoon.js', 'SpaceTycoon') });
    ctx.host.registerGame({ id: 'atom-clicker', name: 'ATOM Core Clicker', tagline: 'Tap the core', image: 'assets/sprites/hero-astra.png', description: 'Tap the ATOM core, catch multiplier surges, bank shards. Local save.', status: 'playable', tags: ['Clicker', 'Idle', 'ATOM'], load: lazyGame('games/atom-clicker/clicker.js', 'AtomClicker') });
    if (cfgStatus('space-shooter') === 'playable') ctx.host.registerGame({ id: 'space-shooter', name: 'Space Shooter', tagline: 'Asteroids + drones', image: 'assets/sprites/monster-1.png', description: 'Arcade space shooter: dodge asteroids, blast drones, survive the waves.', status: 'playable', tags: ['Arcade', 'Shooter', 'Space'], load: lazyGame('games/space-shooter/shooter.js', 'SpaceShooter') });
    if (cfgStatus('asteroid-miner') === 'playable') ctx.host.registerGame({ id: 'asteroid-miner', name: 'Asteroid Miner', tagline: 'Mine ore, upgrade drills', image: 'assets/sprites/monster-1.png', description: 'Click/drag mining: 6 ore tiers, drill upgrades, belt progression. Local save + server bests.', status: 'playable', tags: ['Mining', 'Clicker', 'Space'], load: lazyGame('games/asteroid-miner/miner.js', 'AsteroidMiner') });
    renderGameList(); renderRecent(); renderWallet(); renderSettingsPanel();
    document.addEventListener('click', function (ev) { if (ev.target && ev.target.closest && ev.target.closest('button')) uiTick('click'); });
    document.addEventListener('mouseover', function (ev) { if (ev.target && ev.target.closest && ev.target.closest('button')) uiTick('hover'); });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { closeSettings(); closeGamePicker(); } });
    /* Batch 10: record a finished Space Shooter run on the server
     * shooter leaderboard. Only the game-over emit (final:true) counts;
     * the destroy() emit has no final flag, so leaving a game or
     * switching games never submits. Dedupe by address+score+wave+kills
     * in case the same run emits twice. */
    var _shooterSubmitted = {};
    bus.on('game:ended', function (gameId, payload) {
      if (gameId !== 'space-shooter' || !payload || !payload.final) return;
      if (!ctx.player) return;
      var key = ctx.player.address + ':' + payload.score + ':' + payload.wave + ':' + (payload.kills || 0);
      if (_shooterSubmitted[key]) return;
      _shooterSubmitted[key] = true;
      api('/api/progress', 'POST', { address: ctx.player.address, game: 'space-shooter', score: payload.score, waveReached: payload.wave }).then(function (r) {
        if (r.player) { ctx.player = r.player; toast('Shooter score saved: +' + r.xpGain + ' XP, +' + r.creditGain + ' credits.', 'ok'); refreshState(); }
      }).catch(function () { /* best-effort; the local score stands */ });
    });
    /* Batch 14: record a finished Asteroid Miner shift on the server
     * per-game leaderboard. Only the End Shift emit (final:true)
     * counts; the destroy() emit has no final flag. Dedupe by
     * address+score+belt+mined in case the same shift emits twice. */
    var _minerSubmitted = {};
    bus.on('game:ended', function (gameId, payload) {
      if (gameId !== 'asteroid-miner' || !payload || !payload.final) return;
      if (!ctx.player) return;
      var key = ctx.player.address + ':' + payload.score + ':' + payload.wave + ':' + (payload.kills || 0);
      if (_minerSubmitted[key]) return;
      _minerSubmitted[key] = true;
      api('/api/progress', 'POST', { address: ctx.player.address, game: 'asteroid-miner', score: payload.score, waveReached: payload.wave }).then(function (r) {
        if (r.player) { ctx.player = r.player; toast('Miner shift saved: +' + r.xpGain + ' XP, +' + r.creditGain + ' credits.', 'ok'); refreshState(); }
      }).catch(function () { /* best-effort; the local save stands */ });
    });
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
    var pfBtn = document.getElementById('btnPlayFeatured'); if (pfBtn) pfBtn.addEventListener('click', function () { loadGame('cosmos-btd'); });
    var infBtn = document.getElementById('btnInfoFeatured'); if (infBtn) infBtn.addEventListener('click', function () { openGameInfo('cosmos-btd'); });
    var closePk = document.getElementById('btnClosePicker'); if (closePk) closePk.addEventListener('click', closeGamePicker);
    var playPk = document.getElementById('btnPlayPicker'); if (playPk) playPk.addEventListener('click', function () { var id = document.getElementById('gamePicker').getAttribute('data-game'); closeGamePicker(); if (id) loadGame(id); });
    var pkOverlay = document.getElementById('gamePicker'); if (pkOverlay) pkOverlay.addEventListener('click', function (ev) { if (ev.target === pkOverlay) closeGamePicker(); });
    var gsInput = document.getElementById('gameSearch'); if (gsInput) gsInput.addEventListener('input', function () { filterGameCards(gsInput.value); });
    var restored = ctx.wallet.restore();
    if (restored) { renderWallet(); await ensurePlayer(); await startSession(); }
    await refreshState();
    await loadGame('cosmos-btd');
    setInterval(refreshState, 30000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

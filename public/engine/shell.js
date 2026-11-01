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
  function loadSettings() { try { return Object.assign({ volume: 1, quality: 'high', postfx: true, dof: true, fpsTarget: 60, particleDensity: 'high', motionBlur: false, displayScale: 'auto', uiScale: 1, glass: true, uiSounds: true }, JSON.parse(localStorage.getItem('game-settings') || '{}')); } catch (e) { return { volume: 1, quality: 'high', postfx: true, dof: true, fpsTarget: 60, particleDensity: 'high', motionBlur: false, displayScale: 'auto', uiScale: 1, glass: true, uiSounds: true }; } }
  ctx.settings = loadSettings();
  function saveSettings() { try { localStorage.setItem('game-settings', JSON.stringify(ctx.settings)); } catch (e) {} }
  /* Reactive UI prefs: glass theme on/off + dynamic font scaling, applied
   * live to the whole hub (CSS vars), independent of the loaded game. */
  function applyUiPrefs() {
    if (typeof document === 'undefined') return;
    document.documentElement.style.setProperty('--ui-scale', String(ctx.settings.uiScale || 1));
    document.body.setAttribute('data-glass', ctx.settings.glass === false ? 'off' : 'on');
  }
  ctx.applyUiPrefs = applyUiPrefs;
  function applySettings(handle) { if (!handle) { applyUiPrefs(); return; } if (handle.setVolume) handle.setVolume(ctx.settings.volume); if (handle.setQuality) handle.setQuality(ctx.settings.quality); if (handle.setPostFx) handle.setPostFx(ctx.settings.postfx !== false); if (handle.setDof) handle.setDof(ctx.settings.dof !== false); if (handle.setFpsTarget) handle.setFpsTarget(ctx.settings.fpsTarget); if (handle.setParticleDensity) handle.setParticleDensity(ctx.settings.particleDensity); if (handle.setMotionBlur) handle.setMotionBlur(ctx.settings.motionBlur); if (handle.setDisplayScale) handle.setDisplayScale(ctx.settings.displayScale); applyUiPrefs(); }
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
    document.getElementById('walletStatus').textContent = w.address ? (w.provider === 'demo' ? 'Demo: ' + shortAddr(w.address) : shortAddr(w.address) + ' · ' + w.provider) : 'Not connected';
    document.getElementById('walletBalance').textContent = w.address && w.balanceAtom() !== null ? w.balanceAtom() + ' ATOM' : '';
    document.getElementById('btnDisconnect').hidden = !w.address;
    document.getElementById('btnConnect').textContent = w.address ? 'Reconnect wallet' : 'Connect Keplr / Leap';
  }
  async function ensurePlayer() {
    var w = ctx.wallet; if (!w.address) return;
    try {
      var r = await api('/api/player', 'POST', { address: w.address, name: w.name });
      ctx.player = r.player;
      ctx.host.setPlayer(r.player, r.heroes || []);
      renderHeroes(r.heroes || []);
    } catch (e) { toast(e.message, 'err'); }
  }
  async function refreshState() {
    try {
      ctx.state = await api('/api/state');
      renderLeaderMini(); renderAnnouncements(); renderProfile();
      if (ctx.player) { var mine = ctx.state.heroes.filter(function (h) { return h.owner === ctx.player.address; }); ctx.host.setPlayer(ctx.player, mine); renderHeroes(mine); }
      if (document.getElementById('view-marketplace').classList.contains('active') && window.MarketplaceUI) window.MarketplaceUI.render(document.getElementById('marketplace'), ctx);
    } catch (e) { /* state refresh is best-effort */ }
  }
  ctx.refreshState = refreshState; ctx.ensurePlayer = ensurePlayer;
  var leaderGame = '';
  async function renderLeaderMini() {
    var el = document.getElementById('leaderMini'); if (!el) return;
    var rows;
    if (leaderGame) { try { var r = await api('/api/leaderboard?game=' + leaderGame); rows = r.leaderboard || []; } catch (e) { rows = []; } }
    else rows = (ctx.state && ctx.state.leaderboard) || [];
    el.innerHTML = '<p class="small"><button data-lb="" class="ghost">All</button> <button data-lb="cosmos-btd" class="ghost">BTD</button></p>'
      + (rows.length ? rows.slice(0, 5).map(function (r, i) { return '<p class="small">' + (i + 1) + '. ' + esc(r.name || shortAddr(r.address)) + ' — ' + r.bestScore + ' pts · Lv ' + r.level + '</p>'; }).join('') : '<p class="muted small">No scores yet.</p>');
    el.querySelectorAll('[data-lb]').forEach(function (btn) { btn.addEventListener('click', function () { leaderGame = btn.getAttribute('data-lb'); renderLeaderMini(); }); });
  }
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
    [['#setPostFx', 'postfx'], ['#setDof', 'dof'], ['#setMotionBlur', 'motionBlur'], ['#setGlass', 'glass'], ['#setUiSounds', 'uiSounds']].forEach(function (pair) {
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
    if (el) el.innerHTML = '<button id="btnOpenSettings" class="primary">⚙ Open settings</button><p class="small muted">FPS target, motion blur, particle density, display scaling, glass theme, UI scale &amp; UI sounds.</p>';
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
      return '<div class="heroCard">' + heroImg(h) + '<div style="flex:1"><strong>' + esc(h.name) + '</strong><br><span class="small muted">Lv ' + h.level + ' · ' + esc(h.rarity) + ' · Power ' + h.basePower + '</span></div>'
        + '<button data-equip="' + h.id + '">' + (equipped && equipped.id === h.id ? 'Equipped ✓' : 'Equip') + '</button></div>';
    }).join('') : '<p class="muted small">No heroes yet. Get a demo hero below (unlocks by level).</p>';
    el.querySelectorAll('[data-equip]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var h = heroes.find(function (x) { return x.id === btn.getAttribute('data-equip'); });
        ctx.host.equipHero(h); toast(h.name + ' equipped.', 'ok'); renderHeroes(heroes);
      });
    });
    var actions = document.getElementById('heroActions');
    var defs = (ctx.config && ctx.config.heroDefs) || [];
    actions.innerHTML = '<label>Get demo hero (if unlocked)</label><select id="demoHeroSel">' + defs.map(function (d) { return '<option value="' + d.id + '">' + esc(d.name) + ' — Lv ' + d.unlockLevel + '+</option>'; }).join('') + '</select>'
      + '<div style="display:flex;gap:6px;margin-top:6px"><button id="btnGetHero">Get hero</button><button id="btnUpgradeHero" class="ghost">Upgrade equipped (200×Lv)</button></div>';
    document.getElementById('btnGetHero').addEventListener('click', async function () {
      if (!ctx.player) return toast('Connect your wallet first.', 'warn');
      try { var r = await api('/api/heroes/demo', 'POST', { address: ctx.player.address, defId: document.getElementById('demoHeroSel').value }); toast('Hero added: ' + r.hero.name, 'ok'); refreshState(); } catch (e) { toast(e.message, 'err'); }
    });
    document.getElementById('btnUpgradeHero').addEventListener('click', async function () {
      var h = ctx.host.equippedHero; if (!h) return toast('Equip a hero first.', 'warn');
      try { var r = await api('/api/heroes/upgrade', 'POST', { address: ctx.player.address, heroId: h.id }); toast('Upgraded to Lv ' + r.hero.level, 'ok'); refreshState(); } catch (e) { toast(e.message, 'err'); }
    });
  }
  function renderGameList() {
    var el = document.getElementById('gameList');
    var games = ctx.host.listGames();
    el.innerHTML = games.map(function (g) {
      return '<button class="gameItem ' + (ctx.currentGame === g.id ? 'active' : '') + '" data-game="' + g.id + '"><strong>' + esc(g.name) + '</strong><small>' + esc(g.tagline || '') + '</small></button>';
    }).join('');
    el.querySelectorAll('[data-game]').forEach(function (btn) {
      btn.addEventListener('click', function () { loadGame(btn.getAttribute('data-game')); });
    });
  }
  async function startSession() {
    if (!ctx.player) return;
    try { ctx.session = await api('/api/session/start', 'POST', { address: ctx.player.address }); } catch (e) { ctx.session = null; }
  }
  async function loadGame(gameId) {
    ctx.currentGame = gameId;
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
    } catch (e) { toast(e.message, 'err'); }
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
    var towersHtml = Object.keys(defs).map(function (k) {
      var d = defs[k];
      return '<button class="towerBtn" data-tower="' + k + '"><strong>' + d.name + ' (' + d.key + ')</strong><small>' + d.cost + 'g · ' + esc(d.desc) + '</small></button>';
    }).join('');
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
    ctx.config = await api('/api/config');
    ctx.wallet = new window.WalletManager(bus, ctx.config);
    ctx.host = new window.EngineHost(bus, ctx.wallet, ctx.config);
    ctx.watcher = new window.RpcWatcher(bus, ctx.config);
    ctx.host.setViewport(document.getElementById('game-viewport'));
    ctx.host.registerGame({ id: 'cosmos-btd', name: 'Cosmos BTD', tagline: '50 waves · 8 towers · heroes', status: 'playable', load: async function () { return window.CosmosBTD; } });
    ctx.host.registerGame({ id: 'space-tycoon', name: 'Space Tycoon', tagline: 'Rigs + offline earnings', status: 'playable', load: async function () { return window.SpaceTycoon; } });
    ctx.host.registerGame({ id: 'atom-clicker', name: 'ATOM Core Clicker', tagline: 'Tap the core', status: 'playable', load: async function () { return window.AtomClicker; } });
    if (window.SpaceShooter) ctx.host.registerGame({ id: 'space-shooter', name: 'Space Shooter', tagline: 'Asteroids + drones', status: 'playable', load: async function () { return window.SpaceShooter; } });
    renderGameList(); renderWallet(); renderSettingsPanel();
    document.addEventListener('click', function (ev) { if (ev.target && ev.target.closest && ev.target.closest('button')) uiTick('click'); });
    document.addEventListener('mouseover', function (ev) { if (ev.target && ev.target.closest && ev.target.closest('button')) uiTick('hover'); });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') closeSettings(); });
    bus.on('wallet:connected', function () { renderWallet(); });
    bus.on('wallet:disconnected', function () { ctx.player = null; renderWallet(); renderHeroes([]); });
    bus.on('wallet:balance', function () { renderWallet(); });
    bus.on('rpc:watcher_status', function (s) { if (window.CeoUI) window.CeoUI.setWatcherStatus(s); });
    document.getElementById('btnConnect').addEventListener('click', async function () {
      try { await ctx.wallet.connect(); ctx.wallet.startBalancePolling(60000); toast('Wallet connected: ' + shortAddr(ctx.wallet.address), 'ok'); await ensurePlayer(); await startSession(); refreshState(); if (ctx.currentGame) loadGame(ctx.currentGame); } catch (e) { toast(e.message, 'err'); }
    });
    document.getElementById('btnDemo').addEventListener('click', async function () {
      var addr = prompt('Demo address (cosmos1…):', ctx.wallet.address || '');
      if (!addr) return;
      try { ctx.wallet.useDemoAddress(addr.trim()); toast('Demo address set. Demo addresses cannot send real ATOM or open the CEO panel.', 'warn'); await ensurePlayer(); await startSession(); refreshState(); loadGame(ctx.currentGame); } catch (e) { toast(e.message, 'err'); }
    });
    document.getElementById('btnDisconnect').addEventListener('click', function () { ctx.wallet.disconnect(); toast('Disconnected.'); });
    var restored = ctx.wallet.restore();
    if (restored) { renderWallet(); await ensurePlayer(); await startSession(); }
    await refreshState();
    await loadGame('cosmos-btd');
    setInterval(refreshState, 30000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

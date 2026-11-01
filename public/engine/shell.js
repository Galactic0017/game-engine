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
      renderLeaderMini();
      if (ctx.player) { var mine = ctx.state.heroes.filter(function (h) { return h.owner === ctx.player.address; }); ctx.host.setPlayer(ctx.player, mine); renderHeroes(mine); }
      if (document.getElementById('view-marketplace').classList.contains('active') && window.MarketplaceUI) window.MarketplaceUI.render(document.getElementById('marketplace'), ctx);
    } catch (e) { /* state refresh is best-effort */ }
  }
  ctx.refreshState = refreshState; ctx.ensurePlayer = ensurePlayer;
  function renderLeaderMini() {
    var el = document.getElementById('leaderMini'); if (!el || !ctx.state) return;
    var rows = (ctx.state.leaderboard || []).slice(0, 5);
    el.innerHTML = rows.length ? rows.map(function (r, i) { return '<p class="small">' + (i + 1) + '. ' + esc(r.name || shortAddr(r.address)) + ' — ' + r.bestScore + ' pts · Lv ' + r.level + '</p>'; }).join('') : '<p class="muted small">No scores yet.</p>';
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
      renderActionBar();
    } catch (e) { toast(e.message, 'err'); }
  }
  ctx.loadGame = loadGame;
  async function submitWaveReport(payload) {
    if (!ctx.player) return;
    try {
      var r = await api('/api/progress/secure', 'POST', { address: ctx.player.address, sessionId: payload.sessionId, waveReached: payload.wave, score: payload.score, pops: payload.pops, heroXp: payload.heroXp, stateHash: payload.stateHash, won: payload.wave >= 50 });
      if (r.flagged) { toast('Wave claim flagged for CEO audit: ' + (r.reasons || []).join(', '), 'warn'); bus.emit('game:session_flagged', { address: ctx.player.address, reasons: r.reasons }); }
      else if (r.player) { ctx.player = r.player; toast('Wave ' + payload.wave + ' saved: +' + r.xpGain + ' XP, +' + r.creditGain + ' credits.', 'ok'); }
      var hero = ctx.host.equippedHero;
      if (hero && payload.heroXp > 0) { try { await api('/api/heroes/add-xp', 'POST', { address: ctx.player.address, heroId: hero.id, xp: Math.min(1000, payload.heroXp), pops: payload.pops }); } catch (e) {} }
      refreshState();
    } catch (e) { /* wave already counted locally; server sync is best-effort */ }
  }
  function renderActionBar() {
    var bar = document.getElementById('actionBar');
    if (ctx.currentGame !== 'cosmos-btd') { bar.innerHTML = '<span class="muted small">This game has its own controls inside the panel above.</span>'; return; }
    var hud = ctx.hud || {};
    var handle = ctx.host.current && ctx.host.current.handle;
    var defs = (window.CosmosBTD && window.CosmosBTD.TOWER_DEFS) || {};
    var towersHtml = Object.keys(defs).map(function (k) {
      var d = defs[k];
      return '<button class="towerBtn" data-tower="' + k + '"><strong>' + d.name + ' (' + d.key + ')</strong><small>' + d.cost + 'g · ' + esc(d.desc) + '</small></button>';
    }).join('');
    bar.innerHTML = '<div class="hud"><span>Gold <b>' + (hud.gold != null ? hud.gold : '—') + '</b></span><span>Lives <b>' + (hud.lives != null ? hud.lives : '—') + '</b></span><span>Wave <b>' + (hud.wave || 0) + '/50</b></span><span>Score <b>' + (hud.score || 0) + '</b></span><span>Pops <b>' + (hud.pops || 0) + '</b></span></div>'
      + towersHtml
      + '<label class="small" style="margin:0">Target<select id="abTarget" style="width:auto"><option value="first">First</option><option value="last">Last</option><option value="strong">Strong</option><option value="weak">Weak</option></select></label>'
      + '<label class="small" style="margin:0">Speed<select id="abSpeed" style="width:auto"><option value="1">1x</option><option value="2">2x</option><option value="3">3x</option></select></label>'
      + '<button id="abWave" class="primary">▶ Start wave</button>'
      + '<button id="abAuto">Auto: ' + (hud.autoStart ? 'ON' : 'OFF') + '</button>'
      + '<button id="abUpgrade">Upgrade ★</button><button id="abSell" class="ghost">Sell 70%</button>'
      + '<button id="abAbility">Hero ability</button>';
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
  }
  function showView(name) {
    document.querySelectorAll('nav.tabs button').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-nav') === name); });
    document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
    document.getElementById('view-' + name).classList.add('active');
    if (name === 'marketplace' && window.MarketplaceUI) window.MarketplaceUI.render(document.getElementById('marketplace'), ctx);
    if (name === 'ceo' && window.CeoUI) window.CeoUI.mountGate(document.getElementById('ceoGate'), document.getElementById('ceoPanel'), ctx);
  }
  document.querySelectorAll('nav.tabs button').forEach(function (b) { b.addEventListener('click', function () { showView(b.getAttribute('data-nav')); }); });
  async function init() {
    ctx.config = await api('/api/config');
    ctx.wallet = new window.WalletManager(bus, ctx.config);
    ctx.host = new window.EngineHost(bus, ctx.wallet, ctx.config);
    ctx.watcher = new window.RpcWatcher(bus, ctx.config);
    ctx.host.setViewport(document.getElementById('game-viewport'));
    ctx.host.registerGame({ id: 'cosmos-btd', name: 'Cosmos BTD', tagline: '50 waves · 5 towers · heroes', status: 'playable', load: async function () { return window.CosmosBTD; } });
    ctx.host.registerGame({ id: 'space-tycoon', name: 'Space Tycoon', tagline: 'Rigs + offline earnings', status: 'playable', load: async function () { return window.SpaceTycoon; } });
    ctx.host.registerGame({ id: 'atom-clicker', name: 'ATOM Core Clicker', tagline: 'Tap the core', status: 'playable', load: async function () { return window.AtomClicker; } });
    renderGameList(); renderWallet();
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

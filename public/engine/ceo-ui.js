/* CEO Panel — advanced. One-click execute, order timer, ban/remove,
 * ledger, flags, settings, audit. Every action is signed with the CEO
 * wallet (ADR-36); the server re-verifies. The CEO wallet also sends
 * the seller payout — the server never holds keys or ATOM.
 */
(function (global) {
  'use strict';
  var authed = false;
  var cache = { sales: [], ledger: null, users: null, flags: [], settings: null, audit: [], state: null };
  var tickTimer = null, refreshTimer = null, watcherStatus = null, activeTab = 'orders';
  function fmtLeft(sec) { if (sec == null || sec <= 0) return '0:00'; var m = Math.floor(sec / 60), s = sec % 60; return m + ':' + String(s).padStart(2, '0'); }
  function explorer(ctx, txid) { return '<a href="' + ctx.config.explorerTxUrl + txid + '" target="_blank" rel="noopener">Explorer ↗</a>'; }
  function setWatcherStatus(s) { watcherStatus = s; var el = document.getElementById('ceoWatcherStatus'); if (el) el.textContent = 'RPC watcher: ' + (s && s.status || 'idle') + (s && s.detail ? ' — ' + s.detail : ''); }
  function mountGate(gateEl, panelEl, ctx) {
    if (authed) { gateEl.innerHTML = '<p class="ok">Signed in as CEO: <code>' + ctx.esc(ctx.wallet.address || '') + '</code></p><button id="ceoReload">↻ Reload panel</button>'; panelEl.hidden = false; renderPanel(panelEl, ctx); }
    else {
      gateEl.innerHTML = '<p>CEO address: <code>' + ctx.esc(ctx.config.ceoAddress) + '</code></p><button id="ceoSignIn" class="primary">Sign in as CEO &amp; load panel</button><p class="small muted">Connect Keplr with the CEO address first. Each action signs in your wallet.</p>';
      panelEl.hidden = true;
    }
    var btn = document.getElementById('ceoSignIn');
    if (btn) btn.addEventListener('click', async function () {
      try {
        if (!ctx.wallet.address) throw new Error('Connect your wallet first (top right).');
        var r = await ctx.ceoGet('/api/admin/pending');
        cache.sales = r.sales || []; cache.flags = r.flags || []; cache.settings = r.settings || null;
        authed = true; ctx.toast('CEO signed in.', 'ok');
        gateEl.innerHTML = '<p class="ok">Signed in as CEO: <code>' + ctx.esc(ctx.wallet.address) + '</code></p><button id="ceoReload">↻ Reload panel</button>';
        panelEl.hidden = false; renderPanel(panelEl, ctx);
      } catch (e) { ctx.toast('CEO sign-in failed: ' + e.message, 'err'); }
    });
    var rel = document.getElementById('ceoReload');
    if (rel) rel.addEventListener('click', function () { renderPanel(panelEl, ctx); });
  }
  async function renderPanel(panelEl, ctx) {
    panelEl.innerHTML = '<div class="ceoLayout"><div class="ceoTabs">'
      + ['orders', 'ledger', 'users', 'flags', 'settings', 'announce', 'audit'].map(function (t) { return '<button data-ceotab="' + t + '" class="' + (activeTab === t ? 'active' : '') + '">' + t[0].toUpperCase() + t.slice(1) + (t === 'flags' && cache.flags.length ? ' (' + cache.flags.length + ')' : '') + '</button>'; }).join('')
      + '</div><div class="ceoMain"><div id="ceoTabBody"></div></div></div><p class="small muted" id="ceoWatcherStatus"></p>';
    setWatcherStatus(watcherStatus);
    panelEl.querySelectorAll('[data-ceotab]').forEach(function (b) { b.addEventListener('click', function () { activeTab = b.getAttribute('data-ceotab'); renderPanel(panelEl, ctx); }); });
    var body = panelEl.querySelector('#ceoTabBody');
    if (tickTimer) clearInterval(tickTimer);
    if (refreshTimer) clearInterval(refreshTimer);
    tickTimer = setInterval(function () {
      body.querySelectorAll('[data-expires]').forEach(function (n) {
        var left = Number(n.getAttribute('data-expires')) - Math.floor((Date.now() - Number(n.getAttribute('data-now'))) / 1000);
        n.textContent = fmtLeft(Math.max(0, left));
        n.classList.toggle('low', left > 0 && left < 300);
      });
    }, 1000);
    if (activeTab === 'orders') {
      await refreshOrders(ctx);
      renderOrders(body, ctx);
      refreshTimer = setInterval(async function () { if (document.getElementById('ceoTabBody')) { await refreshOrders(ctx); renderOrders(document.getElementById('ceoTabBody'), ctx); } }, 20000);
    } else if (activeTab === 'ledger') { await refreshLedger(ctx); renderLedger(body, ctx); }
    else if (activeTab === 'users') { await refreshUsers(ctx); renderUsers(body, ctx); }
    else if (activeTab === 'flags') { await refreshFlags(ctx); renderFlags(body, ctx); }
    else if (activeTab === 'settings') { await refreshSettings(ctx); renderSettings(body, ctx); }
    else if (activeTab === 'announce') { renderAnnounce(body, ctx); }
    else if (activeTab === 'audit') { await refreshAudit(ctx); renderAudit(body, ctx); }
  }
  async function refreshOrders(ctx) { try { var r = await ctx.ceoGet('/api/admin/pending'); cache.sales = r.sales || []; cache.flags = r.flags || []; cache.settings = r.settings || null; } catch (e) { ctx.toast(e.message, 'err'); } }
  async function refreshLedger(ctx) { try { cache.ledger = await ctx.ceoGet('/api/admin/ledger'); } catch (e) { ctx.toast(e.message, 'err'); } }
  async function refreshUsers(ctx) { try { cache.users = await ctx.ceoGet('/api/admin/users'); cache.state = await ctx.api('/api/state'); } catch (e) { ctx.toast(e.message, 'err'); } }
  async function refreshFlags(ctx) { try { var r = await ctx.ceoGet('/api/admin/flags'); cache.flags = r.flags || []; } catch (e) { ctx.toast(e.message, 'err'); } }
  async function refreshSettings(ctx) { try { cache.settings = (await ctx.ceoGet('/api/admin/settings')).settings; } catch (e) { ctx.toast(e.message, 'err'); } }
  async function refreshAudit(ctx) { try { cache.audit = (await ctx.ceoGet('/api/admin/audit')).audit || []; } catch (e) { ctx.toast(e.message, 'err'); } }
  function statsBar(ctx) {
    var all = cache.ledger;
    var t = (all && all.totals) || { volume: 0, fees: 0, payouts: 0, pending: cache.sales.length, closed: 0 };
    return '<div class="statRow">'
      + '<div class="stat"><b>' + cache.sales.length + '</b><span>Pending orders</span></div>'
      + '<div class="stat"><b>' + t.volume + ' ATOM</b><span>Total volume (closed)</span></div>'
      + '<div class="stat"><b>' + t.fees + ' ATOM</b><span>Fees earned</span></div>'
      + '<div class="stat"><b>' + t.payouts + ' ATOM</b><span>Seller payouts paid</span></div>'
      + '<div class="stat"><b>' + (cache.flags || []).length + '</b><span>Open flags</span></div></div>';
  }
  function renderOrders(body, ctx) {
    var sales = cache.sales || [];
    var ttlSec = ((cache.settings && cache.settings.orderTtlMinutes) || ctx.config.orderTtlMinutes || 30) * 60;
    body.innerHTML = statsBar(ctx)
      + '<p><label class="small" style="display:inline"><input type="checkbox" id="ceoAutoVerify" style="width:auto" ' + (cache.settings && cache.settings.autoVerifyEnabled ? 'checked' : '') + '> Auto-verify new orders on-chain when they arrive</label> <button id="ceoSaveAuto" class="ghost">Save</button> <span class="muted small">Auto-verify still fails closed: a TX the LCD cannot confirm never moves a hero.</span></p>'
      + (sales.length ? sales.map(function (s) {
        var elapsed = Math.max(0, ttlSec - (s.secondsLeft || 0));
        var pct = Math.min(100, Math.round(elapsed / ttlSec * 100));
        var payout = s.sellerPayout || { amount: s.sellerAmount, to: s.sellerAddress, status: 'pending' };
        return '<div class="card" style="margin-bottom:12px" data-sale="' + s.id + '">'
          + '<h4>' + ctx.esc(s.heroName) + ' — ' + s.priceAtom + ' ATOM <span class="pill pending">' + s.status + '</span></h4>'
          + '<p class="small">Order <code>' + ctx.esc(s.id) + '</code> · Listing <code>' + ctx.esc(s.listingId) + '</code><br>Buyer <code>' + ctx.esc(s.buyerAddress) + '</code><br>Seller <code>' + ctx.esc(s.sellerAddress) + '</code> gets <strong>' + s.sellerAmount + ' ATOM</strong> · CEO fee <strong>' + s.ceoFee + ' ATOM</strong><br>Buyer TX: <code>' + ctx.esc(s.txid) + '</code> ' + explorer(ctx, s.txid) + '</p>'
          + '<p>Closes in <span class="timer" data-expires="' + (s.secondsLeft || 0) + '" data-now="' + Date.now() + '">' + fmtLeft(s.secondsLeft || 0) + '</span></p>'
          + '<div class="progress"><div style="width:' + pct + '%"></div></div>'
          + '<p class="small">Seller payout: <span class="pill ' + (payout.status === 'paid' ? 'closed' : 'pending') + '">' + payout.status + '</span>' + (payout.txid ? ' <code>' + ctx.esc(payout.txid) + '</code>' : '') + '</p>'
          + '<div class="steps" data-steps><span class="step" data-step="verify">1 Verify</span><span class="step" data-step="send">2 Send seller</span><span class="step" data-step="move">3 Move + close</span></div>'
          + '<div class="checkRow"><input type="checkbox" data-check="amount" id="ck-a-' + s.id + '"><label for="ck-a-' + s.id + '" style="margin:0">Amount = ' + s.priceAtom + ' ATOM to CEO address</label></div>'
          + '<div class="checkRow"><input type="checkbox" data-check="ceo" id="ck-c-' + s.id + '"><label for="ck-c-' + s.id + '" style="margin:0">Recipient is CEO address, sender is buyer</label></div>'
          + '<div class="checkRow"><input type="checkbox" data-check="memo" id="ck-m-' + s.id + '"><label for="ck-m-' + s.id + '" style="margin:0">Memo = listing ID</label></div>'
          + '<div class="checkRow"><input type="checkbox" data-check="explorer" id="ck-e-' + s.id + '"><label for="ck-e-' + s.id + '" style="margin:0">Checked on explorer, TX succeeded</label></div>'
          + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">'
          + '<button class="primary" data-execute="' + s.id + '">⚡ One-click: verify + send + move + close</button>'
          + '<button data-verify="' + s.id + '">Verify on-chain</button>'
          + '<button data-approve="' + s.id + '">Approve (manual checks)</button>'
          + '<button data-payout="' + s.id + '" class="ghost">Record payout TXID</button>'
          + '<button data-reject="' + s.id + '" class="danger">Reject order</button>'
          + '<button data-banbuyer="' + s.buyerAddress + '" class="ghost">Ban buyer</button>'
          + '</div><p class="small muted" data-verify-result></p></div>';
      }).join('') : '<p class="muted">No pending orders. New orders appear here with a live countdown.</p>');
    var saveAuto = body.querySelector('#ceoSaveAuto');
    if (saveAuto) saveAuto.addEventListener('click', async function () {
      try { await ctx.ceoFetch('/api/admin/settings', { autoVerifyEnabled: body.querySelector('#ceoAutoVerify').checked }); ctx.toast('Auto-verify setting saved.', 'ok'); } catch (e) { ctx.toast(e.message, 'err'); }
    });
    body.querySelectorAll('[data-verify]').forEach(function (b) { b.addEventListener('click', async function () { await verifyOrder(b.getAttribute('data-verify'), body, ctx); }); });
    body.querySelectorAll('[data-approve]').forEach(function (b) { b.addEventListener('click', async function () { await approveOrder(b.getAttribute('data-approve'), body, ctx); }); });
    body.querySelectorAll('[data-reject]').forEach(function (b) { b.addEventListener('click', async function () { await rejectOrder(b.getAttribute('data-reject'), ctx); }); });
    body.querySelectorAll('[data-execute]').forEach(function (b) { b.addEventListener('click', async function () { await executeOrder(b.getAttribute('data-execute'), body, ctx); }); });
    body.querySelectorAll('[data-payout]').forEach(function (b) { b.addEventListener('click', async function () { await recordPayout(b.getAttribute('data-payout'), ctx); }); });
    body.querySelectorAll('[data-banbuyer]').forEach(function (b) { b.addEventListener('click', async function () { await banAddress(b.getAttribute('data-banbuyer'), ctx); }); });
  }
  function checksTicked(card) {
    var q = function (n) { var el = card.querySelector('[data-check="' + n + '"]'); return el && el.checked; };
    return { checkedAmount: q('amount'), checkedCeo: q('ceo'), checkedMemo: q('memo'), checkedExplorer: q('explorer') };
  }
  function setStep(card, name, cls) { var el = card.querySelector('[data-step="' + name + '"]'); if (el) el.className = 'step ' + cls; }
  async function verifyOrder(saleId, body, ctx) {
    var card = body.querySelector('[data-sale="' + saleId + '"]');
    try {
      var r = await ctx.ceoFetch('/api/admin/auto-verify-order', { saleId: saleId });
      var out = card.querySelector('[data-verify-result]');
      out.innerHTML = (r.verified ? '<span class="ok">✓ Verified on-chain.</span> ' : '<span class="bad">✗ Not verified.</span> ') + r.checks.map(function (c) { return (c.ok ? '✓' : '✗') + ' ' + ctx.esc(c.name); }).join(' · ');
      if (r.verified) setStep(card, 'verify', 'done'); else setStep(card, 'verify', 'fail');
    } catch (e) { ctx.toast(e.message, 'err'); }
  }
  async function approveOrder(saleId, body, ctx) {
    var card = body.querySelector('[data-sale="' + saleId + '"]');
    var c = checksTicked(card);
    try {
      await ctx.ceoFetch('/api/admin/approve', Object.assign({ saleId: saleId }, c));
      ctx.toast('Approved — hero moved to buyer. Seller payout still pending.', 'ok');
      if (window.engineBus) window.engineBus.emit('ceo:order_approved', saleId, '');
      await refreshOrders(ctx); renderOrders(body, ctx);
    } catch (e) { ctx.toast(e.message, 'err'); }
  }
  async function rejectOrder(saleId, ctx) {
    var reason = prompt('Reject reason (buyer/seller can see this):', 'Rejected by CEO');
    if (reason === null) return;
    try { await ctx.ceoFetch('/api/admin/reject', { saleId: saleId, reason: reason }); ctx.toast('Order rejected. Listing re-opened.', 'ok'); await refreshOrders(ctx); var b = document.getElementById('ceoTabBody'); if (b) renderOrders(b, ctx); } catch (e) { ctx.toast(e.message, 'err'); }
  }
  async function recordPayout(saleId, ctx) {
    var txid = prompt('Paste the seller payout TX hash (64 hex):');
    if (!txid) return;
    try { await ctx.ceoFetch('/api/admin/record-payout', { saleId: saleId, payoutTxid: txid.trim() }); ctx.toast('Payout recorded.', 'ok'); await refreshOrders(ctx); var b = document.getElementById('ceoTabBody'); if (b) renderOrders(b, ctx); } catch (e) { ctx.toast(e.message, 'err'); }
  }
  async function banAddress(address, ctx) {
    var reason = prompt('Ban reason for ' + address + ':', 'Banned by CEO');
    if (reason === null) return;
    try { await ctx.ceoFetch('/api/admin/ban', { address: address, reason: reason }); ctx.toast('Banned: ' + address, 'ok'); await refreshOrders(ctx); var b = document.getElementById('ceoTabBody'); if (b) renderOrders(b, ctx); } catch (e) { ctx.toast(e.message, 'err'); }
  }
  async function executeOrder(saleId, body, ctx) {
    var sale = (cache.sales || []).find(function (s) { return s.id === saleId; });
    if (!sale) return ctx.toast('Order not found.', 'err');
    var card = body.querySelector('[data-sale="' + saleId + '"]');
    setStep(card, 'verify', 'busy');
    var autoVerify = false;
    try {
      var v = await ctx.ceoFetch('/api/admin/auto-verify-order', { saleId: saleId });
      if (v.verified) { autoVerify = true; setStep(card, 'verify', 'done'); }
      else {
        setStep(card, 'verify', 'fail');
        var c = checksTicked(card);
        if (!(c.checkedAmount && c.checkedCeo && c.checkedMemo && c.checkedExplorer)) { ctx.toast('On-chain check could not confirm this TX. Tick all 4 manual checks (after checking the explorer yourself) to execute manually.', 'warn'); return; }
        if (!confirm('On-chain auto-verify did NOT confirm this TX. Execute manually from your own explorer checks?')) return;
        setStep(card, 'verify', 'done');
      }
    } catch (e) { ctx.toast('Verify step failed: ' + e.message, 'err'); setStep(card, 'verify', 'fail'); return; }
    // Step 2: send seller payout from the CEO wallet (one wallet approval).
    var payoutTxid = null;
    var payout = sale.sellerPayout || { status: 'pending' };
    if (payout.status !== 'paid') {
      if (ctx.wallet.address !== ctx.config.ceoAddress) { ctx.toast('Payout must be sent from the CEO wallet. Connect the CEO address.', 'err'); return; }
      if (!ctx.wallet.address) { ctx.toast('Real payout needs a real wallet.', 'err'); return; }
      setStep(card, 'send', 'busy');
      var ok = confirm('Send seller payout: ' + sale.sellerAmount + ' ATOM to ' + sale.sellerAddress + '?\nMemo: Payout ' + sale.id + '\n\nYou will review this in your wallet before signing.');
      if (!ok) { setStep(card, 'send', ''); return; }
      try {
        var sent = await ctx.wallet.sendAtom({ toAddress: sale.sellerAddress, amountAtom: sale.sellerAmount, memo: 'Payout ' + sale.id });
        payoutTxid = sent.txhash; setStep(card, 'send', 'done');
      } catch (e) { ctx.toast('Payout send failed: ' + e.message + ' Order left pending — nothing moved.', 'err'); setStep(card, 'send', 'fail'); return; }
    } else setStep(card, 'send', 'done');
    // Step 3: move + close on the server (CEO-signed, fail-closed).
    setStep(card, 'move', 'busy');
    try {
      var c2 = checksTicked(card);
      var r = await ctx.ceoFetch('/api/admin/execute-order', Object.assign({ saleId: saleId, autoVerify: autoVerify, payoutTxid: payoutTxid }, c2));
      setStep(card, 'move', 'done');
      ctx.toast('✓ Done: ' + r.note, 'ok');
      if (window.engineBus) window.engineBus.emit('ceo:order_approved', saleId, sale.txid);
      await refreshOrders(ctx); renderOrders(body, ctx);
      await ctx.refreshState();
    } catch (e) { ctx.toast('Execute failed: ' + e.message + (payoutTxid ? ' Payout TX ' + payoutTxid + ' was already sent — record it with "Record payout TXID" after checking.' : ''), 'err'); setStep(card, 'move', 'fail'); }
  }
  function renderLedger(body, ctx) {
    var led = cache.ledger;
    if (!led) { body.innerHTML = '<p class="muted">Loading ledger…</p>'; return; }
    var t = led.totals || {};
    body.innerHTML = statsBar(ctx)
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px"><button id="ledExport">⬇ Export CSV</button><button id="ledRefresh">↻ Refresh</button><select id="ledKind" style="width:auto"><option value="">All kinds</option>' + (led.kinds || []).map(function (k) { return '<option>' + ctx.esc(k) + '</option>'; }).join('') + '</select></div>'
      + '<table><tr><th>Time</th><th>Kind</th><th>Hero / Order</th><th>Amounts</th><th>Parties / TX</th></tr>'
      + led.entries.map(function (e) {
        return '<tr><td class="small">' + ctx.esc((e.ts || '').replace('T', ' ').slice(0, 19)) + '</td><td><span class="pill">' + ctx.esc(e.kind) + '</span></td><td>' + ctx.esc(e.heroName || e.listingId || e.saleId || '—') + '</td><td>' + (e.priceAtom != null ? e.priceAtom + ' ATOM · fee ' + (e.ceoFee || 0) : (e.amount != null ? e.amount + ' ATOM' : '—')) + '</td><td class="small mono">' + ctx.esc(e.buyerAddress || e.address || '') + (e.txid ? '<br>' + explorer(ctx, e.txid) : '') + '</td></tr>';
      }).join('') + '</table>';
    body.querySelector('#ledRefresh').addEventListener('click', async function () { await refreshLedger(ctx); renderLedger(body, ctx); });
    body.querySelector('#ledKind').addEventListener('change', function (ev) {
      var kind = ev.target.value;
      var rows = led.entries.filter(function (e) { return !kind || e.kind === kind; });
      var tmp = { entries: rows, totals: t, kinds: led.kinds };
      var keep = cache.ledger; cache.ledger = tmp; renderLedger(body, ctx); cache.ledger = keep;
    });
    body.querySelector('#ledExport').addEventListener('click', function () {
      var csv = 'time,kind,hero,priceAtom,ceoFee,sellerAmount,buyer,seller,txid\n' + led.entries.map(function (e) { return [e.ts, e.kind, e.heroName || '', e.priceAtom || '', e.ceoFee || '', e.sellerAmount || e.amount || '', e.buyerAddress || '', e.sellerAddress || '', e.txid || ''].map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'game-ledger.csv'; a.click();
    });
  }
  function renderUsers(body, ctx) {
    var users = (cache.users && cache.users.users) || [];
    var heroes = (cache.state && cache.state.heroes) || [];
    body.innerHTML = '<h4>Users</h4><table><tr><th>User</th><th>Level / Score</th><th>Heroes / Orders</th><th>Status</th><th>Actions</th></tr>'
      + users.map(function (u) {
        return '<tr><td><strong>' + ctx.esc(u.name) + '</strong><br><code class="small">' + ctx.esc(u.address) + '</code></td><td>Lv ' + u.level + ' · ' + u.bestScore + ' pts · ' + u.credits + ' credits</td><td>' + u.heroes + ' heroes · ' + u.orders + ' orders</td><td>' + (u.banned ? '<span class="pill rejected">BANNED</span><br><span class="small">' + ctx.esc(u.ban.reason) + '</span>' : '<span class="pill closed">Active</span>') + '</td><td>' + (u.banned ? '<button data-unban="' + u.address + '">Unban</button>' : '<button data-ban="' + u.address + '" class="danger">Ban</button>') + '</td></tr>';
      }).join('') + '</table>'
      + '<h4 style="margin-top:18px">All heroes — remove</h4><table><tr><th>Hero</th><th>Owner</th><th>Level</th><th>Actions</th></tr>'
      + heroes.map(function (h) {
        return '<tr><td>' + ctx.esc(h.name) + ' <span class="pill">' + ctx.esc(h.rarity) + '</span></td><td class="small mono">' + ctx.esc(h.owner) + '</td><td>Lv ' + h.level + '</td><td><button data-rmhero="' + h.id + '" class="danger">Remove hero</button></td></tr>';
      }).join('') + '</table>'
      + '<h4 style="margin-top:18px">Active listings — remove</h4><table><tr><th>Listing</th><th>Hero</th><th>Price</th><th>Seller</th><th>Actions</th></tr>'
      + ((cache.state && cache.state.listings) || []).map(function (l) {
        return '<tr><td class="small mono">' + ctx.esc(l.id) + '</td><td>' + ctx.esc(l.heroName) + '</td><td>' + l.priceAtom + ' ATOM</td><td class="small mono">' + ctx.esc(l.sellerAddress) + '</td><td><button data-rmlist="' + l.id + '" class="danger">Remove listing</button></td></tr>';
      }).join('') + '</table>';
    body.querySelectorAll('[data-ban]').forEach(function (b) { b.addEventListener('click', async function () { await banAddress(b.getAttribute('data-ban'), ctx); await refreshUsers(ctx); renderUsers(body, ctx); }); });
    body.querySelectorAll('[data-unban]').forEach(function (b) { b.addEventListener('click', async function () { try { await ctx.ceoFetch('/api/admin/unban', { address: b.getAttribute('data-unban') }); ctx.toast('Unbanned.', 'ok'); await refreshUsers(ctx); renderUsers(body, ctx); } catch (e) { ctx.toast(e.message, 'err'); } }); });
    body.querySelectorAll('[data-rmhero]').forEach(function (b) { b.addEventListener('click', async function () { var reason = prompt('Remove hero reason:', 'Removed by CEO'); if (reason === null) return; try { await ctx.ceoFetch('/api/admin/remove-hero', { heroId: b.getAttribute('data-rmhero'), reason: reason }); ctx.toast('Hero removed.', 'ok'); await refreshUsers(ctx); renderUsers(body, ctx); } catch (e) { ctx.toast(e.message, 'err'); } }); });
    body.querySelectorAll('[data-rmlist]').forEach(function (b) { b.addEventListener('click', async function () { var reason = prompt('Remove listing reason:', 'Removed by CEO'); if (reason === null) return; try { await ctx.ceoFetch('/api/admin/remove-listing', { listingId: b.getAttribute('data-rmlist'), reason: reason }); ctx.toast('Listing removed.', 'ok'); await refreshUsers(ctx); renderUsers(body, ctx); } catch (e) { ctx.toast(e.message, 'err'); } }); });
  }
  function renderFlags(body, ctx) {
    var flags = cache.flags || [];
    body.innerHTML = '<h4>Anti-cheat flags</h4>' + (flags.length ? '<table><tr><th>Time</th><th>Type</th><th>Address</th><th>Detail</th><th>Action</th></tr>' + flags.map(function (f) {
      return '<tr><td class="small">' + ctx.esc((f.ts || '').replace('T', ' ').slice(0, 19)) + '</td><td>' + ctx.esc(f.type) + '</td><td class="small mono">' + ctx.esc(f.address || '') + '</td><td class="small">' + ctx.esc((f.reasons || []).join(', ') || '') + ' · wave ' + (f.wave || '') + ' · score ' + (f.score || '') + '</td><td>' + (f.resolved ? '<span class="pill closed">Resolved</span>' : '<button data-resolve="' + f.id + '">Resolve</button>') + '</td></tr>';
    }).join('') + '</table>' : '<p class="muted">No flags. Flagged claims earn nothing until you resolve them.</p>');
    body.querySelectorAll('[data-resolve]').forEach(function (b) { b.addEventListener('click', async function () { try { await ctx.ceoFetch('/api/admin/flag-resolve', { flagId: b.getAttribute('data-resolve') }); ctx.toast('Flag resolved.', 'ok'); await refreshFlags(ctx); renderFlags(body, ctx); } catch (e) { ctx.toast(e.message, 'err'); } }); });
  }
  function renderSettings(body, ctx) {
    var s = cache.settings || { feePercent: ctx.config.feePercent, orderTtlMinutes: ctx.config.orderTtlMinutes, autoVerifyEnabled: false };
    body.innerHTML = '<h4>Platform settings</h4>'
      + '<label>CEO fee % (4–7, applies to new listings only)</label><input id="setFee" type="number" min="4" max="7" step="0.5" value="' + s.feePercent + '">'
      + '<label>Order timer — minutes until a pending order closes (1–1440)</label><input id="setTtl" type="number" min="1" max="1440" value="' + s.orderTtlMinutes + '">'
      + '<label class="checkRow"><input type="checkbox" id="setAuto" style="width:auto" ' + (s.autoVerifyEnabled ? 'checked' : '') + '> Auto-verify orders on-chain when possible</label>'
      + '<p><button id="setSave" class="primary">Save settings</button></p>'
      + '<h4>Chain / verification</h4><p class="small">Chain: <code>' + ctx.esc(ctx.config.chainId) + '</code><br>CEO address: <code>' + ctx.esc(ctx.config.ceoAddress) + '</code><br>LCD: <code>' + ctx.esc((ctx.config.lcdUrls || []).join(', ')) + '</code><br>WebSocket: <code>' + ctx.esc(ctx.config.wsUrl || '') + '</code></p>'
      + '<p><button id="setWatch">Start RPC watcher (live TX notifications)</button> <span class="small muted" id="ceoWatcherStatus2"></span></p>'
      + '<p class="small muted">Model: no contracts. Buyer → CEO address (full price, memo = listing ID) → CEO moves item → CEO sends seller payout. The server never holds keys.</p>';
    body.querySelector('#setSave').addEventListener('click', async function () {
      try { await ctx.ceoFetch('/api/admin/settings', { feePercent: Number(body.querySelector('#setFee').value), orderTtlMinutes: Number(body.querySelector('#setTtl').value), autoVerifyEnabled: body.querySelector('#setAuto').checked }); ctx.toast('Settings saved.', 'ok'); } catch (e) { ctx.toast(e.message, 'err'); }
    });
    body.querySelector('#setWatch').addEventListener('click', function () {
      if (ctx.watcher) { (cache.sales || []).forEach(function (s) { try { ctx.watcher.watch(s.txid, { listingId: s.listingId }); } catch (e) {} }); ctx.toast('Watcher started for pending TXs. Confirmations still need server auto-verify.', 'ok'); }
    });
  }
  function renderAnnounce(body, ctx) {
    body.innerHTML = '<h4>Post an announcement</h4><p class="small muted">Shows as a banner at the top of the hub for all players.</p>'
      + '<label>Title</label><input id="annTitle" maxlength="80" placeholder="e.g. Double XP weekend">'
      + '<label>Message</label><textarea id="annBody" rows="3" maxlength="500" placeholder="What should players know?"></textarea>'
      + '<p><button id="annPost" class="primary">Post announcement</button></p><div id="annList"></div>';
    body.querySelector('#annPost').addEventListener('click', async function () {
      try { var r = await ctx.ceoFetch('/api/admin/announce', { title: body.querySelector('#annTitle').value, body: body.querySelector('#annBody').value }); ctx.toast('Announcement posted.', 'ok'); body.querySelector('#annList').innerHTML = '<p class="small">Latest: <strong>' + ctx.esc(r.announcements[0].title) + '</strong></p>'; if (ctx.refreshState) ctx.refreshState(); } catch (e) { ctx.toast(e.message, 'err'); }
    });
  }
  function renderAudit(body, ctx) {
    var audit = cache.audit || [];
    body.innerHTML = '<h4>Audit log — every CEO action</h4>' + (audit.length ? '<table><tr><th>Time</th><th>Action</th><th>Detail</th></tr>' + audit.map(function (a) { return '<tr><td class="small">' + ctx.esc((a.ts || '').replace('T', ' ').slice(0, 19)) + '</td><td>' + ctx.esc(a.action) + '</td><td class="small mono">' + ctx.esc(JSON.stringify({ saleId: a.saleId, address: a.address, listingId: a.listingId, heroId: a.heroId })) + '</td></tr>'; }).join('') + '</table>' : '<p class="muted">No CEO actions recorded yet.</p>');
  }
  global.CeoUI = { mountGate: mountGate, setWatcherStatus: setWatcherStatus };
})(typeof window !== 'undefined' ? window : globalThis);

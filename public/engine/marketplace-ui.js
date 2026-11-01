/* Marketplace UI — CEO-escrow, no contracts.
 * Buyer sends the FULL price in ONE send to the CEO address (memo =
 * listing ID) from their own wallet. The CEO moves the item, then sends
 * the seller their cut after the fee. This UI never holds keys or ATOM.
 */
(function (global) {
  'use strict';
  var timer = null;
  var mkQ = '', mkRarity = '', mkSort = 'price-asc';
  function fmtLeft(sec) { if (sec <= 0) return 'expired'; var m = Math.floor(sec / 60), s = sec % 60; return m + ':' + String(s).padStart(2, '0'); }
  function startTimer(el, ctx) {
    if (timer) clearInterval(timer);
    timer = setInterval(function () {
      el.querySelectorAll('[data-expires]').forEach(function (n) {
        var left = Number(n.getAttribute('data-expires')) - Math.floor((Date.now() - Number(n.getAttribute('data-now'))) / 1000);
        n.textContent = fmtLeft(left);
        n.classList.toggle('low', left > 0 && left < 300);
      });
    }, 1000);
  }
  async function render(el, ctx) {
    var state = ctx.state || (await ctx.api('/api/state'));
    ctx.state = state;
    var me = ctx.player && ctx.player.address;
    var listings = (state.listings || []).filter(function (l) { var q = mkQ.toLowerCase(); return (!q || (l.heroName || '').toLowerCase().indexOf(q) >= 0) && (!mkRarity || l.rarity === mkRarity); });
    listings.sort(function (a, b) { if (mkSort === 'price-desc') return b.priceAtom - a.priceAtom; if (mkSort === 'level') return b.level - a.level; if (mkSort === 'name') return (a.heroName || '').localeCompare(b.heroName || ''); return a.priceAtom - b.priceAtom; });
    var rarities = []; (state.listings || []).forEach(function (l) { if (rarities.indexOf(l.rarity) < 0) rarities.push(l.rarity); });
    var myOrders = (state.sales || []).filter(function (s) { return me && (s.buyerAddress === me || s.sellerAddress === me); }).slice().reverse();
    var myHeroes = (state.heroes || []).filter(function (h) { return me && h.owner === me; });
    var fee = state.feePercent;
    var ceo = state.ceoAddress;
    el.innerHTML = '<p>CEO fee <strong>' + fee + '%</strong> · CEO address <code>' + ctx.esc(ceo) + '</code> · Orders close after <strong>' + state.orderTtlMinutes + ' min</strong> if not completed.</p>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px"><button id="mkRefresh">↻ Refresh</button><input id="mkSearch" placeholder="Search heroes…" style="width:170px" value="' + ctx.esc(mkQ) + '"><select id="mkRarity" style="width:auto"><option value="">All rarities</option>' + rarities.map(function (r) { return '<option' + (mkRarity === r ? ' selected' : '') + '>' + ctx.esc(r) + '</option>'; }).join('') + '</select><select id="mkSort" style="width:auto"><option value="price-asc"' + (mkSort === 'price-asc' ? ' selected' : '') + '>Price ↑</option><option value="price-desc"' + (mkSort === 'price-desc' ? ' selected' : '') + '>Price ↓</option><option value="level"' + (mkSort === 'level' ? ' selected' : '') + '>Level</option><option value="name"' + (mkSort === 'name' ? ' selected' : '') + '>Name</option></select><span class="muted small">Send EXACTLY the full price. Memo must be exactly the listing ID.</span></div>'
      + '<h4>For sale</h4>'
      + (listings.length ? '<div class="listingGrid">' + listings.map(function (l) {
        return '<div class="listing"><h4>' + ctx.esc(l.heroName) + ' <span class="pill">' + ctx.esc(l.rarity) + '</span></h4>'
          + '<div class="price">' + l.priceAtom + ' ATOM</div>'
          + '<p class="small">Seller gets ' + l.sellerAmount + ' · CEO fee ' + l.ceoFee + ' (' + l.feePercent + '%)<br>Seller: <code>' + ctx.esc(ctx.shortAddr(l.sellerAddress)) + '</code> · Hero Lv ' + l.level + '</p>'
          + '<button class="primary" data-buy="' + l.id + '">Buy with Keplr — send ' + l.priceAtom + ' ATOM</button> '
          + '<button class="ghost" data-manual="' + l.id + '">I already sent — submit TXID</button></div>';
      }).join('') + '</div>' : '<p class="muted">Nothing for sale right now. List a hero below.</p>')
      + '<h4 style="margin-top:18px">My orders</h4>'
      + (myOrders.length ? '<table><tr><th>Order</th><th>Hero</th><th>Price</th><th>Status</th><th>Closes in</th><th>TX</th></tr>' + myOrders.map(function (s) {
        return '<tr><td class="mono small">' + ctx.esc(s.id) + '</td><td>' + ctx.esc(s.heroName) + '</td><td>' + s.priceAtom + ' ATOM</td><td><span class="pill ' + s.status + '">' + s.status + '</span></td><td><span class="timer" data-expires="' + (s.secondsLeft || 0) + '" data-now="' + Date.now() + '">' + fmtLeft(s.secondsLeft || 0) + '</span></td><td><a href="' + ctx.config.explorerTxUrl + s.txid + '" target="_blank" rel="noopener">Explorer</a></td></tr>';
      }).join('') + '</table>' : '<p class="muted small">No orders yet.</p>')
      + '<h4 style="margin-top:18px">List a hero for sale</h4>'
      + (myHeroes.length ? '<label>Hero</label><select id="mkHero">' + myHeroes.map(function (h) { return '<option value="' + h.id + '">' + ctx.esc(h.name) + ' — Lv ' + h.level + '</option>'; }).join('') + '</select><label>Price (ATOM)</label><input id="mkPrice" type="number" min="0.000001" step="0.000001" placeholder="e.g. 10"><p class="small muted" id="mkPreview"></p><button id="mkList" class="primary">List hero</button>' : '<p class="muted small">You own no heroes yet. Claim a hero from the sidebar (unlocks by level).</p>')
      + '<h4 style="margin-top:18px">Skins (in-game credits)</h4>'
      + '<div class="listingGrid">' + ((ctx.config.skins || []).map(function (sk) {
        var owned = ctx.player && (ctx.player.skins || []).indexOf(sk.id) >= 0;
        return '<div class="listing"><h4>' + ctx.esc(sk.name) + '</h4><p class="small">' + ctx.esc(sk.desc) + '</p><p><strong>' + sk.cost + ' credits</strong></p><button data-skin="' + sk.id + '">' + (owned ? 'Equip' : 'Buy + equip') + '</button></div>';
      }).join('')) + '</div>';
    startTimer(el, ctx);
    el.querySelector('#mkRefresh').addEventListener('click', async function () { await ctx.refreshState(); render(el, ctx); });
    el.querySelector('#mkSearch').addEventListener('change', function (ev) { mkQ = ev.target.value; render(el, ctx); });
    el.querySelector('#mkRarity').addEventListener('change', function (ev) { mkRarity = ev.target.value; render(el, ctx); });
    el.querySelector('#mkSort').addEventListener('change', function (ev) { mkSort = ev.target.value; render(el, ctx); });
    var priceInput = el.querySelector('#mkPrice');
    if (priceInput) {
      var upd = function () { var p = Number(priceInput.value); var prev = el.querySelector('#mkPreview'); if (prev) prev.textContent = p > 0 ? 'You will get ' + (p * (1 - fee / 100)).toFixed(6) + ' ATOM after the ' + fee + '% CEO fee. Buyer sends the full ' + p + ' ATOM to the CEO address.' : ''; };
      priceInput.addEventListener('input', upd);
      el.querySelector('#mkList').addEventListener('click', async function () {
        try { var r = await ctx.api('/api/listings', 'POST', { heroId: el.querySelector('#mkHero').value, address: me, sellerAddress: me, priceAtom: Number(priceInput.value) }); ctx.toast('Listed: ' + r.listing.heroName + ' for ' + r.listing.priceAtom + ' ATOM.', 'ok'); await ctx.refreshState(); render(el, ctx); } catch (e) { ctx.toast(e.message, 'err'); }
      });
    }
    el.querySelectorAll('[data-skin]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        if (!me) return ctx.toast('Connect your wallet first.', 'warn');
        try { await ctx.api('/api/shop/buy-skin', 'POST', { address: me, skinId: btn.getAttribute('data-skin') }); ctx.toast('Skin equipped.', 'ok'); await ctx.refreshState(); render(el, ctx); } catch (e) { ctx.toast(e.message, 'err'); }
      });
    });
    el.querySelectorAll('[data-buy]').forEach(function (btn) {
      btn.addEventListener('click', function () { buyFlow(btn.getAttribute('data-buy'), ctx, el); });
    });
    el.querySelectorAll('[data-manual]').forEach(function (btn) {
      btn.addEventListener('click', function () { manualSubmit(btn.getAttribute('data-manual'), ctx, el); });
    });
  }
  async function buyFlow(listingId, ctx, el) {
    var state = ctx.state;
    var l = (state.listings || []).find(function (x) { return x.id === listingId; });
    if (!l) return ctx.toast('Listing not found. Refresh.', 'err');
    if (!ctx.wallet || !ctx.wallet.address) return ctx.toast('Connect your wallet first.', 'warn');
    if (!ctx.wallet.hasExtension()) return ctx.toast('Real send needs Keplr.', 'err');
    var ok = confirm('Send EXACTLY ' + l.priceAtom + ' ATOM to the CEO address?\n\nTo: ' + state.ceoAddress + '\nMemo (must be exact): ' + l.id + '\n\nYou will review this in your wallet before signing. The CEO moves "' + l.heroName + '" to you after verifying, then sends the seller ' + l.sellerAmount + ' ATOM.');
    if (!ok) return;
    try {
      ctx.toast('Waiting for your wallet signature… Check Keplr.', '');
      var sent = await ctx.wallet.sendAtom({ toAddress: state.ceoAddress, amountAtom: l.priceAtom, memo: l.id });
      ctx.toast('Sent! TX: ' + sent.txhash.slice(0, 16) + '… Submitting order…', 'ok');
      var r = await ctx.api('/api/buy', 'POST', { listingId: l.id, buyerAddress: ctx.wallet.address, txid: sent.txhash, amountAtom: l.priceAtom, memo: l.id });
      if (window.engineBus) window.engineBus.emit('marketplace:order_pending', r.sale);
      ctx.toast('Order pending CEO check. Closes in ' + state.orderTtlMinutes + ' min if not completed.', 'ok');
      await ctx.refreshState(); render(el, ctx);
    } catch (e) { ctx.toast('Send failed: ' + e.message, 'err'); }
  }
  async function manualSubmit(listingId, ctx, el) {
    var state = ctx.state;
    var l = (state.listings || []).find(function (x) { return x.id === listingId; });
    if (!l) return ctx.toast('Listing not found. Refresh.', 'err');
    var txid = prompt('Paste the TX hash of your send to the CEO address (' + l.priceAtom + ' ATOM, memo ' + l.id + '):');
    if (!txid) return;
    try {
      var r = await ctx.api('/api/buy', 'POST', { listingId: l.id, buyerAddress: ctx.wallet.address, txid: txid.trim(), amountAtom: l.priceAtom, memo: l.id });
      ctx.toast('Order pending CEO check.', 'ok');
      await ctx.refreshState(); render(el, ctx);
    } catch (e) { ctx.toast(e.message, 'err'); }
  }
  global.MarketplaceUI = { render: render, buyFlow: buyFlow };
})(typeof window !== 'undefined' ? window : globalThis);

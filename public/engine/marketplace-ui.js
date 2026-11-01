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
  function sparklineSvg(prices) {
    if (!prices || prices.length < 2) return '';
    var w = 100, h = 28, pad = 3;
    var min = Math.min.apply(null, prices), max = Math.max.apply(null, prices);
    var span = (max - min) || 1;
    var pts = prices.map(function (pv, i) {
      var x = pad + (w - 2 * pad) * (prices.length === 1 ? 0.5 : i / (prices.length - 1));
      var y = h - pad - (h - 2 * pad) * ((pv - min) / span);
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    return '<svg class="spark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true"><polyline points="' + pts + '" fill="none" stroke="#7bdff2" stroke-width="2"/></svg>';
  }
  function historyLine(hist, defId) {
    var sales = (hist && hist[defId]) || [];
    if (!sales.length) return '<span class="muted small">No sales yet</span>';
    var prices = sales.map(function (x) { return x.priceAtom; });
    var last = prices[prices.length - 1];
    var avg = prices.reduce(function (a, b) { return a + b; }, 0) / prices.length;
    return sparklineSvg(prices) + ' <span class="small">Last ' + last + ' ATOM &middot; avg ' + avg.toFixed(2) + ' &middot; ' + sales.length + ' sale' + (sales.length > 1 ? 's' : '') + '</span>';
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
    var hist = {};
    try { var hr = await ctx.api('/api/marketplace/history'); hist = hr.history || {}; } catch (e) { hist = {}; }
    var defByHero = {};
    (state.heroes || []).forEach(function (h) { defByHero[h.id] = h.defId; });
    var listedHeroIds = {};
    (state.listings || []).forEach(function (l) { listedHeroIds[l.heroId] = true; });
    var rentalHeroIds = {};
    (state.rentals || []).forEach(function (r) { if (r.status === 'available' || r.status === 'pending' || r.status === 'active') rentalHeroIds[r.heroId] = true; });
    var fee = state.feePercent;
    var ceo = state.ceoAddress;
    el.innerHTML = '<p>CEO fee <strong>' + fee + '%</strong> · CEO address <code>' + ctx.esc(ceo) + '</code> · Orders close after <strong>' + state.orderTtlMinutes + ' min</strong> if not completed.</p>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px"><button id="mkRefresh">↻ Refresh</button><input id="mkSearch" placeholder="Search heroes…" style="width:170px" value="' + ctx.esc(mkQ) + '"><select id="mkRarity" style="width:auto"><option value="">All rarities</option>' + rarities.map(function (r) { return '<option' + (mkRarity === r ? ' selected' : '') + '>' + ctx.esc(r) + '</option>'; }).join('') + '</select><select id="mkSort" style="width:auto"><option value="price-asc"' + (mkSort === 'price-asc' ? ' selected' : '') + '>Price ↑</option><option value="price-desc"' + (mkSort === 'price-desc' ? ' selected' : '') + '>Price ↓</option><option value="level"' + (mkSort === 'level' ? ' selected' : '') + '>Level</option><option value="name"' + (mkSort === 'name' ? ' selected' : '') + '>Name</option></select><span class="muted small">Send EXACTLY the full price. Memo must be exactly the listing ID.</span></div>'
      + '<h4>For sale</h4>'
      + (listings.length ? '<div class="listingGrid">' + listings.map(function (l) {
        return '<div class="listing"><h4>' + ctx.esc(l.heroName) + ' <span class="pill">' + ctx.esc(l.rarity) + '</span></h4>'
          + '<div class="price">' + l.priceAtom + ' ATOM</div>'
          + '<p class="small">Seller gets ' + l.sellerAmount + ' · CEO fee ' + l.ceoFee + ' (' + l.feePercent + '%)<br>Seller: <code>' + ctx.esc(ctx.shortAddr(l.sellerAddress)) + '</code> · Hero Lv ' + l.level + '</p>'
          + '<p class="small">Price history: ' + historyLine(hist, defByHero[l.heroId]) + '</p>'
          + (l.acceptedOfferBuyer ? '<p class="small">Accepted offer: ' + l.priceAtom + ' ATOM reserved for <code>' + ctx.esc(ctx.shortAddr(l.acceptedOfferBuyer)) + '</code>' + (l.acceptedOfferBuyer === me ? ' (you)' : '') + '</p>' : '')
          + '<button class="primary" data-buy="' + l.id + '">Buy with Keplr — send ' + l.priceAtom + ' ATOM</button> '
          + '<button class="ghost" data-manual="' + l.id + '">I already sent — submit TXID</button>'
          + ((me && l.sellerAddress !== me && !l.acceptedOfferBuyer) ? ' <button class="ghost" data-offer="' + l.id + '">Make offer (below list)</button>' : '') + '</div>';
      }).join('') + '</div>' : '<p class="muted">Nothing for sale right now. List a hero below.</p>')
      + '<h4 style="margin-top:18px">My orders</h4>'
      + (myOrders.length ? '<table><tr><th>Order</th><th>Hero</th><th>Price</th><th>Status</th><th>Closes in</th><th>TX</th></tr>' + myOrders.map(function (s) {
        return '<tr><td class="mono small">' + ctx.esc(s.id) + '</td><td>' + ctx.esc(s.heroName) + '</td><td>' + s.priceAtom + ' ATOM</td><td><span class="pill ' + s.status + '">' + s.status + '</span></td><td><span class="timer" data-expires="' + (s.secondsLeft || 0) + '" data-now="' + Date.now() + '">' + fmtLeft(s.secondsLeft || 0) + '</span></td><td><a href="' + ctx.config.explorerTxUrl + s.txid + '" target="_blank" rel="noopener">Explorer</a></td></tr>';
      }).join('') + '</table>' : '<p class="muted small">No orders yet.</p>')
      + '<h4 style="margin-top:18px">My offers</h4>'
      + (function () {
        var myOffers = (state.offers || []).filter(function (o) { return me && (o.buyerAddress === me || o.sellerAddress === me); }).slice().reverse();
        if (!myOffers.length) return '<p class="muted small">No offers yet. Make an offer below the list price on any listing.</p>';
        return '<table><tr><th>Hero</th><th>Offer</th><th>Status</th><th>Action</th></tr>' + myOffers.map(function (o) {
          var canRespond = o.status === 'pending' && o.sellerAddress === me;
          return '<tr><td>' + ctx.esc(o.heroName) + '</td><td>' + o.amountAtom + ' ATOM</td><td><span class="pill ' + o.status + '">' + o.status + '</span></td><td>' + (canRespond ? '<button class="ghost" data-accept-offer="' + o.id + '">Accept</button> <button class="ghost" data-decline-offer="' + o.id + '">Decline</button>' : '<span class="small muted">' + (o.status === 'accepted' ? 'Reserved for the buyer at this price — they complete the normal CEO-escrow buy.' : o.buyerAddress === me ? 'Waiting on the seller.' : '') + '</span>') + '</td></tr>';
        }).join('') + '</table>';
      })()
      + '<h4 style="margin-top:18px">Hero rentals — time-boxed loans, CEO escrow</h4>'
      + (function () {
        var avail = (state.rentals || []).filter(function (r) { return r.status === 'available'; });
        var mine = (state.rentals || []).filter(function (r) { return me && (r.ownerAddress === me || r.renterAddress === me); }).slice().reverse();
        var out = '';
        out += avail.length ? '<div class="listingGrid">' + avail.map(function (r) {
          return '<div class="listing"><h4>' + ctx.esc(r.heroName) + ' <span class="pill">rental</span></h4><div class="price">' + r.priceAtom + ' ATOM / ' + r.days + ' day' + (r.days > 1 ? 's' : '') + '</div><p class="small">Owner gets ' + r.sellerAmount + ' &middot; CEO fee ' + r.ceoFee + '<br>Owner: <code>' + ctx.esc(ctx.shortAddr(r.ownerAddress)) + '</code></p><button class="primary" data-rent="' + r.id + '">Rent with Keplr — send ' + r.priceAtom + ' ATOM</button> <button class="ghost" data-manual-rent="' + r.id + '">I already sent — submit TXID</button></div>';
        }).join('') + '</div>' : '<p class="muted small">No heroes for rent right now.</p>';
        out += mine.length ? '<table style="margin-top:10px"><tr><th>Hero</th><th>Price / days</th><th>Status</th><th>Role</th><th>Ends</th></tr>' + mine.map(function (r) {
          return '<tr><td>' + ctx.esc(r.heroName) + '</td><td>' + r.priceAtom + ' ATOM / ' + r.days + 'd</td><td><span class="pill ' + r.status + '">' + r.status + '</span></td><td class="small">' + (r.ownerAddress === me ? 'Owner' : 'Renter') + '</td><td class="small">' + (r.endsAtIso ? ctx.esc(r.endsAtIso.slice(0, 10)) : (r.status === 'active' ? r.daysLeft + 'd left' : '—')) + '</td></tr>';
        }).join('') + '</table><p class="small muted">Active loans return automatically when the time ends — the hero goes back to its owner.</p>' : '';
        return out;
      })()
      + '<h4 style="margin-top:18px">Rent out a hero</h4>'
      + (function () {
        var eligible = myHeroes.filter(function (h) { return !listedHeroIds[h.id] && !rentalHeroIds[h.id] && !h.rentedTo; });
        if (!eligible.length) return '<p class="muted small">No eligible heroes: a hero cannot be rented while listed for sale, already rented, or on loan.</p>';
        return '<label>Hero</label><select id="mkRentHero">' + eligible.map(function (h) { return '<option value="' + h.id + '">' + ctx.esc(h.name) + ' — Lv ' + h.level + '</option>'; }).join('') + '</select><label>Total price for the loan (ATOM)</label><input id="mkRentPrice" type="number" min="0.000001" step="0.000001" placeholder="e.g. 3"><label>Days (1–30)</label><input id="mkRentDays" type="number" min="1" max="30" value="7"><p class="small muted">The renter sends the full price to the CEO address (memo = rental ID). The CEO verifies, starts the loan, and sends you the price minus the ' + fee + '% fee. The hero returns automatically.</p><button id="mkRentBtn" class="primary">Offer hero for rent</button>';
      })()
      + '<h4 style="margin-top:18px">List a hero for sale</h4>'
      + (myHeroes.length ? '<label>Hero</label><select id="mkHero">' + myHeroes.map(function (h) { return '<option value="' + h.id + '">' + ctx.esc(h.name) + ' — Lv ' + h.level + '</option>'; }).join('') + '</select><label>Price (ATOM)</label><input id="mkPrice" type="number" min="0.000001" step="0.000001" placeholder="e.g. 10"><p class="small muted" id="mkPreview"></p><button id="mkList" class="primary">List hero</button>' : '<p class="muted small">You own no heroes yet. Claim a hero from the sidebar (unlocks by level).</p>')
      + '<h4 style="margin-top:18px">Bulk list — several heroes at once</h4>'
      + (function () {
        var bulkHeroes = myHeroes.filter(function (h) { return !listedHeroIds[h.id] && !rentalHeroIds[h.id] && !h.rentedTo; });
        if (!bulkHeroes.length) return '<p class="muted small">No heroes available for bulk listing.</p>';
        return bulkHeroes.map(function (h) {
          return '<label class="checkRow" style="display:flex;gap:8px;align-items:center"><input type="checkbox" style="width:auto" data-bulk-hero="' + h.id + '"> ' + ctx.esc(h.name) + ' — Lv ' + h.level + ' <input type="number" min="0.000001" step="0.000001" placeholder="Price ATOM" style="width:130px" data-bulk-price="' + h.id + '"></label>';
        }).join('') + '<button id="mkBulkList" class="primary">List selected heroes</button>';
      })()
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
    el.querySelectorAll('[data-offer]').forEach(function (btn) {
      btn.addEventListener('click', function () { makeOffer(btn.getAttribute('data-offer'), ctx, el); });
    });
    el.querySelectorAll('[data-accept-offer]').forEach(function (btn) {
      btn.addEventListener('click', function () { respondOffer(btn.getAttribute('data-accept-offer'), true, ctx, el); });
    });
    el.querySelectorAll('[data-decline-offer]').forEach(function (btn) {
      btn.addEventListener('click', function () { respondOffer(btn.getAttribute('data-decline-offer'), false, ctx, el); });
    });
    el.querySelectorAll('[data-rent]').forEach(function (btn) {
      btn.addEventListener('click', function () { rentFlow(btn.getAttribute('data-rent'), ctx, el); });
    });
    el.querySelectorAll('[data-manual-rent]').forEach(function (btn) {
      btn.addEventListener('click', function () { manualRentSubmit(btn.getAttribute('data-manual-rent'), ctx, el); });
    });
    var rentBtn = el.querySelector('#mkRentBtn');
    if (rentBtn) rentBtn.addEventListener('click', async function () {
      if (!me) return ctx.toast('Connect your wallet first.', 'warn');
      try { var rr = await ctx.api('/api/marketplace/rentals', 'POST', { heroId: el.querySelector('#mkRentHero').value, ownerAddress: me, priceAtom: Number(el.querySelector('#mkRentPrice').value), days: Number(el.querySelector('#mkRentDays').value) }); ctx.toast('Rental offered: ' + rr.rental.heroName + ' for ' + rr.rental.priceAtom + ' ATOM / ' + rr.rental.days + ' days.', 'ok'); await ctx.refreshState(); render(el, ctx); } catch (e) { ctx.toast(e.message, 'err'); }
    });
    var bulkBtn = el.querySelector('#mkBulkList');
    if (bulkBtn) bulkBtn.addEventListener('click', async function () {
      if (!me) return ctx.toast('Connect your wallet first.', 'warn');
      var items = [];
      el.querySelectorAll('[data-bulk-hero]').forEach(function (cb) {
        if (!cb.checked) return;
        var hid = cb.getAttribute('data-bulk-hero');
        var inp = el.querySelector('[data-bulk-price="' + hid + '"]');
        items.push({ heroId: hid, priceAtom: Number(inp ? inp.value : 0) });
      });
      if (!items.length) return ctx.toast('Tick at least one hero and set its price.', 'warn');
      try { var br = await ctx.api('/api/listings/bulk', 'POST', { address: me, sellerAddress: me, items: items }); ctx.toast('Listed ' + br.listings.length + ' heroes in one batch.', 'ok'); await ctx.refreshState(); render(el, ctx); } catch (e) { ctx.toast(e.message, 'err'); }
    });
  }
  async function makeOffer(listingId, ctx, el) {
    var l = (ctx.state.listings || []).find(function (x) { return x.id === listingId; });
    if (!l) return ctx.toast('Listing not found. Refresh.', 'err');
    if (!ctx.wallet || !ctx.wallet.address) return ctx.toast('Connect your wallet first.', 'warn');
    var v = prompt('Offer below the list price of ' + l.priceAtom + ' ATOM for "' + l.heroName + '" (ATOM):');
    if (!v) return;
    try {
      await ctx.api('/api/marketplace/offers', 'POST', { listingId: l.id, buyerAddress: ctx.wallet.address, amountAtom: Number(v) });
      ctx.toast('Offer sent. The seller can accept or decline it.', 'ok');
      await ctx.refreshState(); render(el, ctx);
    } catch (e) { ctx.toast(e.message, 'err'); }
  }
  async function respondOffer(offerId, accept, ctx, el) {
    if (!ctx.wallet || !ctx.wallet.address) return ctx.toast('Connect your wallet first.', 'warn');
    try {
      var r = await ctx.api('/api/marketplace/offers/respond', 'POST', { offerId: offerId, sellerAddress: ctx.wallet.address, accept: accept });
      ctx.toast(accept ? 'Offer accepted — reserved for the buyer at ' + r.listing.priceAtom + ' ATOM. They complete the normal CEO-escrow buy.' : 'Offer declined.', 'ok');
      await ctx.refreshState(); render(el, ctx);
    } catch (e) { ctx.toast(e.message, 'err'); }
  }
  async function rentFlow(rentalId, ctx, el) {
    var r = (ctx.state.rentals || []).find(function (x) { return x.id === rentalId; });
    if (!r) return ctx.toast('Rental not found. Refresh.', 'err');
    if (!ctx.wallet || !ctx.wallet.address) return ctx.toast('Connect your wallet first.', 'warn');
    if (!ctx.wallet.hasExtension()) return ctx.toast('Real send needs Keplr.', 'err');
    var ok = confirm('Rent "' + r.heroName + '" for ' + r.days + ' day(s)? Send EXACTLY ' + r.priceAtom + ' ATOM to the CEO address.\n\nTo: ' + ctx.state.ceoAddress + '\nMemo (must be exact): ' + r.id + '\n\nThe CEO verifies, starts the loan, and sends the owner ' + r.sellerAmount + ' ATOM. The hero returns automatically when the loan ends.');
    if (!ok) return;
    try {
      ctx.toast('Waiting for your wallet signature… Check Keplr.', '');
      var sent = await ctx.wallet.sendAtom({ toAddress: ctx.state.ceoAddress, amountAtom: r.priceAtom, memo: r.id });
      var res = await ctx.api('/api/marketplace/rentals/request', 'POST', { rentalId: r.id, renterAddress: ctx.wallet.address, txid: sent.txhash, amountAtom: r.priceAtom, memo: r.id });
      ctx.toast('Rental pending CEO check. Closes in ' + ctx.state.orderTtlMinutes + ' min if not completed.', 'ok');
      await ctx.refreshState(); render(el, ctx);
    } catch (e) { ctx.toast('Send failed: ' + e.message, 'err'); }
  }
  async function manualRentSubmit(rentalId, ctx, el) {
    var r = (ctx.state.rentals || []).find(function (x) { return x.id === rentalId; });
    if (!r) return ctx.toast('Rental not found. Refresh.', 'err');
    var txid = prompt('Paste the TX hash of your send to the CEO address (' + r.priceAtom + ' ATOM, memo ' + r.id + '):');
    if (!txid) return;
    try {
      await ctx.api('/api/marketplace/rentals/request', 'POST', { rentalId: r.id, renterAddress: ctx.wallet.address, txid: txid.trim(), amountAtom: r.priceAtom, memo: r.id });
      ctx.toast('Rental pending CEO check.', 'ok');
      await ctx.refreshState(); render(el, ctx);
    } catch (e) { ctx.toast(e.message, 'err'); }
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
  global.MarketplaceUI = { render: render, buyFlow: buyFlow, sparklineSvg: sparklineSvg };
})(typeof window !== 'undefined' ? window : globalThis);

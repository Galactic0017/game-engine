/* WalletManager — global wallet identity for the whole Engine Hub.
 *
 * One wallet, every game. The address, name and ATOM balance live here and
 * are shared with every loaded game module through the event bus; no game
 * ever talks to Keplr/Leap directly.
 *
 * Supported providers: Keplr (window.keplr) and Leap (window.leap).
 * Chain: Cosmos Hub (cosmoshub-4). No seed phrase is ever requested:
 * connect only reads the address/key, and CEO actions use signArbitrary
 * (ADR-36) — the same non-custodial model as Swap.
 *
 * Balance is read-only REST against the LCD endpoints published by
 * /api/config (lcdUrls). If every LCD is unreachable the balance is
 * reported as null, never as 0 — 0 would be a lie.
 *
 * Real wallets only: Keplr or Leap, chosen explicitly. No demo
 * address entry. The chosen provider is captured at connect time and
 * reused for every signing call, so a second installed wallet can
 * never hijack a session.
 */
(function (global) {
  'use strict';

  var STORAGE_PROVIDER = 'game_provider';
  var STORAGE_PROVIDER = 'game_provider';
  var STORAGE_PROVIDER = 'game_provider';
  var STORAGE_ADDRESS = 'game_address';
  var STORAGE_NAME = 'game_name';
  var LEGACY_ADDRESS = 'voidfall_address';
  var LEGACY_NAME = 'voidfall_name';

  function canonicalJson(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
    return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + canonicalJson(v[k]); }).join(',') + '}';
  }

  function isAddress(a) { return typeof a === 'string' && /^cosmos1[0-9a-z]{38,45}$/.test(a); }

  function WalletManager(bus, config) {
    this.bus = bus;
    this.config = config || {};
    this.chainId = this.config.chainId || 'cosmoshub-4';
    this.provider = null;       // 'keplr' | 'leap' | null
    this.address = null;
    this.name = 'Player';
    this.balanceUatom = null;   // string of uatom, or null when unknown
    this._balanceTimer = null;
    this._ext = null;           // captured extension {kind, api} from connect()
    this._ext = null;           // captured extension {kind, api} from connect()
    this._ext = null;           // captured extension {kind, api} from connect()
  }

  WalletManager.prototype._extension = function (kind) {
    if (kind === 'keplr' && global.keplr) return { kind: 'keplr', api: global.keplr };
    if (kind === 'leap' && global.leap) return { kind: 'leap', api: global.leap };
    if (kind) return null;
    if (global.keplr) return { kind: 'keplr', api: global.keplr };
    if (global.leap) return { kind: 'leap', api: global.leap };
    return null;
  };

  WalletManager.prototype.availableProviders = function () {
    var out = [];
    if (global.keplr) out.push('keplr');
    if (global.leap) out.push('leap');
    return out;
  };

  WalletManager.prototype.hasExtension = function () { return !!this._extension(); };

  WalletManager.prototype.connect = async function (kind) {
    var ext = this._extension(kind);
    if (!ext) throw new Error(kind ? ('No ' + kind + ' wallet extension found. Install ' + kind + ' on desktop.') : 'No wallet extension found. Install Keplr or Leap on desktop.');
    this._ext = ext;
    await ext.api.enable(this.chainId);
    var key = await ext.api.getKey(this.chainId);
    if (!key || !isAddress(key.bech32Address)) throw new Error('Wallet returned an invalid Cosmos address.');
    this.provider = ext.kind;
    this.address = key.bech32Address;
    this.name = key.name || 'Player';
    this._persist();
    await this.refreshBalance();
    this.bus.emit('wallet:connected', this.address, this.balanceUatom);
    return { address: this.address, name: this.name, provider: this.provider, balanceUatom: this.balanceUatom };
  };

  WalletManager.prototype.restore = function () {
    try {
      var addr = global.localStorage && (global.localStorage.getItem(STORAGE_ADDRESS) || global.localStorage.getItem(LEGACY_ADDRESS));
      if (addr && isAddress(addr)) {
        this.provider = (global.localStorage.getItem(STORAGE_PROVIDER) || null);
        this.address = addr;
        this.name = (global.localStorage.getItem(STORAGE_NAME) || global.localStorage.getItem(LEGACY_NAME)) || 'Player';
        this.refreshBalance();
        this.bus.emit('wallet:connected', this.address, this.balanceUatom);
        return true;
      }
    } catch (e) { /* storage unavailable: stay disconnected */ }
    return false;
  };

  WalletManager.prototype.disconnect = function () {
    this.provider = null;
    this._ext = null;
    this.address = null;
    this.balanceUatom = null;
    try { if (global.localStorage) { global.localStorage.removeItem(STORAGE_ADDRESS); global.localStorage.removeItem(STORAGE_NAME); global.localStorage.removeItem(STORAGE_PROVIDER); } } catch (e) {}
    this.stopBalancePolling();
    this.bus.emit('wallet:disconnected');
  };

  WalletManager.prototype._persist = function () {
    try {
      if (global.localStorage) {
        global.localStorage.setItem(STORAGE_ADDRESS, this.address);
        global.localStorage.setItem(STORAGE_NAME, this.name);
        if (this.provider) global.localStorage.setItem(STORAGE_PROVIDER, this.provider);
      }
    } catch (e) {}
  };

  // Read-only balance: GET {lcd}/cosmos/bank/v1beta1/balances/{address}
  // Tries each configured LCD in order; null on total failure.
  WalletManager.prototype.refreshBalance = async function () {
    if (!this.address) { this.balanceUatom = null; return null; }
    var urls = this.config.lcdUrls || [];
    for (var i = 0; i < urls.length; i++) {
      try {
        var res = await fetch(urls[i] + '/cosmos/bank/v1beta1/balances/' + this.address);
        if (!res.ok) continue;
        var json = await res.json();
        var entry = (json.balances || []).find(function (b) { return b.denom === 'uatom'; });
        this.balanceUatom = entry ? String(entry.amount) : '0';
        this.bus.emit('wallet:balance', this.address, this.balanceUatom);
        return this.balanceUatom;
      } catch (e) { /* try next LCD */ }
    }
    this.balanceUatom = null;
    return null;
  };

  WalletManager.prototype.startBalancePolling = function (ms) {
    var self = this;
    this.stopBalancePolling();
    this._balanceTimer = setInterval(function () { self.refreshBalance(); }, ms || 60000);
  };

  WalletManager.prototype.stopBalancePolling = function () {
    if (this._balanceTimer) { clearInterval(this._balanceTimer); this._balanceTimer = null; }
  };

  WalletManager.prototype.balanceAtom = function () {
    if (this.balanceUatom === null) return null;
    return (Number(this.balanceUatom) / 1e6).toFixed(6).replace(/\.?0+$/, '') || '0';
  };

  // CEO proof-of-ownership: sign an arbitrary message with the connected
  // key (ADR-36). The server verifies the signature and that the signer
  // is CEO_ADDRESS. Every CEO action signs its own message.
  WalletManager.prototype.ceoSign = async function (message) {
    if (!this.address) throw new Error('CEO sign-in needs a real wallet connected with the CEO address.');
    var ext = this._ext || this._extension(this.provider);
    if (!ext) throw new Error('Keplr / Leap not found.');
    await ext.api.enable(this.chainId);
    var key = await ext.api.getKey(this.chainId);
    var ceo = this.config.ceoAddress;
    if (ceo && key.bech32Address !== ceo) throw new Error('This wallet is not the CEO address. Connected: ' + key.bech32Address);
    this.address = key.bech32Address;
    var sig = await ext.api.signArbitrary(this.chainId, key.bech32Address, message);
    var pubkey = sig.pub_key && sig.pub_key.value ? sig.pub_key.value : null;
    if (!pubkey) throw new Error('Wallet did not return a public key.');
    return { signature: sig.signature, pubkey: pubkey, address: key.bech32Address };
  };

  // Sign any game-result hash with the connected key (anti-cheat binding).
  WalletManager.prototype.signMessage = async function (message) {
    if (!this.address) return null;
    var ext = this._ext || this._extension(this.provider);
    if (!ext) return null;
    await ext.api.enable(this.chainId);
    var key = await ext.api.getKey(this.chainId);
    var sig = await ext.api.signArbitrary(this.chainId, key.bech32Address, message);
    var pubkey = sig.pub_key && sig.pub_key.value ? sig.pub_key.value : null;
    if (!pubkey) return null;
    return { signature: sig.signature, pubkey: pubkey, address: key.bech32Address };
  };

  // Real send: Amino StdTx via the extension (signAmino + sendTx).
  // The user reviews the exact recipient, amount and memo in their own
  // wallet before signing. NOT tested with a real wallet in this build
  // environment — test with a tiny amount on desktop Keplr/Leap first.
  // Returns { txhash, amountAtom, toAddress, memo }.
  WalletManager.prototype.sendAtom = async function (opts) {
    var o = opts || {};
    var toAddress = o.toAddress, amountAtom = Number(o.amountAtom), memo = String(o.memo || '');
    if (!isAddress(toAddress)) throw new Error('Need a valid recipient Cosmos address.');
    if (!isFinite(amountAtom) || amountAtom <= 0) throw new Error('Amount must be > 0 ATOM.');
    var uatom = String(Math.round(amountAtom * 1e6));
    if (uatom === '0') throw new Error('Amount is too small (rounds to 0 uatom).');
    if (!this.address) throw new Error('Connect a real wallet (Keplr/Leap) to send ATOM.');
    var ext = this._ext || this._extension(this.provider);
    if (!ext) throw new Error('Keplr / Leap not found.');
    await ext.api.enable(this.chainId);
    var key = await ext.api.getKey(this.chainId);
    var from = key.bech32Address;
    this.address = from;
    // Balance check (read-only): warn loudly if balance looks short.
    await this.refreshBalance();
    var feeUatom = String(o.feeUatom || 5000);
    if (this.balanceUatom !== null && BigInt(this.balanceUatom) < BigInt(uatom) + BigInt(feeUatom)) {
      throw new Error('Balance looks too low: need ' + amountAtom + ' ATOM + fee. Balance: ' + this.balanceAtom() + ' ATOM.');
    }
    // Account number + sequence from LCD (needed for the sign doc).
    var accountNumber = '0', sequence = '0', gotAccount = false;
    var urls = this.config.lcdUrls || [];
    for (var i = 0; i < urls.length && !gotAccount; i++) {
      try {
        var res = await fetch(urls[i] + '/cosmos/auth/v1beta1/accounts/' + from);
        if (!res.ok) continue;
        var json = await res.json();
        var acc = json.account || {};
        var inner = acc.value || acc;
        if (inner.account_number !== undefined) { accountNumber = String(inner.account_number); sequence = String(inner.sequence); gotAccount = true; }
      } catch (e) { /* try next LCD */ }
    }
    if (!gotAccount) throw new Error('Could not read your account from the chain (LCD unreachable). Try again — nothing was signed.');
    var signDoc = {
      chain_id: this.chainId,
      account_number: accountNumber,
      sequence: sequence,
      fee: { amount: [{ denom: 'uatom', amount: feeUatom }], gas: String(o.gas || 200000) },
      memo: memo,
      msgs: [{ type: 'cosmos-sdk/MsgSend', value: { from_address: from, to_address: toAddress, amount: [{ denom: 'uatom', amount: uatom }] } }]
    };
    var signed = await ext.api.signAmino(this.chainId, from, signDoc);
    var stdTx = signed.signed || signed;
    var sig = signed.signature || (stdTx.signatures && stdTx.signatures[0]);
    if (!sig) throw new Error('Wallet did not return a signature.');
    var tx = { msg: stdTx.msgs || stdTx.msg, fee: stdTx.fee, memo: stdTx.memo, signatures: [sig] };
    var result = await ext.api.sendTx(this.chainId, tx, 'sync');
    var txhash = typeof result === 'string' ? result : (result && (result.txhash || result.transactionHash));
    if (!txhash) throw new Error('Wallet did not return a transaction hash.');
    this.refreshBalance();
    return { txhash: txhash, amountAtom: amountAtom, toAddress: toAddress, memo: memo, from: from };
  };

  WalletManager.prototype.canonicalJson = canonicalJson;
  WalletManager.prototype.isAddress = isAddress;

  global.WalletManager = WalletManager;
})(typeof window !== 'undefined' ? window : globalThis);

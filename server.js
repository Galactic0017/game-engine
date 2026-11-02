// GAME — game.atomstaking.app — Engine Hub server.
// Model (user-confirmed, no contracts): real wallet connect (Keplr only).
// Buyer sends the FULL price in one ATOM send to the CEO address, memo =
// listing ID. CEO verifies the TX, moves the item ID to the buyer, then
// sends the seller their cut (price minus CEO fee) from the CEO wallet.
// No smart contract is deployed or used. All on-chain moves are plain
// bank sends the user signs in their own wallet — nothing moves without
// their keys, like Swap.
// CEO panel auth: Keplr signArbitrary (ADR-36) per action, like Swap.
// Storage: JSON file locally; in-memory on Vercel (read-only filesystem).
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PORT = parseInt(process.env.PORT || '3000', 10);
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const CEO_SESSION_TTL_MS = 5 * 60 * 1000;
// --- ADR-36 / secp256k1 verification (zero dependencies, Node crypto) ---
const SECP_P = (1n << 256n) - (1n << 32n) - 977n;
function modPow(base, exp, mod) { let r = 1n; base %= mod; while (exp > 0n) { if (exp & 1n) r = (r * base) % mod; base = (base * base) % mod; exp >>= 1n; } return r; }
function bytesToBigInt(bytes) { return BigInt('0x' + Buffer.from(bytes).toString('hex')); }
function bigIntToBytes(n, len) { let h = n.toString(16).padStart(len * 2, '0'); return Buffer.from(h, 'hex'); }
function decompressPubkey(pub) {
  if (pub.length !== 33 || (pub[0] !== 0x02 && pub[0] !== 0x03)) throw new Error('bad pubkey');
  const x = bytesToBigInt(pub.slice(1));
  const y2 = (modPow(x, 3n, SECP_P) + 7n) % SECP_P;
  let y = modPow(y2, (SECP_P + 1n) / 4n, SECP_P);
  if ((y % 2n === 0n) !== (pub[0] === 0x02)) y = SECP_P - y;
  if ((y * y) % SECP_P !== y2) throw new Error('bad pubkey point');
  return { x: bigIntToBytes(x, 32), y: bigIntToBytes(y, 32) };
}
const BECH32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
function bech32Polymod(values) { const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]; let chk = 1; for (const v of values) { const b = chk >> 25; chk = ((chk & 0x1ffffff) << 5) ^ v; for (let i = 0; i < 5; i++) if ((b >> i) & 1) chk ^= GEN[i]; } return chk; }
function bech32HrpExpand(hrp) { const r = []; for (const c of hrp) r.push(c.charCodeAt(0) >> 5); r.push(0); for (const c of hrp) r.push(c.charCodeAt(0) & 31); return r; }
function convertBits(data, from, to, pad) { let acc = 0, bits = 0; const out = [], maxv = (1 << to) - 1; for (const v of data) { acc = (acc << from) | v; bits += from; while (bits >= to) { bits -= to; out.push((acc >> bits) & maxv); } } if (pad) { if (bits) out.push((acc << (to - bits)) & maxv); } else if (bits >= from || ((acc << (to - bits)) & maxv)) return null; return out; }
function bech32Encode(hrp, data5) { const values = bech32HrpExpand(hrp).concat(data5); const pm = bech32Polymod(values.concat([0, 0, 0, 0, 0, 0])) ^ 1; const chk = []; for (let i = 0; i < 6; i++) chk.push((pm >> (5 * (5 - i))) & 31); return hrp + '1' + data5.concat(chk).map(i => BECH32[i]).join(''); }
function addressFromPubkey(pub) { const h1 = crypto.createHash('sha256').update(pub).digest(); const h2 = crypto.createHash('ripemd160').update(h1).digest(); const d5 = convertBits([...h2], 8, 5, true); return bech32Encode('cosmos', d5); }
function canonicalJson(v) { if (v === null || typeof v !== 'object') return JSON.stringify(v); if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']'; return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}'; }
function rawSigToDer(raw) { if (raw.length !== 64) throw new Error('bad signature length'); const r = raw.slice(0, 32), s = raw.slice(32); const strip = b => { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; return b.slice(i); }; const enc = b => { let x = strip(b); if (x[0] & 0x80) x = Buffer.concat([Buffer.from([0]), x]); return Buffer.concat([Buffer.from([0x02, x.length]), x]); }; const rb = enc(r), sb = enc(s); return Buffer.concat([Buffer.from([0x30, rb.length + sb.length]), rb, sb]); }
function verifyAdr36(address, message, signatureB64, pubkeyB64) {
  try {
    const pub = Buffer.from(pubkeyB64, 'base64'); const sig = Buffer.from(signatureB64, 'base64');
    if (addressFromPubkey(pub) !== address) return false;
    const { x, y } = decompressPubkey(pub);
    const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'secp256k1', x: x.toString('base64url'), y: y.toString('base64url') }, format: 'jwk' });
    const doc = { chain_id: '', account_number: '0', sequence: '0', fee: { gas: '0', amount: [] }, memo: '', msgs: [{ type: 'sign/MsgSignData', value: { signer: address, data: Buffer.from(message, 'utf8').toString('base64') } }] };
    const hash = crypto.createHash('sha256').update(canonicalJson(doc), 'utf8').digest();
    return crypto.verify(null, hash, key, rawSigToDer(sig));
  } catch { return false; }
}
// A CEO admin request must carry a fresh ADR-36 signature over
// "<path>\n<canonical body>\n<timestamp>" (5 min window, binds the action).
function isCeoRequest(req, bodyForMessage) {
  if (ADMIN_KEY && req.headers['x-admin-key'] === ADMIN_KEY) return true;
  const address = req.headers['x-ceo-address'], sig = req.headers['x-ceo-signature'], pub = req.headers['x-ceo-pubkey'], ts = Number(req.headers['x-ceo-timestamp']);
  if (!address || !sig || !pub || !isFinite(ts)) return false;
  if (address !== CEO_ADDRESS) return false;
  if (Math.abs(Date.now() - ts) > CEO_SESSION_TTL_MS) return false;
  const u = new URL(req.url, 'http://x');
  const effPath = (u.pathname === '/api/index' && u.searchParams.get('__path')) ? u.searchParams.get('__path') : u.pathname;
  const message = effPath + '\n' + canonicalJson(bodyForMessage || {}) + '\n' + String(ts);
  return verifyAdr36(address, message, sig, pub);
}
const VERSION = '3.38.0';
const BUILD_DATE = '2026-11-01';
/* Batch 20: honest feature count — read once from the same
 * public/features.json the server serves, so /api/config can never
 * drift from the file. Falls back to null (not a guess) if the
 * file is unreadable. */
let TOTAL_FEATURES = null;
try { const _f = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'features.json'), 'utf8')); if (Array.isArray(_f.features)) TOTAL_FEATURES = _f.features.length; } catch (e) { TOTAL_FEATURES = null; }
const MODE = (process.env.MODE || 'live').toLowerCase();
const EXPLORER = process.env.EXPLORER_TX_URL || 'https://www.mintscan.io/cosmos/txs/';
const CHAIN_ID = process.env.CHAIN_ID || 'cosmoshub-4';
let ENV_FEE = parseFloat(process.env.FEE_PERCENT || '5');
if (!isFinite(ENV_FEE)) ENV_FEE = 5;
ENV_FEE = Math.min(7, Math.max(4, ENV_FEE));
let ORDER_TTL_MINUTES = parseFloat(process.env.ORDER_TTL_MINUTES || '30');
if (!isFinite(ORDER_TTL_MINUTES) || ORDER_TTL_MINUTES < 1) ORDER_TTL_MINUTES = 30;
if (ORDER_TTL_MINUTES > 1440) ORDER_TTL_MINUTES = 1440;
// CEO address provided by the user (2026-11-01, bech32 checksum verified).
// Env override wins; this default is a public receiving address, not a secret.
const CEO_ADDRESS = process.env.CEO_ADDRESS || 'cosmos1pyp3wd7dsa7zmu7ges2dar2e6lk77lfa9qchlm';
const LCD_URLS = (process.env.LCD_URLS || 'https://rest.cosmos.directory/cosmoshub,https://cosmos-lcd.publicnode.com,https://lcd-cosmoshub.keplr.app').split(',').map(s => s.trim()).filter(Boolean);
const WS_URL = process.env.WS_URL || 'wss://rpc.cosmos.network/websocket';
const IS_VERCEL = !!process.env.VERCEL;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
if (!IS_VERCEL) { try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {} }
const HERO_DEFS = [
  { id: 'astra', name: 'Astra, Validator Prime', rarity: 'Legendary', basePower: 45, ability: 'Nova Burst: big area damage', color: '#ffd166', unlockLevel: 15, tagline: 'The last validator of the fallen chain.' },
  { id: 'lyra', name: 'Lyra, Ion Warden', rarity: 'Epic', basePower: 32, ability: 'Ion Slow: slows enemies in range', color: '#7bdff2', unlockLevel: 12, tagline: 'She holds the ion gate alone.' },
  { id: 'koda', name: 'Koda, Orbital Guardian', rarity: 'Rare', basePower: 26, ability: 'Shield: blocks one wave leak', color: '#90ee90', unlockLevel: 5, tagline: 'Built from a dead satellite, loyal to the end.' },
  { id: 'nova7', name: 'Nova-7, Railgun Ace', rarity: 'Epic', basePower: 38, ability: 'Rail Shot: long-range pierce', color: '#ff8fab', unlockLevel: 8, tagline: 'One shot. One orbit. No misses.' },
  { id: 'vex', name: 'Vex, Void Stalker', rarity: 'Rare', basePower: 24, ability: 'Void Strike: bonus vs bosses', color: '#c792ea', unlockLevel: 3, tagline: 'He hunts what the void sends back.' },
  { id: 'orin', name: 'Orin, Cosmos Keeper', rarity: 'Common', basePower: 16, ability: 'Keeper Aura: +10% tower damage nearby', color: '#e0e0e0', unlockLevel: 1, tagline: 'Every keeper starts somewhere.' },
];
const UNLOCK = Object.fromEntries(HERO_DEFS.map(d => [d.id, d.unlockLevel]));
const SKIN_DEFS = [
  { id: 'gold-trim', name: 'Gold Trim', cost: 500, color: '#ffd166', desc: 'Golden frame on your hero portrait.' },
  { id: 'void-glow', name: 'Void Glow', cost: 800, color: '#c792ea', desc: 'Purple void glow behind your hero.' },
  { id: 'ion-aura', name: 'Ion Aura', cost: 1200, color: '#7bdff2', desc: 'Cyan ion aura in game and profile.' },
];
const MAX_XP_PER_WAVE = 200;
// Batch 17: cross-game currency — 100 banked clicker shards convert to
// 10 in-game credits. Fixed rate, capped per call, ledger-recorded.
// In-game credits only; this never moves ATOM or touches the escrow model.
const SHARD_CONVERSION = { shardsPerChunk: 100, creditsPerChunk: 10, minShards: 100, maxShards: 5000 };
const MIN_WAVE_GAP_MS = 10000;
const QUEST_DEFS = [
  { id: 'pops150', name: 'Pop 150 balloons', target: 150, stat: 'pops', reward: 150 },
  { id: 'wave10', name: 'Clear wave 10', target: 10, stat: 'waves', reward: 200 },
  { id: 'duel1', name: 'Win a duel', target: 1, stat: 'duelsWon', reward: 150 },
];
const ACHIEVEMENT_DEFS = [
  { id: 'first-wave', name: 'First Wave', desc: 'Clear your first wave.', test: p => (p.totalWaves || 0) >= 1, reward: 50 },
  { id: 'wave-10', name: 'Wave 10 Hero', desc: 'Reach wave 10.', test: p => (p.bestWave || 0) >= 10, reward: 150 },
  { id: 'wave-25', name: 'Wave 25 Veteran', desc: 'Reach wave 25.', test: p => (p.bestWave || 0) >= 25, reward: 250 },
  { id: 'wave-50', name: 'Wave 50 Legend', desc: 'Clear all 50 waves.', test: p => (p.bestWave || 0) >= 50, reward: 500 },
  { id: 'pops-1000', name: 'Popper', desc: 'Pop 1,000 balloons total.', test: p => (p.totalPops || 0) >= 1000, reward: 200 },
  { id: 'pops-10000', name: 'Balloon Annihilator', desc: 'Pop 10,000 balloons total.', test: p => (p.totalPops || 0) >= 10000, reward: 500 },
  { id: 'duel-win', name: 'Duel Winner', desc: 'Win a duel.', test: p => (p.wins || 0) >= 1, reward: 150 },
  { id: 'lister', name: 'Trader', desc: 'List a hero for sale.', test: p => (p.listingsCreated || 0) >= 1, reward: 100 },
  { id: 'seller', name: 'Sold!', desc: 'Complete a sale as seller.', test: p => (p.salesClosed || 0) >= 1, reward: 200 },
  { id: 'level-5', name: 'Level 5', desc: 'Reach level 5.', test: p => levelForXp(p.xp || 0) >= 5, reward: 150 },
  { id: 'level-10', name: 'Level 10', desc: 'Reach level 10.', test: p => levelForXp(p.xp || 0) >= 10, reward: 300 },
  { id: 'level-20', name: 'Max Level', desc: 'Reach level 20.', test: p => levelForXp(p.xp || 0) >= 20, reward: 500 },
];
function questDayStr() { return new Date().toISOString().slice(0, 10); }
function ensureQuests(pl) {
  if (!pl.questProgress) pl.questProgress = { pops: 0, waves: 0, duelsWon: 0 };
  if (!pl.questClaimed) pl.questClaimed = [];
  if (pl.questDay !== questDayStr()) { pl.questDay = questDayStr(); pl.questProgress = { pops: 0, waves: 0, duelsWon: 0 }; pl.questClaimed = []; }
  return pl;
}
function questStatus(pl) {
  ensureQuests(pl);
  return QUEST_DEFS.map(q => ({ id: q.id, name: q.name, target: q.target, reward: q.reward, progress: Math.min(q.target, pl.questProgress[q.stat] || 0), done: (pl.questProgress[q.stat] || 0) >= q.target, claimed: pl.questClaimed.includes(q.id) }));
}
function checkAchievements(pl) {
  if (!pl.achievements) pl.achievements = [];
  const unlocked = [];
  for (const a of ACHIEVEMENT_DEFS) {
    if (!pl.achievements.includes(a.id) && a.test(pl)) { pl.achievements.push(a.id); pl.credits = (pl.credits || 0) + a.reward; unlocked.push({ id: a.id, name: a.name, reward: a.reward }); }
  }
  return unlocked;
}
function uid(p) { return p + '_' + crypto.randomBytes(6).toString('hex'); }
function isAddress(a) { return typeof a === 'string' && /^cosmos1[0-9a-z]{38,45}$/.test(a); }
function isTxid(t) { return typeof t === 'string' && /^[0-9a-fA-F]{64}$/.test(t); }
function round6(n) { return Math.round(n * 1e6) / 1e6; }
function levelForXp(xp) { return Math.min(20, 1 + Math.floor((xp || 0) / 400)); }
function feePercent() { const f = parseFloat(db.settings && db.settings.feePercent); return isFinite(f) ? Math.min(7, Math.max(4, f)) : ENV_FEE; }
function orderTtlMinutes() { const t = parseFloat(db.settings && db.settings.orderTtlMinutes); return isFinite(t) ? Math.min(1440, Math.max(1, t)) : ORDER_TTL_MINUTES; }
function autoVerifyEnabled() { return !!(db.settings && db.settings.autoVerifyEnabled); }
function load() {
  const base = { players: {}, heroes: [], listings: [], sales: [], offers: [], rentals: [], saleHistory: [], usedTxids: [], duels: [], bans: {}, ledger: [], flags: [], sessions: {}, auditLog: [], announcements: [], scheduledAnnouncements: [], settings: { feePercent: ENV_FEE, orderTtlMinutes: ORDER_TTL_MINUTES, autoVerifyEnabled: false } };
  if (IS_VERCEL) return base;
  try {
    const d = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (d && typeof d === 'object') return { ...base, ...d, settings: { ...base.settings, ...(d.settings || {}) }, bans: d.bans || {}, sessions: d.sessions || {} };
  } catch {}
  return base;
}
function save(db) { if (IS_VERCEL) return; try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); } catch {} }
let db = load();
function addLedger(kind, data) {
  const entry = { id: uid('led'), ts: new Date().toISOString(), kind, ...(data || {}) };
  db.ledger.push(entry);
  if (db.ledger.length > 5000) db.ledger = db.ledger.slice(-5000);
  return entry;
}
function addAudit(action, data) {
  db.auditLog.push({ id: uid('aud'), ts: new Date().toISOString(), action, ...(data || {}) });
  if (db.auditLog.length > 2000) db.auditLog = db.auditLog.slice(-2000);
}
function addFlag(type, data) {
  const flag = { id: uid('flag'), ts: new Date().toISOString(), type, resolved: false, ...(data || {}) };
  db.flags.push(flag);
  return flag;
}
function isBanned(address) { return !!(address && db.bans && db.bans[address]); }
// Pending orders close themselves when the timer runs out: listing
// re-opens, sale is marked expired, ledger records it. Runs on every
// request so no background job is needed (also safe on Vercel).
function expireSweep() {
  const now = Date.now(); let changed = false;
  for (const s of db.sales) {
    if (s.status === 'pending' && s.expiresAt && now > s.expiresAt) {
      s.status = 'expired'; s.closedAt = new Date().toISOString(); changed = true;
      const l = db.listings.find(x => x.id === s.listingId);
      if (l && l.status === 'reserved') l.status = 'active';
      if (l) restoreListingOffer(l);
      addLedger('order_expired', { saleId: s.id, listingId: s.listingId, heroId: s.heroId, heroName: s.heroName, priceAtom: s.priceAtom, buyerAddress: s.buyerAddress, sellerAddress: s.sellerAddress });
    }
  }
  if (changed) save(db);
  return changed;
}
function saleView(s) {
  const now = Date.now();
  return { ...s, secondsLeft: s.status === 'pending' && s.expiresAt ? Math.max(0, Math.round((s.expiresAt - now) / 1000)) : 0, txidMasked: s.txid ? s.txid.slice(0, 10) + '…' + s.txid.slice(-6) : '' };
}
function send(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }
function readBody(req) { return new Promise((resolve) => { let s = ''; req.on('data', c => s += c); req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { resolve({}); } }); }); }
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon' };
function leaderboard(gameId) { return Object.values(db.players).map(p => ({ address: p.address, name: p.name, level: levelForXp(p.xp || 0), xp: p.xp || 0, bestScore: gameId ? ((p.bests && p.bests[gameId]) || 0) : (p.bestScore || 0), bestWave: p.bestWave || 0, totalPops: p.totalPops || 0, wins: p.wins || 0, losses: p.losses || 0, games: p.gamesPlayed || 0, heroes: db.heroes.filter(h => h.owner === p.address).length, banned: isBanned(p.address) })).sort((a, b) => b.bestScore - a.bestScore || b.level - a.level); }

// --- Batch 11: seasons + referrals + duel views (additive, no money model change) ---
function seasonKey(d) { return (d || new Date()).toISOString().slice(0, 7); }
function previousSeasonKey() { var d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return seasonKey(d); }
function referralCodeFor(address) { return 'GAME-' + String(address || '').slice(6, 14).toUpperCase(); }
function playerByReferralCode(code) {
  if (typeof code !== 'string') return null;
  var c = code.trim().toUpperCase();
  return Object.values(db.players).find(function (p) { return referralCodeFor(p.address) === c; }) || null;
}
function recordSeasonBest(pl, gameId, score) {
  pl.seasonBests = pl.seasonBests || {};
  var k = seasonKey(); pl.seasonBests[k] = pl.seasonBests[k] || {};
  if (score > (pl.seasonBests[k][gameId] || 0)) pl.seasonBests[k][gameId] = score;
}
function seasonLeaderboard(gameId, season) {
  var gid = gameId || 'cosmos-btd';
  return Object.values(db.players).map(function (p) {
    var sb = (((p.seasonBests || {})[season] || {})[gid]) || 0;
    return { address: p.address, name: p.name, level: levelForXp(p.xp || 0), xp: p.xp || 0, bestScore: sb, seasonBest: sb, bestWave: p.bestWave || 0, totalPops: p.totalPops || 0, wins: p.wins || 0, losses: p.losses || 0, games: p.gamesPlayed || 0, heroes: db.heroes.filter(function (h) { return h.owner === p.address; }).length, banned: isBanned(p.address) };
  }).filter(function (r) { return r.seasonBest > 0; }).sort(function (a, b) { return b.seasonBest - a.seasonBest || b.level - a.level; });
}
function seasonTop3(season, gameId) {
  return seasonLeaderboard(gameId, season).slice(0, 3).map(function (r, i) { return { rank: i + 1, address: r.address, name: r.name, seasonBest: r.seasonBest }; });
}
function duelView(d) {
  var c = db.players[d.challenger] || {}, r = db.players[d.rival] || {};
  var live = d.status === 'live' && d.expiresAt;
  return Object.assign({}, d, {
    challengerName: c.name || null, rivalName: r.name || null,
    seed: d.seed || 0, entryFee: d.entryFee || 0, raceSeconds: d.raceSeconds || DUEL_RACE_SECONDS,
    liveScores: d.liveScores || { challenger: 0, rival: 0 },
    liveWaves: d.liveWaves || { challenger: 0, rival: 0 },
    feePaid: !!d.feePaid, pot: d.pot || 0,
    secondsLeft: live ? Math.max(0, Math.round((d.expiresAt - Date.now()) / 1000)) : 0,
  });
}
// --- Batch 18: PvP duels II — live score race, credits-only entry fee,
// duel history + rematch. In-game credits only; this never moves ATOM
// and never touches the CEO-escrow marketplace model. The entry fee is
// held in the players' own credit balances (deducted at race start,
// paid out at finish) — no on-chain escrow, no contract. ---
const DUEL_ENTRY_FEES = [0, 50, 100, 250];
const DUEL_RACE_SECONDS = 600;
const DUEL_RAKE_PERCENT = 10;
function duelSeedFor() { return 1 + crypto.randomInt(2147483646); }
function duelScores(d) { return d.liveScores || { challenger: 0, rival: 0 }; }
function duelWaves(d) { return d.liveWaves || { challenger: 0, rival: 0 }; }
function duelLeader(d) {
  var s = duelScores(d);
  if (s.challenger > s.rival) return 'challenger';
  if (s.rival > s.challenger) return 'rival';
  var w = duelWaves(d);
  if (w.challenger > w.rival) return 'challenger';
  if (w.rival > w.challenger) return 'rival';
  return 'tie';
}
function duelLiveView(d) {
  var v = duelView(d);
  v.leader = d.status === 'live' ? duelLeader(d) : null;
  return v;
}
// Decide a live duel exactly once. Winner takes most of the pot
// (90%, 10% rake removed from circulation and ledger-recorded); a
// draw refunds both entry fees. Both players' bests/season bests
// update from their live scores. Returns the winner address or null.
function finishLiveDuel(d, reason) {
  if (!d || d.status !== 'live') return null;
  var cs = duelScores(d).challenger, rs = duelScores(d).rival;
  var cw = duelWaves(d).challenger, rw = duelWaves(d).rival;
  var winner = null, isDraw = false;
  if (cs > rs || (cs === rs && cw > rw)) winner = d.challenger;
  else if (rs > cs || (cs === rs && rw > cw)) winner = d.rival;
  else isDraw = true;
  d.status = isDraw ? 'draw' : (winner === d.challenger ? 'challenger_won' : 'challenger_lost');
  d.winner = winner; d.score = cs; d.rivalScore = rs;
  d.decidedAt = new Date().toISOString(); d.finishReason = reason || 'finished';
  var cp = db.players[d.challenger], rp = db.players[d.rival];
  var creditSide = function (pl, score, wave) {
    if (!pl) return;
    pl.gamesPlayed = (pl.gamesPlayed || 0) + 1;
    if (score > (pl.bestScore || 0)) pl.bestScore = score;
    pl.bests = pl.bests || {};
    if (score > (pl.bests['cosmos-btd'] || 0)) pl.bests['cosmos-btd'] = score;
    recordSeasonBest(pl, 'cosmos-btd', score);
    if (wave > (pl.bestWave || 0)) pl.bestWave = wave;
  };
  creditSide(cp, cs, cw); creditSide(rp, rs, rw);
  var achUnlocked = [];
  if (d.feePaid && d.entryFee > 0) {
    if (isDraw) {
      if (cp) cp.credits = (cp.credits || 0) + d.entryFee;
      if (rp) rp.credits = (rp.credits || 0) + d.entryFee;
      d.payout = 0; d.refund = d.entryFee;
      addLedger('duel_draw_refund', { duelId: d.id, challenger: d.challenger, rival: d.rival, entryFee: d.entryFee, refundEach: d.entryFee });
    } else {
      var pot = d.pot || (2 * d.entryFee);
      var share = Math.floor(pot * (100 - DUEL_RAKE_PERCENT) / 100);
      var rake = pot - share;
      var wp = winner === d.challenger ? cp : rp;
      if (wp) wp.credits = (wp.credits || 0) + share;
      d.payout = share; d.rake = rake;
      addLedger('duel_payout', { duelId: d.id, winner, entryFee: d.entryFee, pot, payout: share, rake });
    }
  }
  if (isDraw) {
    if (cp) cp.xp = (cp.xp || 0) + 20;
    if (rp) rp.xp = (rp.xp || 0) + 20;
  } else {
    var wp2 = winner === d.challenger ? cp : rp;
    var lp = winner === d.challenger ? rp : cp;
    if (wp2) { wp2.wins = (wp2.wins || 0) + 1; wp2.xp = (wp2.xp || 0) + 100; ensureQuests(wp2); wp2.questProgress.duelsWon = (wp2.questProgress.duelsWon || 0) + 1; achUnlocked = checkAchievements(wp2); }
    if (lp) { lp.losses = (lp.losses || 0) + 1; lp.xp = (lp.xp || 0) + 20; }
  }
  save(db);
  return { winner, isDraw, achievementsUnlocked: achUnlocked };
}
function expireLiveDuels() {
  var now = Date.now(), changed = false;
  for (var i = 0; i < db.duels.length; i++) {
    var d = db.duels[i];
    if (d.status === 'live' && d.expiresAt && now > d.expiresAt) { finishLiveDuel(d, 'expired'); changed = true; }
  }
  return changed;
}
function duelHistoryView(d, addr) {
  var v = duelView(d);
  var mineIsChallenger = d.challenger === addr;
  var outcome = d.status === 'draw' ? 'draw' : d.status === 'declined' ? 'declined'
    : ((d.status === 'challenger_won') === mineIsChallenger ? 'won' : 'lost');
  return Object.assign(v, {
    opponent: mineIsChallenger ? d.rival : d.challenger,
    opponentName: mineIsChallenger ? v.rivalName : v.challengerName,
    outcome,
    myScore: mineIsChallenger ? (d.score != null ? d.score : duelScores(d).challenger) : (d.rivalScore != null ? d.rivalScore : duelScores(d).rival),
    opponentScore: mineIsChallenger ? (d.rivalScore != null ? d.rivalScore : duelScores(d).rival) : (d.score != null ? d.score : duelScores(d).challenger),
  });
}
// --- On-chain TX lookup (LCD REST). Notification/verification aid only:
// the server never moves ATOM and never holds keys. Fail closed: any
// fetch/parse failure returns found:false and the caller must not approve.
function fetchJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs || 8000 }, (res) => {
      let s = '';
      res.on('data', c => s += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(s) }); } catch (e) { reject(new Error('bad json')); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}
async function fetchTx(hash) {
  for (const base of LCD_URLS) {
    try {
      const { status, json } = await fetchJson(base.replace(/\/$/, '') + '/cosmos/tx/v1beta1/txs/' + hash);
      if (status === 404) return { found: false, code: null, memo: null, sends: [], raw: json };
      if (status !== 200 || !json || !json.tx) continue;
      const tx = json.tx, resp = json.tx_response || {};
      const sends = [];
      for (const m of (tx.body && tx.body.messages) || []) {
        if (m['@type'] === '/cosmos.bank.v1beta1.MsgSend' || m.type === 'cosmos-sdk/MsgSend') {
          const v = m.value || m;
          sends.push({ from: v.from_address, to: v.to_address, amount: v.amount || [] });
        }
      }
      // Fallback: transfer events in logs carry the same facts.
      if (!sends.length && Array.isArray(resp.logs)) {
        for (const log of resp.logs) {
          for (const ev of (log.events || [])) {
            if (ev.type === 'transfer') {
              const get = k => { const a = (ev.attributes || []).find(x => x.key === k); return a ? a.value : ''; };
              sends.push({ from: get('sender'), to: get('recipient'), amount: get('amount').split(',').map(p => { const mm = p.match(/^(\d+)([a-z0-9]+)$/); return mm ? { denom: mm[2], amount: mm[1] } : null; }).filter(Boolean) });
            }
          }
        }
      }
      return { found: true, code: resp.code, memo: (tx.body && tx.body.memo) || '', sends, height: resp.height };
    } catch { /* try next LCD */ }
  }
  return { found: false, code: null, memo: null, sends: [], error: 'LCD unreachable or TX not found' };
}
// 5 checks for the CEO-escrow payment: exists, code 0, sender = buyer,
// recipient = CEO address, amount = full price in uatom, memo = listing ID.
async function validateBuyerTx(sale) {
  const tx = await fetchTx(sale.txid);
  const expectedUatom = String(Math.round(sale.priceAtom * 1e6));
  const send = tx.sends.find(s => s.to === CEO_ADDRESS) || tx.sends[0];
  const amountOk = !!send && (send.amount || []).some(a => a.denom === 'uatom' && String(a.amount) === expectedUatom);
  const checks = [
    { name: 'tx_exists', ok: tx.found, detail: tx.found ? 'Found on chain' : (tx.error || 'Not found') },
    { name: 'tx_success', ok: tx.found && tx.code === 0, detail: 'code=' + tx.code },
    { name: 'sender_is_buyer', ok: !!send && send.from === sale.buyerAddress, detail: send ? send.from : 'no send found' },
    { name: 'recipient_is_ceo', ok: !!send && send.to === CEO_ADDRESS, detail: send ? send.to : 'no send found' },
    { name: 'amount_and_memo', ok: amountOk && tx.memo === sale.listingId, detail: 'amount ' + (amountOk ? 'OK' : 'expected ' + expectedUatom + 'uatom') + ', memo ' + (tx.memo === sale.listingId ? 'OK' : 'mismatch') },
  ];
  return { verified: checks.every(c => c.ok), checks, tx };
}
function moveHeroToBuyer(sale) {
  const hero = db.heroes.find(h => h.id === sale.heroId);
  if (!hero) return null;
  hero.owner = sale.buyerAddress;
  return hero;
}
function closeListing(sale) { const l = db.listings.find(x => x.id === sale.listingId); if (l) l.status = 'closed'; }


// --- Batch 12: marketplace depth (offers, rentals, price history, bulk list) ---
// All money still moves the CEO-escrow way: one full-price send to the CEO
// address, memo = listing/rental ID; the CEO verifies, moves the hero or
// starts the loan, then sends the seller/owner their cut after the fee.
function ensureMarketplaceArrays() {
  db.offers = db.offers || []; db.rentals = db.rentals || []; db.saleHistory = db.saleHistory || [];
}
function priceHistoryByDef() {
  ensureMarketplaceArrays();
  const out = {};
  for (const h of db.saleHistory) { (out[h.defId] = out[h.defId] || []).push(h); }
  for (const k of Object.keys(out)) out[k] = out[k].slice(-10);
  return out;
}
function recordSaleHistory(sale) {
  ensureMarketplaceArrays();
  if (db.saleHistory.some(h => h.saleId === sale.id)) return;
  const hero = db.heroes.find(h => h.id === sale.heroId);
  db.saleHistory.push({ saleId: sale.id, heroId: sale.heroId, defId: hero ? hero.defId : null, heroName: sale.heroName, priceAtom: sale.priceAtom, ceoFee: sale.ceoFee, sellerAmount: sale.sellerAmount, buyerAddress: sale.buyerAddress, sellerAddress: sale.sellerAddress, closedAt: sale.decidedAt || sale.closedAt || new Date().toISOString() });
  if (db.saleHistory.length > 200) db.saleHistory = db.saleHistory.slice(-200);
}
function restoreListingOffer(listing) {
  if (!listing || !listing.acceptedOfferId) return;
  ensureMarketplaceArrays();
  const offer = db.offers.find(o => o.id === listing.acceptedOfferId);
  if (offer && offer.status === 'accepted') offer.status = 'expired';
  if (listing.originalPriceAtom != null) { const fp = feePercent(); listing.priceAtom = listing.originalPriceAtom; const feeAmt = round6(listing.priceAtom * fp / 100); listing.sellerAmount = round6(listing.priceAtom - feeAmt); listing.ceoFee = feeAmt; listing.feePercent = fp; }
  delete listing.originalPriceAtom; delete listing.acceptedOfferId; delete listing.acceptedOfferBuyer; delete listing.offerExpiresAt;
}
function expireOfferSweep() {
  ensureMarketplaceArrays();
  const now = Date.now(); let changed = false;
  for (const l of db.listings) {
    if (l.status === 'active' && l.offerExpiresAt && now > l.offerExpiresAt) { restoreListingOffer(l); changed = true; addLedger('offer_expired', { listingId: l.id, heroId: l.heroId, heroName: l.heroName }); }
  }
  if (changed) save(db);
}
function rentalSweep() {
  ensureMarketplaceArrays();
  const now = Date.now(); let changed = false;
  for (const r of db.rentals) {
    if (r.status === 'active' && r.endsAt && now > r.endsAt) {
      r.status = 'returned'; r.returnedAt = new Date().toISOString(); changed = true;
      const hero = db.heroes.find(h => h.id === r.heroId);
      if (hero && hero.rentalId === r.id) { delete hero.rentedTo; delete hero.rentalId; delete hero.rentalEndsAt; }
      addLedger('rental_returned', { rentalId: r.id, heroId: r.heroId, heroName: r.heroName, ownerAddress: r.ownerAddress, renterAddress: r.renterAddress });
    }
    if (r.status === 'pending' && r.expiresAt && now > r.expiresAt) {
      r.status = 'expired'; changed = true;
      addLedger('rental_expired', { rentalId: r.id, heroId: r.heroId, heroName: r.heroName });
    }
  }
  if (changed) save(db);
}
function rentalView(r) { const now = Date.now(); return { ...r, secondsLeft: r.status === 'pending' && r.expiresAt ? Math.max(0, Math.round((r.expiresAt - now) / 1000)) : 0, daysLeft: r.status === 'active' && r.endsAt ? Math.max(0, Math.ceil((r.endsAt - now) / 86400000)) : 0 }; }
function createListing(hero, ownerAddress, sellerAddress, price) {
  const feeAmt = round6(price * feePercent() / 100);
  const listing = { id: uid('list'), heroId: hero.id, heroName: hero.name, rarity: hero.rarity, level: hero.level, priceAtom: price, sellerAmount: round6(price - feeAmt), ceoFee: feeAmt, feePercent: feePercent(), ceoAddress: CEO_ADDRESS, sellerAddress, sellerName: (db.players[ownerAddress] || {}).name || 'Seller', status: 'active', createdAt: new Date().toISOString() };
  db.listings.push(listing);
  const sellerPl = db.players[ownerAddress]; if (sellerPl) { sellerPl.listingsCreated = (sellerPl.listingsCreated || 0) + 1; checkAchievements(sellerPl); }
  addLedger('listing_created', { listingId: listing.id, heroId: hero.id, heroName: hero.name, priceAtom: price, sellerAddress: listing.sellerAddress });
  return listing;
}
async function validateRentalTx(rental) {
  const tx = await fetchTx(rental.txid);
  const expectedUatom = String(Math.round(rental.priceAtom * 1e6));
  const sendTx = tx.sends.find(x => x.to === CEO_ADDRESS) || tx.sends[0];
  const amountOk = !!sendTx && (sendTx.amount || []).some(a => a.denom === 'uatom' && String(a.amount) === expectedUatom);
  const checks = [
    { name: 'tx_exists', ok: tx.found, detail: tx.found ? 'Found on chain' : (tx.error || 'Not found') },
    { name: 'tx_success', ok: tx.found && tx.code === 0, detail: 'code=' + tx.code },
    { name: 'sender_is_renter', ok: !!sendTx && sendTx.from === rental.renterAddress, detail: sendTx ? sendTx.from : 'no send found' },
    { name: 'recipient_is_ceo', ok: !!sendTx && sendTx.to === CEO_ADDRESS, detail: sendTx ? sendTx.to : 'no send found' },
    { name: 'amount_and_memo', ok: amountOk && tx.memo === rental.id, detail: 'amount ' + (amountOk ? 'OK' : 'expected ' + expectedUatom + 'uatom') + ', memo ' + (tx.memo === rental.id ? 'OK' : 'mismatch') },
  ];
  return { verified: checks.every(c => c.ok), checks, tx };
}

// --- Batch 13: CEO tools II (disputes, fee analytics, scheduled announcements) ---
// A dispute is a review marker on a sale record plus a matching
// anti-cheat flag. It changes nothing about expiry or the escrow money
// model: the order still closes on its timer and only the existing
// approve/execute/reject paths move heroes or record payouts.
function ensureScheduled() { db.scheduledAnnouncements = db.scheduledAnnouncements || []; }
// Scheduled posts publish when due. On Vercel there is no background
// job, so this sweep runs on every request (same pattern as the order
// expiry sweep); the standalone server also runs it on a 60s timer.
function publishDueAnnouncements() {
  ensureScheduled();
  const now = Date.now(); let changed = false;
  db.announcements = db.announcements || [];
  for (const s of db.scheduledAnnouncements) {
    if (s.status === 'scheduled' && s.publishAt && now >= s.publishAt) {
      s.status = 'published'; s.publishedAt = new Date().toISOString(); changed = true;
      db.announcements.unshift({ id: uid('ann'), title: s.title, body: s.body, at: s.publishedAt, by: CEO_ADDRESS, scheduled: true });
      db.announcements = db.announcements.slice(0, 10);
      addLedger('announcement_published', { title: s.title, scheduledId: s.id });
      addAudit('announce-scheduled', { title: s.title, scheduledId: s.id });
    }
  }
  if (changed) save(db);
  return changed;
}
// Fees/volume by UTC day from closed sales and started rentals only.
// Pending/expired orders contribute nothing until the CEO closes them.
function feeAnalytics(days) {
  const n = Math.min(90, Math.max(1, parseInt(days, 10) || 14));
  const out = [];
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) { const d = new Date(today.getTime() - i * 86400000); out.push({ date: d.toISOString().slice(0, 10), volume: 0, fees: 0, orders: 0, rentals: 0, payouts: 0 }); }
  const byDay = {}; out.forEach(d => { byDay[d.date] = d; });
  const bucket = (iso, fn) => { if (!iso) return; const b = byDay[String(iso).slice(0, 10)]; if (b) fn(b); };
  for (const s of db.sales) {
    if (s.status === 'closed' || s.status === 'approved') {
      bucket(s.closedAt || s.decidedAt, b => { b.volume = round6(b.volume + (s.priceAtom || 0)); b.fees = round6(b.fees + (s.ceoFee || 0)); b.orders += 1; });
      if (s.sellerPayout && s.sellerPayout.status === 'paid') bucket(s.closedAt || s.decidedAt, b => { b.payouts = round6(b.payouts + (s.sellerPayout.amount || 0)); });
    }
  }
  ensureMarketplaceArrays();
  for (const r of db.rentals) {
    if ((r.status === 'active' || r.status === 'returned') && r.startsAt) {
      bucket(r.startsAt, b => { b.volume = round6(b.volume + (r.priceAtom || 0)); b.fees = round6(b.fees + (r.ceoFee || 0)); b.rentals += 1; });
      if (r.sellerPayout && r.sellerPayout.status === 'paid') bucket(r.startsAt, b => { b.payouts = round6(b.payouts + (r.sellerPayout.amount || 0)); });
    }
  }
  const totals = out.reduce((a, d) => ({ volume: round6(a.volume + d.volume), fees: round6(a.fees + d.fees), orders: a.orders + d.orders, rentals: a.rentals + d.rentals, payouts: round6(a.payouts + d.payouts) }), { volume: 0, fees: 0, orders: 0, rentals: 0, payouts: 0 });
  return { days: out, totals, windowDays: n };
}

async function handle(req, res) {
  const u = new URL(req.url, 'http://x'); let p = u.pathname;
  if (p === '/api/index' && u.searchParams.get('__path')) p = u.searchParams.get('__path');
  ensureMarketplaceArrays();
  expireSweep(); expireOfferSweep(); rentalSweep(); expireLiveDuels(); publishDueAnnouncements();
  const fee = feePercent(), ttl = orderTtlMinutes();
  if (p === '/api/health') return send(res, 200, { ok: true, version: VERSION, buildDate: BUILD_DATE, platform: 'GAME', time: new Date().toISOString(), players: Object.keys(db.players).length, listings: db.listings.filter(l => l.status === 'active').length, pendingOrders: db.sales.filter(s => s.status === 'pending').length });
  const shooterPlayable = fs.existsSync(path.join(__dirname, 'public', 'games', 'space-shooter', 'shooter.js'));
  const minerPlayable = fs.existsSync(path.join(__dirname, 'public', 'games', 'asteroid-miner', 'miner.js'));
  if (p === '/api/config') return send(res, 200, { version: VERSION, buildDate: BUILD_DATE, totalFeatures: TOTAL_FEATURES, mode: MODE, chainId: CHAIN_ID, explorerTxUrl: EXPLORER, walletConnect: true, realWalletSend: true, noContracts: true, escrowModel: 'ceo-escrow', feePercent: fee, orderTtlMinutes: ttl, shardConversion: SHARD_CONVERSION, duels: { entryFees: DUEL_ENTRY_FEES, raceSeconds: DUEL_RACE_SECONDS, rakePercent: DUEL_RAKE_PERCENT }, autoVerifyEnabled: autoVerifyEnabled(), ceoAddress: CEO_ADDRESS, lcdUrls: LCD_URLS, wsUrl: WS_URL, heroDefs: HERO_DEFS, skins: SKIN_DEFS, platform: 'GAME', domain: 'game.atomstaking.app', games: [{ id: 'cosmos-btd', name: 'Cosmos BTD', status: 'playable', tagline: 'Space tower defense: protect the ATOM orb. 50 waves + endless, 8 towers, heroes.', tags: ['Tower Defense', 'Space', 'Heroes', '50 Waves'] }, { id: 'space-shooter', name: 'Space Shooter', status: shooterPlayable ? 'playable' : 'coming-soon', tagline: 'Dodge asteroids, blast drones, survive the waves.', tags: ['Arcade', 'Shooter', 'Space'] }, { id: 'asteroid-miner', name: 'Asteroid Miner', status: minerPlayable ? 'playable' : 'coming-soon', tagline: 'Click/drag mining: 6 ore tiers, drill upgrades, belt progression.', tags: ['Mining', 'Clicker', 'Space'] }, { id: 'space-tycoon', name: 'Space Tycoon', status: 'playable', tagline: 'Build rigs, earn offline. Local save.', tags: ['Idle', 'Tycoon', 'Space'] }, { id: 'atom-clicker', name: 'ATOM Core Clicker', status: 'playable', tagline: 'Tap the core, earn shards. Local save.', tags: ['Clicker', 'Idle', 'ATOM'] }], unlockLevels: UNLOCK });
  if (p === '/api/state') return send(res, 200, { mode: MODE, chainId: CHAIN_ID, explorerTxUrl: EXPLORER, feePercent: fee, orderTtlMinutes: ttl, ceoAddress: CEO_ADDRESS, players: Object.values(db.players).map(x => ({ address: x.address, name: x.name, credits: x.credits || 0, xp: x.xp || 0, level: levelForXp(x.xp || 0), bestScore: x.bestScore || 0, bestWave: x.bestWave || 0, totalPops: x.totalPops || 0, achievements: (x.achievements || []).length, bests: x.bests || {}, referralCode: referralCodeFor(x.address), referralCount: (x.referrals || []).length, seasonBests: x.seasonBests || {}, banned: isBanned(x.address) })), heroes: db.heroes, listings: db.listings.filter(l => l.status === 'active'), sales: db.sales.map(saleView), offers: (db.offers || []), rentals: (db.rentals || []).map(rentalView), priceHistory: priceHistoryByDef(), announcements: (db.announcements || []).slice(0, 3), leaderboard: leaderboard() });
  if (p === '/api/leaderboard') { var _g = u.searchParams.get('game') || ''; var _s = u.searchParams.get('season') || ''; if (_s === 'current') _s = seasonKey(); var _seasonOk = /^\d{4}-\d{2}$/.test(_s); var _prev = previousSeasonKey(); return send(res, 200, { leaderboard: _seasonOk ? seasonLeaderboard(_g, _s) : leaderboard(_g), feePercent: fee, season: { key: seasonKey(), requested: _seasonOk ? _s : null, previousKey: _prev, top3: seasonTop3(_prev, _g) } }); }
  if (req.method === 'POST' && p === '/api/player') { const b = await readBody(req); if (!isAddress(b.address)) return send(res, 400, { error: 'Need a valid Cosmos address (cosmos1...). Connect Keplr.' }); if (isBanned(b.address)) return send(res, 403, { error: 'This address is banned.' }); var isNewPlayer = !db.players[b.address]; if (isNewPlayer) db.players[b.address] = { address: b.address, name: String(b.name || 'Player').slice(0, 40), credits: 1000, xp: 0, bestScore: 0, wins: 0, losses: 0, gamesPlayed: 0, skins: [], equippedSkin: null, achievements: [], questDay: '', questProgress: { pops: 0, waves: 0, duelsWon: 0 }, questClaimed: [], bestWave: 0, totalPops: 0, totalWaves: 0, listingsCreated: 0, salesClosed: 0, bests: {}, seasonBests: {}, referralCode: referralCodeFor(b.address), referredBy: null, referrals: [], createdAt: new Date().toISOString() }; else if (b.name) db.players[b.address].name = String(b.name).slice(0, 40); db.players[b.address].skins = db.players[b.address].skins || []; var _pl0 = db.players[b.address]; _pl0.referralCode = referralCodeFor(b.address); _pl0.seasonBests = _pl0.seasonBests || {}; _pl0.referrals = _pl0.referrals || []; if (isNewPlayer && b.referredBy) { var _ref = playerByReferralCode(String(b.referredBy)); if (!_ref && isAddress(String(b.referredBy))) _ref = db.players[String(b.referredBy)] || null; if (_ref && _ref.address !== b.address) { _pl0.referredBy = _ref.address; _ref.referrals = _ref.referrals || []; if (_ref.referrals.indexOf(b.address) < 0) _ref.referrals.push(b.address); } } save(db); const pl = db.players[b.address]; return send(res, 200, { player: { ...pl, level: levelForXp(pl.xp || 0) }, heroes: db.heroes.filter(h => h.owner === b.address) }); }
  if (req.method === 'POST' && p === '/api/session/start') { const b = await readBody(req); const sessionId = uid('sess'); const nonce = crypto.randomBytes(16).toString('hex'); db.sessions[sessionId] = { sessionId, address: isAddress(b.address) ? b.address : null, nonce, startedAt: Date.now(), lastWave: 0, lastWaveAt: 0, wavesSubmitted: [] }; save(db); return send(res, 200, { sessionId, nonce }); }
  if (req.method === 'POST' && p === '/api/progress') { const b = await readBody(req); const pl = db.players[b.address]; if (!pl) return send(res, 400, { error: 'Connect wallet / create player first.' }); if (isBanned(b.address)) return send(res, 403, { error: 'This address is banned.' }); const gameId = b.game === 'space-shooter' ? 'space-shooter' : b.game === 'asteroid-miner' ? 'asteroid-miner' : b.game === 'atom-clicker' ? 'atom-clicker' : b.game === 'space-tycoon' ? 'space-tycoon' : 'cosmos-btd'; const waveCap = gameId === 'cosmos-btd' ? 50 : 200; const score = Math.max(0, Math.min(100000, Number(b.score) || 0)); const wave = Math.max(0, Math.min(waveCap, Number(b.waveReached) || 0)); const won = !!b.won; const oldLevel = levelForXp(pl.xp || 0); const xpGain = wave * 40 + Math.floor(score / 20); const creditGain = wave * 20 + (won ? 100 : 0); pl.xp = (pl.xp || 0) + xpGain; pl.credits = (pl.credits || 0) + creditGain; pl.gamesPlayed = (pl.gamesPlayed || 0) + 1; pl.bests = pl.bests || {}; if (score > (pl.bests[gameId] || 0)) pl.bests[gameId] = score; recordSeasonBest(pl, gameId, score); if (gameId === 'cosmos-btd') { if (score > (pl.bestScore || 0)) pl.bestScore = score; pl.bestWave = Math.max(pl.bestWave || 0, wave); pl.totalWaves = (pl.totalWaves || 0) + 1; ensureQuests(pl); pl.questProgress.waves = Math.max(pl.questProgress.waves || 0, wave); } const achUnlocked = checkAchievements(pl); const newLevel = levelForXp(pl.xp); const unlocked = HERO_DEFS.filter(d => d.unlockLevel > oldLevel && d.unlockLevel <= newLevel).map(d => d.id); save(db); return send(res, 200, { player: { ...pl, level: newLevel }, xpGain, creditGain, unlocked, achievementsUnlocked: achUnlocked }); }
  if (req.method === 'POST' && p === '/api/progress/secure') {
    const b = await readBody(req);
    const pl = db.players[b.address]; if (!pl) return send(res, 400, { error: 'Connect wallet / create player first.' });
    if (isBanned(b.address)) return send(res, 403, { error: 'This address is banned.' });
    const sess = db.sessions[b.sessionId];
    const wave = Math.max(0, Math.min(50, Number(b.waveReached) || 0)); const score = Math.max(0, Math.min(100000, Number(b.score) || 0));
    const pops = Math.max(0, Number(b.pops) || 0); const heroXp = Math.max(0, Number(b.heroXp) || 0);
    const xpGain = wave * 40 + Math.floor(score / 20);
    // Hash must match: SHA256(sessionId:wave:pops:heroXp:nonce). A mismatch
    // means the numbers were changed after the hash was made — fail closed.
    let hashOk = false;
    if (sess) { const expect = crypto.createHash('sha256').update(sess.sessionId + ':' + wave + ':' + pops + ':' + heroXp + ':' + sess.nonce).digest('hex'); hashOk = expect === String(b.stateHash || ''); }
    const tooFast = sess && sess.lastWaveAt && (Date.now() - sess.lastWaveAt) < MIN_WAVE_GAP_MS;
    const waveJump = sess && wave > sess.lastWave + 1;
    const overCap = xpGain > MAX_XP_PER_WAVE;
    if (!hashOk || tooFast || waveJump || overCap) {
      const reasons = []; if (!hashOk) reasons.push('state hash mismatch'); if (tooFast) reasons.push('waves too fast'); if (waveJump) reasons.push('wave jump'); if (overCap) reasons.push('XP over cap');
      addFlag('secure-progress', { address: b.address, sessionId: b.sessionId, wave, score, pops, heroXp, reasons }); save(db);
      return send(res, 200, { flagged: true, credited: 0, reasons, note: 'Claim flagged for CEO audit. Nothing was credited.' });
    }
    const oldLevel = levelForXp(pl.xp || 0); const creditGain = wave * 20 + (b.won ? 100 : 0);
    pl.xp = (pl.xp || 0) + xpGain; pl.credits = (pl.credits || 0) + creditGain; pl.gamesPlayed = (pl.gamesPlayed || 0) + 1; if (score > (pl.bestScore || 0)) pl.bestScore = score;
    pl.bestWave = Math.max(pl.bestWave || 0, wave); pl.totalWaves = (pl.totalWaves || 0) + 1;
    const popsDelta = Math.max(0, pops - (sess.lastPops || 0)); pl.totalPops = (pl.totalPops || 0) + popsDelta; sess.lastPops = pops;
    pl.bests = pl.bests || {}; if (score > (pl.bests['cosmos-btd'] || 0)) pl.bests['cosmos-btd'] = score; recordSeasonBest(pl, 'cosmos-btd', score);
    ensureQuests(pl); pl.questProgress.pops = (pl.questProgress.pops || 0) + popsDelta; pl.questProgress.waves = Math.max(pl.questProgress.waves || 0, wave);
    const achUnlocked = checkAchievements(pl);
    sess.lastWave = wave; sess.lastWaveAt = Date.now(); sess.wavesSubmitted.push(wave);
    const newLevel = levelForXp(pl.xp); const unlocked = HERO_DEFS.filter(d => d.unlockLevel > oldLevel && d.unlockLevel <= newLevel).map(d => d.id);
    save(db); return send(res, 200, { flagged: false, player: { ...pl, level: newLevel }, xpGain, creditGain, unlocked, achievementsUnlocked: achUnlocked });
  }
  if (p === '/api/referral') { const addr = u.searchParams.get('address'); const pl = db.players[addr]; if (!pl) return send(res, 400, { error: 'Connect wallet / create player first.' }); var _refs = (pl.referrals || []).map(function (a) { var rp = db.players[a] || {}; return { address: a, name: rp.name || null }; }); return send(res, 200, { address: pl.address, referralCode: referralCodeFor(pl.address), referredBy: pl.referredBy || null, referrals: _refs, referralCount: _refs.length, note: 'Invites are tracked only. Referrals pay nothing.' }); }
  // Batch 17: shard conversion. The client only ever converts shards it
  // banked locally; the server cannot verify a local-save balance, so
  // the call is capped (100–5000 shards, multiple of 100) and ledgered,
  // the same trust model as the legacy /api/progress bests. In-game
  // credits only; no ATOM, no escrow change.
  if (req.method === 'POST' && p === '/api/convert-shards') { const b = await readBody(req); const pl = db.players[b.address]; if (!pl) return send(res, 400, { error: 'Connect wallet / create player first.' }); if (isBanned(b.address)) return send(res, 403, { error: 'This address is banned.' }); const shards = Number(b.shards); if (!isFinite(shards) || !Number.isInteger(shards) || shards < SHARD_CONVERSION.minShards || shards > SHARD_CONVERSION.maxShards || shards % SHARD_CONVERSION.shardsPerChunk !== 0) { if (isFinite(shards) && shards > SHARD_CONVERSION.maxShards) { addFlag('shard-convert-cap', { address: b.address, shards }); save(db); } return send(res, 400, { error: 'Shards must be a multiple of 100, between 100 and 5000 per conversion.' }); } const credits = (shards / SHARD_CONVERSION.shardsPerChunk) * SHARD_CONVERSION.creditsPerChunk; pl.credits = (pl.credits || 0) + credits; pl.shardsConverted = (pl.shardsConverted || 0) + shards; addLedger('shard_conversion', { address: pl.address, shards, credits }); save(db); return send(res, 200, { player: { ...pl, level: levelForXp(pl.xp || 0) }, shards, credits, rate: SHARD_CONVERSION }); }
  if (p === '/api/quests') { const addr = u.searchParams.get('address'); const pl = db.players[addr]; if (!pl) return send(res, 400, { error: 'Connect wallet / create player first.' }); return send(res, 200, { day: questDayStr(), quests: questStatus(pl), credits: pl.credits || 0 }); }
  if (req.method === 'POST' && p === '/api/quests/claim') { const b = await readBody(req); const pl = db.players[b.address]; if (!pl) return send(res, 400, { error: 'Connect wallet / create player first.' }); if (isBanned(b.address)) return send(res, 403, { error: 'This address is banned.' }); ensureQuests(pl); const q = QUEST_DEFS.find(x => x.id === b.questId); if (!q) return send(res, 404, { error: 'Quest not found' }); if (pl.questClaimed.includes(q.id)) return send(res, 400, { error: 'Already claimed today.' }); if ((pl.questProgress[q.stat] || 0) < q.target) return send(res, 400, { error: 'Quest not complete yet.' }); pl.questClaimed.push(q.id); pl.credits = (pl.credits || 0) + q.reward; addLedger('quest_claimed', { address: pl.address, questId: q.id, reward: q.reward }); save(db); return send(res, 200, { player: { ...pl, level: levelForXp(pl.xp || 0) }, reward: q.reward, quests: questStatus(pl) }); }
  if (p === '/api/achievements') { const addr = u.searchParams.get('address'); const pl = db.players[addr]; if (!pl) return send(res, 400, { error: 'Connect wallet / create player first.' }); if (!pl.achievements) pl.achievements = []; return send(res, 200, { achievements: ACHIEVEMENT_DEFS.map(a => ({ id: a.id, name: a.name, desc: a.desc, reward: a.reward, unlocked: pl.achievements.includes(a.id) })) }); }
  if (p === '/api/announcements') return send(res, 200, { announcements: db.announcements || [] });
  if (req.method === 'POST' && p === '/api/heroes/claim') { const b = await readBody(req); if (!isAddress(b.address) || !db.players[b.address]) return send(res, 400, { error: 'Connect wallet / create player first.' }); if (isBanned(b.address)) return send(res, 403, { error: 'This address is banned.' }); const def = HERO_DEFS.find(d => d.id === b.defId) || HERO_DEFS[5]; const lvl = levelForXp(db.players[b.address].xp || 0); if (lvl < def.unlockLevel) return send(res, 403, { error: def.name + ' unlocks at level ' + def.unlockLevel + '. You are level ' + lvl + '. Play waves to earn XP.' }); const hero = { id: uid('hero'), defId: def.id, name: def.name, rarity: def.rarity, basePower: def.basePower, ability: def.ability, color: def.color, tagline: def.tagline, level: 1, xp: 0, owner: b.address, createdAt: new Date().toISOString() }; db.heroes.push(hero); save(db); return send(res, 200, { hero }); }
  if (req.method === 'POST' && p === '/api/heroes/upgrade') { const b = await readBody(req); const hero = db.heroes.find(h => h.id === b.heroId); if (!hero) return send(res, 404, { error: 'Hero not found' }); if (hero.owner !== b.address) return send(res, 403, { error: 'You do not own this hero' }); const cost = 200 * hero.level; const pl = db.players[b.address]; if (!pl || (pl.credits || 0) < cost) return send(res, 400, { error: 'Not enough in-game credits. Cost: ' + cost }); pl.credits -= cost; hero.level += 1; hero.xp = (hero.xp || 0) + 400; save(db); return send(res, 200, { hero, credits: pl.credits }); }
  if (req.method === 'POST' && p === '/api/heroes/add-xp') { const b = await readBody(req); const hero = db.heroes.find(h => h.id === b.heroId); if (!hero) return send(res, 404, { error: 'Hero not found' }); if (hero.owner !== b.address) return send(res, 403, { error: 'You do not own this hero' }); const xp = Math.max(0, Number(b.xp) || 0); if (xp > 1000) { addFlag('hero-xp-cap', { address: b.address, heroId: hero.id, xp }); save(db); return send(res, 400, { error: 'Hero XP per claim is capped at 1000. Flagged for CEO audit.' }); } hero.xp = (hero.xp || 0) + xp; hero.level = Math.min(100, 1 + Math.floor(hero.xp / 400)); if (Number(b.pops)) hero.totalPops = (hero.totalPops || 0) + Number(b.pops); save(db); return send(res, 200, { hero }); }
  if (req.method === 'POST' && p === '/api/shop/buy-skin') { const b = await readBody(req); const pl = db.players[b.address]; if (!pl) return send(res, 400, { error: 'Connect wallet / create player first.' }); const skin = SKIN_DEFS.find(s => s.id === b.skinId); if (!skin) return send(res, 404, { error: 'Skin not found' }); pl.skins = pl.skins || []; if (pl.skins.includes(skin.id)) { pl.equippedSkin = skin.id; save(db); return send(res, 200, { player: pl, equipped: skin.id }); } if ((pl.credits || 0) < skin.cost) return send(res, 400, { error: 'Not enough credits. Cost: ' + skin.cost }); pl.credits -= skin.cost; pl.skins.push(skin.id); pl.equippedSkin = skin.id; save(db); return send(res, 200, { player: pl, equipped: skin.id }); }
  if (req.method === 'POST' && p === '/api/listings/bulk') { const b = await readBody(req); if (!isAddress(b.address) || !db.players[b.address]) return send(res, 400, { error: 'Connect wallet / create player first.' }); if (isBanned(b.address)) return send(res, 403, { error: 'This address is banned.' }); if (!Array.isArray(b.items) || !b.items.length) return send(res, 400, { error: 'items: at least one hero required.' }); if (b.items.length > 10) return send(res, 400, { error: 'Max 10 heroes per bulk list.' }); if (!isAddress(b.sellerAddress)) return send(res, 400, { error: 'Seller Cosmos address required (your connected wallet address).' }); const seen = {}; const prepared = []; for (const it of b.items) { const hero = db.heroes.find(h => h.id === it.heroId); if (!hero) return send(res, 400, { error: 'Hero not found: ' + it.heroId }); if (hero.owner !== b.address) return send(res, 403, { error: 'You do not own this hero: ' + hero.name }); if (seen[hero.id]) return send(res, 400, { error: 'Duplicate hero in batch: ' + hero.name }); seen[hero.id] = 1; if (hero.rentedTo) return send(res, 400, { error: 'Hero is rented out: ' + hero.name }); if (db.listings.some(l => l.heroId === hero.id && (l.status === 'active' || l.status === 'reserved'))) return send(res, 400, { error: 'Already listed: ' + hero.name }); const price = Number(it.priceAtom); if (!isFinite(price) || price <= 0 || price > 100000) return send(res, 400, { error: 'Price must be > 0 ATOM for: ' + hero.name }); prepared.push({ hero, price }); } const listings = prepared.map(x => createListing(x.hero, b.address, b.sellerAddress, x.price)); addLedger('bulk_listing_created', { count: listings.length, listingIds: listings.map(l => l.id), sellerAddress: b.sellerAddress }); save(db); return send(res, 200, { listings }); }
  if (req.method === 'POST' && p === '/api/listings') { const b = await readBody(req); const hero = db.heroes.find(h => h.id === b.heroId); if (!hero) return send(res, 404, { error: 'Hero not found' }); if (hero.owner !== b.address) return send(res, 403, { error: 'You do not own this hero' }); if (isBanned(b.address)) return send(res, 403, { error: 'This address is banned.' }); if (hero.rentedTo) return send(res, 400, { error: 'Hero is rented out until ' + (hero.rentalEndsAt || '').slice(0, 10) + '. It returns automatically.' }); if (db.listings.some(l => l.heroId === hero.id && (l.status === 'active' || l.status === 'reserved'))) return send(res, 400, { error: 'Already listed' }); const price = Number(b.priceAtom); if (!isFinite(price) || price <= 0 || price > 100000) return send(res, 400, { error: 'Price must be > 0 ATOM' }); if (!isAddress(b.sellerAddress)) return send(res, 400, { error: 'Seller Cosmos address required (your connected wallet address).' }); const listing = createListing(hero, b.address, b.sellerAddress, price); save(db); return send(res, 200, { listing }); }
  // CEO-escrow buy: ONE send, full price, to the CEO address, memo = listing ID.
  if (req.method === 'POST' && p === '/api/buy') { const b = await readBody(req); const listing = db.listings.find(l => l.id === b.listingId); if (!listing || listing.status !== 'active') return send(res, 400, { error: 'Listing not active' }); if (!isAddress(b.buyerAddress)) return send(res, 400, { error: 'Buyer Cosmos address required (connected wallet).' }); if (isBanned(b.buyerAddress)) return send(res, 403, { error: 'This address is banned.' }); if (b.buyerAddress === listing.sellerAddress) return send(res, 400, { error: 'Buyer and seller addresses are the same.' }); if (listing.acceptedOfferBuyer && b.buyerAddress !== listing.acceptedOfferBuyer) return send(res, 400, { error: 'This listing has an accepted offer reserved for another buyer.' }); if (!isTxid(b.txid)) return send(res, 400, { error: 'One TXID required: the single send to the CEO address, 64 hex characters.' }); const tx = b.txid.toLowerCase(); if (db.usedTxids.includes(tx)) return send(res, 400, { error: 'This TXID was already used for another order.' }); if (Number(b.amountAtom) !== Number(listing.priceAtom)) return send(res, 400, { error: 'Amount must be exactly the full price: ' + listing.priceAtom + ' ATOM to the CEO address.' }); if (String(b.memo || '').trim() !== listing.id) return send(res, 400, { error: 'Memo must be exactly the listing ID: ' + listing.id }); const expiresAt = Date.now() + ttl * 60000; const sale = { id: uid('sale'), listingId: listing.id, heroId: listing.heroId, heroName: listing.heroName, priceAtom: listing.priceAtom, sellerAmount: listing.sellerAmount, ceoFee: listing.ceoFee, feePercent: listing.feePercent, sellerAddress: listing.sellerAddress, ceoAddress: listing.ceoAddress, buyerAddress: b.buyerAddress, txid: tx, amountAtom: Number(b.amountAtom), memo: listing.id, status: 'pending', verification: 'unverified', sellerPayout: { amount: listing.sellerAmount, to: listing.sellerAddress, status: 'pending', txid: null }, explorerUrl: EXPLORER + tx, expiresAt, createdAt: new Date().toISOString() }; listing.status = 'reserved'; db.sales.push(sale); db.usedTxids.push(tx); addLedger('order_created', { saleId: sale.id, listingId: listing.id, heroId: listing.heroId, heroName: listing.heroName, priceAtom: listing.priceAtom, ceoFee: listing.ceoFee, sellerAmount: listing.sellerAmount, buyerAddress: sale.buyerAddress, sellerAddress: sale.sellerAddress, txid: tx, expiresAt: new Date(expiresAt).toISOString() }); save(db); return send(res, 200, { sale: saleView(sale), note: 'Pending CEO check. The hero moves only after the CEO verifies the send to the CEO address.' }); }
  if (p === '/api/marketplace/history') { const defId = u.searchParams.get('defId') || ''; const hist = priceHistoryByDef(); if (defId) return send(res, 200, { defId, sales: hist[defId] || [], count: (hist[defId] || []).length }); return send(res, 200, { history: hist }); }
  if (req.method === 'POST' && p === '/api/marketplace/offers') { const b = await readBody(req); expireOfferSweep(); const listing = db.listings.find(l => l.id === b.listingId); if (!listing || listing.status !== 'active') return send(res, 400, { error: 'Listing not active' }); if (!isAddress(b.buyerAddress)) return send(res, 400, { error: 'Buyer Cosmos address required (connected wallet).' }); if (isBanned(b.buyerAddress)) return send(res, 403, { error: 'This address is banned.' }); if (b.buyerAddress === listing.sellerAddress) return send(res, 400, { error: 'Seller cannot offer on their own listing.' }); if (listing.acceptedOfferId) return send(res, 400, { error: 'Listing already has an accepted offer.' }); const amount = Number(b.amountAtom); if (!isFinite(amount) || amount <= 0) return send(res, 400, { error: 'Offer must be > 0 ATOM' }); if (amount >= listing.priceAtom) return send(res, 400, { error: 'Offers must be below the list price (' + listing.priceAtom + ' ATOM). Use Buy at full price.' }); if (db.offers.some(o => o.listingId === listing.id && o.buyerAddress === b.buyerAddress && o.status === 'pending')) return send(res, 400, { error: 'You already have a pending offer on this listing.' }); const hero = db.heroes.find(h => h.id === listing.heroId); const offer = { id: uid('offer'), listingId: listing.id, heroId: listing.heroId, heroName: listing.heroName, defId: hero ? hero.defId : null, sellerAddress: listing.sellerAddress, buyerAddress: b.buyerAddress, amountAtom: amount, status: 'pending', createdAt: new Date().toISOString() }; db.offers.push(offer); addLedger('offer_created', { offerId: offer.id, listingId: listing.id, heroId: listing.heroId, heroName: listing.heroName, amountAtom: amount, buyerAddress: offer.buyerAddress, sellerAddress: offer.sellerAddress }); save(db); return send(res, 200, { offer }); }
  if (req.method === 'POST' && p === '/api/marketplace/offers/respond') { const b = await readBody(req); const offer = db.offers.find(o => o.id === b.offerId); if (!offer) return send(res, 404, { error: 'Offer not found' }); if (offer.status !== 'pending') return send(res, 400, { error: 'Offer is not pending (status: ' + offer.status + ')' }); const listing = db.listings.find(l => l.id === offer.listingId); if (!listing || listing.status !== 'active') return send(res, 400, { error: 'Listing is no longer active' }); if (b.sellerAddress !== listing.sellerAddress) return send(res, 403, { error: 'Only the seller can respond to this offer.' }); if (b.accept === true) { for (const o of db.offers) if (o.listingId === listing.id && o.status === 'pending' && o.id !== offer.id) o.status = 'superseded'; offer.status = 'accepted'; offer.decidedAt = new Date().toISOString(); listing.originalPriceAtom = listing.priceAtom; const feeAmt = round6(offer.amountAtom * feePercent() / 100); listing.priceAtom = offer.amountAtom; listing.sellerAmount = round6(offer.amountAtom - feeAmt); listing.ceoFee = feeAmt; listing.feePercent = feePercent(); listing.acceptedOfferId = offer.id; listing.acceptedOfferBuyer = offer.buyerAddress; listing.offerExpiresAt = Date.now() + ttl * 60000; addLedger('offer_accepted', { offerId: offer.id, listingId: listing.id, heroId: listing.heroId, heroName: listing.heroName, amountAtom: offer.amountAtom, buyerAddress: offer.buyerAddress, sellerAddress: offer.sellerAddress, offerExpiresAt: new Date(listing.offerExpiresAt).toISOString() }); } else if (b.accept === false) { offer.status = 'declined'; offer.decidedAt = new Date().toISOString(); addLedger('offer_declined', { offerId: offer.id, listingId: listing.id, heroId: listing.heroId, heroName: listing.heroName, amountAtom: offer.amountAtom, buyerAddress: offer.buyerAddress, sellerAddress: offer.sellerAddress }); } else return send(res, 400, { error: 'accept must be true or false.' }); save(db); return send(res, 200, { offer, listing }); }
  if (p === '/api/marketplace/offers') { const addr = u.searchParams.get('address') || ''; return send(res, 200, { offers: db.offers.filter(o => !addr || o.buyerAddress === addr || o.sellerAddress === addr).slice().reverse() }); }
  if (req.method === 'POST' && p === '/api/marketplace/rentals') { const b = await readBody(req); const hero = db.heroes.find(h => h.id === b.heroId); if (!hero) return send(res, 404, { error: 'Hero not found' }); if (hero.owner !== b.ownerAddress) return send(res, 403, { error: 'You do not own this hero' }); if (isBanned(b.ownerAddress)) return send(res, 403, { error: 'This address is banned.' }); if (hero.rentedTo) return send(res, 400, { error: 'Hero is already rented out.' }); if (db.listings.some(l => l.heroId === hero.id && (l.status === 'active' || l.status === 'reserved'))) return send(res, 400, { error: 'Hero is listed for sale. It cannot be rented out at the same time.' }); if (db.rentals.some(r => r.heroId === hero.id && (r.status === 'available' || r.status === 'pending' || r.status === 'active'))) return send(res, 400, { error: 'Hero already has a rental.' }); const price = Number(b.priceAtom); if (!isFinite(price) || price <= 0 || price > 100000) return send(res, 400, { error: 'Price must be > 0 ATOM' }); const days = Math.floor(Number(b.days) || 0); if (days < 1 || days > 30) return send(res, 400, { error: 'Rental length must be 1-30 days.' }); if (!isAddress(b.ownerAddress)) return send(res, 400, { error: 'Owner Cosmos address required (your connected wallet address).' }); const feeAmt = round6(price * feePercent() / 100); const rental = { id: uid('rent'), heroId: hero.id, heroName: hero.name, defId: hero.defId, ownerAddress: b.ownerAddress, priceAtom: price, days, sellerAmount: round6(price - feeAmt), ceoFee: feeAmt, feePercent: feePercent(), ceoAddress: CEO_ADDRESS, status: 'available', sellerPayout: { amount: round6(price - feeAmt), to: b.ownerAddress, status: 'pending', txid: null }, createdAt: new Date().toISOString() }; db.rentals.push(rental); addLedger('rental_created', { rentalId: rental.id, heroId: hero.id, heroName: hero.name, priceAtom: price, days, ownerAddress: rental.ownerAddress }); save(db); return send(res, 200, { rental }); }
  if (req.method === 'POST' && p === '/api/marketplace/rentals/request') { const b = await readBody(req); const rental = db.rentals.find(r => r.id === b.rentalId); if (!rental || rental.status !== 'available') return send(res, 400, { error: 'Rental not available' }); if (!isAddress(b.renterAddress)) return send(res, 400, { error: 'Renter Cosmos address required (connected wallet).' }); if (isBanned(b.renterAddress)) return send(res, 403, { error: 'This address is banned.' }); if (b.renterAddress === rental.ownerAddress) return send(res, 400, { error: 'Owner cannot rent their own hero.' }); if (!isTxid(b.txid)) return send(res, 400, { error: 'One TXID required: the single send to the CEO address, 64 hex characters.' }); const tx = b.txid.toLowerCase(); if (db.usedTxids.includes(tx)) return send(res, 400, { error: 'This TXID was already used for another order.' }); if (Number(b.amountAtom) !== Number(rental.priceAtom)) return send(res, 400, { error: 'Amount must be exactly the full rental price: ' + rental.priceAtom + ' ATOM to the CEO address.' }); if (String(b.memo || '').trim() !== rental.id) return send(res, 400, { error: 'Memo must be exactly the rental ID: ' + rental.id }); rental.status = 'pending'; rental.renterAddress = b.renterAddress; rental.txid = tx; rental.amountAtom = Number(b.amountAtom); rental.memo = rental.id; rental.expiresAt = Date.now() + ttl * 60000; db.usedTxids.push(tx); addLedger('rental_order_created', { rentalId: rental.id, heroId: rental.heroId, heroName: rental.heroName, priceAtom: rental.priceAtom, ceoFee: rental.ceoFee, sellerAmount: rental.sellerAmount, renterAddress: rental.renterAddress, ownerAddress: rental.ownerAddress, txid: tx, expiresAt: new Date(rental.expiresAt).toISOString() }); save(db); return send(res, 200, { rental: rentalView(rental), note: 'Pending CEO check. The loan starts only after the CEO verifies the send to the CEO address.' }); }
  if (req.method === 'POST' && p === '/api/marketplace/rentals/cancel') { const b = await readBody(req); const rental = db.rentals.find(r => r.id === b.rentalId); if (!rental) return send(res, 404, { error: 'Rental not found' }); if (rental.ownerAddress !== b.address) return send(res, 403, { error: 'Only the owner can cancel this rental.' }); if (rental.status !== 'available') return send(res, 400, { error: 'Only an available rental can be cancelled (status: ' + rental.status + ')' }); rental.status = 'cancelled'; addLedger('rental_cancelled', { rentalId: rental.id, heroId: rental.heroId, heroName: rental.heroName, ownerAddress: rental.ownerAddress }); save(db); return send(res, 200, { rental: rentalView(rental) }); }
  if (p === '/api/marketplace/rentals') { const addr = u.searchParams.get('address') || ''; rentalSweep(); return send(res, 200, { rentals: db.rentals.filter(r => !addr || r.ownerAddress === addr || r.renterAddress === addr).slice().reverse().map(rentalView) }); }
  if (req.method === 'POST' && p === '/api/duels') { const b = await readBody(req); if (!db.players[b.challengerAddress] || !db.players[b.rivalAddress]) return send(res, 400, { error: 'Both players must connect wallet first.' }); if (b.challengerAddress === b.rivalAddress) return send(res, 400, { error: 'Cannot duel yourself.' }); if (isBanned(b.challengerAddress) || isBanned(b.rivalAddress)) return send(res, 403, { error: 'A banned address cannot duel.' }); const entryFee = Number(b.entryFee) || 0; if (DUEL_ENTRY_FEES.indexOf(entryFee) < 0) return send(res, 400, { error: 'Entry fee must be one of: ' + DUEL_ENTRY_FEES.join(', ') + ' credits.' }); const duel = { id: uid('duel'), challenger: b.challengerAddress, rival: b.rivalAddress, rivalBest: db.players[b.rivalAddress].bestScore || 0, status: 'pending', rivalResponse: null, game: 'cosmos-btd', seed: duelSeedFor(), entryFee, raceSeconds: DUEL_RACE_SECONDS, liveScores: { challenger: 0, rival: 0 }, liveWaves: { challenger: 0, rival: 0 }, feePaid: false, pot: 0, createdAt: new Date().toISOString() }; db.duels.push(duel); save(db); return send(res, 200, { duel: duelView(duel) }); }
  if (p === '/api/duels') { const addr = u.searchParams.get('address'); const pl = db.players[addr]; if (!pl) return send(res, 400, { error: 'Connect wallet / create player first.' }); return send(res, 200, { duels: db.duels.filter(function (d) { return d.challenger === addr || d.rival === addr; }).slice().reverse().map(duelView) }); }
  if (p === '/api/duels/history') { const addr = u.searchParams.get('address'); const pl = db.players[addr]; if (!pl) return send(res, 400, { error: 'Connect wallet / create player first.' }); expireLiveDuels(); const decided = ['challenger_won', 'challenger_lost', 'draw', 'declined']; return send(res, 200, { history: db.duels.filter(function (d) { return (d.challenger === addr || d.rival === addr) && decided.indexOf(d.status) >= 0; }).slice().reverse().slice(0, 20).map(function (d) { return duelHistoryView(d, addr); }) }); }
  if (req.method === 'GET' && p.indexOf('/api/duels/') === 0 && p.endsWith('/live')) { const duelId = p.slice('/api/duels/'.length, -'/live'.length); const addr = u.searchParams.get('address'); const duel = db.duels.find(function (d) { return d.id === duelId; }); if (!duel) return send(res, 404, { error: 'Duel not found' }); if (duel.challenger !== addr && duel.rival !== addr) return send(res, 403, { error: 'Only duel participants can poll the live race.' }); expireLiveDuels(); return send(res, 200, { duel: duelLiveView(duel) }); }
  if (req.method === 'POST' && p === '/api/duels/start') { const b = await readBody(req); const duel = db.duels.find(function (d) { return d.id === b.duelId; }); if (!duel) return send(res, 404, { error: 'Duel not found' }); if (duel.challenger !== b.address && duel.rival !== b.address) return send(res, 403, { error: 'Only duel participants can start the race.' }); if (duel.status !== 'pending' || duel.rivalResponse !== 'accepted') return send(res, 400, { error: 'The rival must accept the invite before the race can start (status: ' + duel.status + ').' }); const cp = db.players[duel.challenger], rp = db.players[duel.rival]; if (duel.entryFee > 0 && ((cp.credits || 0) < duel.entryFee || (rp.credits || 0) < duel.entryFee)) return send(res, 400, { error: 'Both players need at least ' + duel.entryFee + ' credits to start this duel.' }); if (duel.entryFee > 0) { cp.credits -= duel.entryFee; rp.credits -= duel.entryFee; duel.feePaid = true; duel.pot = 2 * duel.entryFee; addLedger('duel_entry_fee', { duelId: duel.id, challenger: duel.challenger, rival: duel.rival, entryFee: duel.entryFee, pot: duel.pot }); } duel.status = 'live'; duel.startedAt = new Date().toISOString(); duel.expiresAt = Date.now() + duel.raceSeconds * 1000; duel.liveScores = { challenger: 0, rival: 0 }; duel.liveWaves = { challenger: 0, rival: 0 }; save(db); return send(res, 200, { duel: duelLiveView(duel) }); }
  if (req.method === 'POST' && p === '/api/duels/live') { const b = await readBody(req); const duel = db.duels.find(function (d) { return d.id === b.duelId; }); if (!duel) return send(res, 404, { error: 'Duel not found' }); expireLiveDuels(); if (duel.status !== 'live') return send(res, 400, { error: 'The live race is not running (status: ' + duel.status + ').' }); if (duel.challenger !== b.address && duel.rival !== b.address) return send(res, 403, { error: 'Only duel participants can post live scores.' }); const score = Number(b.score); const wave = Number(b.wave); if (!isFinite(score) || !Number.isInteger(score) || score < 0 || score > 100000) return send(res, 400, { error: 'Live score must be an integer 0-100000.' }); if (b.wave !== undefined && (!isFinite(wave) || !Number.isInteger(wave) || wave < 0 || wave > 200)) return send(res, 400, { error: 'Live wave must be an integer 0-200.' }); const side = duel.challenger === b.address ? 'challenger' : 'rival'; duel.liveScores = duelScores(duel); duel.liveWaves = duelWaves(duel); if (score > duel.liveScores[side]) duel.liveScores[side] = score; if (b.wave !== undefined && wave > duel.liveWaves[side]) duel.liveWaves[side] = wave; save(db); return send(res, 200, { duel: duelLiveView(duel) }); }
  if (req.method === 'POST' && p === '/api/duels/finish') { const b = await readBody(req); const duel = db.duels.find(function (d) { return d.id === b.duelId; }); if (!duel) return send(res, 404, { error: 'Duel not found' }); if (duel.challenger !== b.address && duel.rival !== b.address) return send(res, 403, { error: 'Only duel participants can finish the race.' }); expireLiveDuels(); if (duel.status === 'live') { const outcome = finishLiveDuel(duel, 'finished'); return send(res, 200, { duel: duelView(duel), winner: outcome && outcome.winner, isDraw: !!(outcome && outcome.isDraw), achievementsUnlocked: (outcome && outcome.achievementsUnlocked) || [] }); } if (['challenger_won', 'challenger_lost', 'draw'].indexOf(duel.status) >= 0) return send(res, 200, { duel: duelView(duel), winner: duel.winner || null, isDraw: duel.status === 'draw', achievementsUnlocked: [] }); return send(res, 400, { error: 'Duel cannot finish from status: ' + duel.status }); }
  if (req.method === 'POST' && p === '/api/duels/rematch') { const b = await readBody(req); const orig = db.duels.find(function (d) { return d.id === b.duelId; }); if (!orig) return send(res, 404, { error: 'Duel not found' }); if (orig.challenger !== b.address && orig.rival !== b.address) return send(res, 403, { error: 'Only duel participants can request a rematch.' }); if (['challenger_won', 'challenger_lost', 'draw', 'declined'].indexOf(orig.status) < 0) return send(res, 400, { error: 'Only a decided duel can be rematched (status: ' + orig.status + ').' }); if (isBanned(orig.challenger) || isBanned(orig.rival)) return send(res, 403, { error: 'A banned address cannot duel.' }); const duel = { id: uid('duel'), challenger: orig.challenger, rival: orig.rival, rivalBest: db.players[orig.rival].bestScore || 0, status: 'pending', rivalResponse: null, game: 'cosmos-btd', seed: duelSeedFor(), entryFee: orig.entryFee || 0, raceSeconds: DUEL_RACE_SECONDS, liveScores: { challenger: 0, rival: 0 }, liveWaves: { challenger: 0, rival: 0 }, feePaid: false, pot: 0, rematchOf: orig.id, createdAt: new Date().toISOString() }; db.duels.push(duel); save(db); return send(res, 200, { duel: duelView(duel) }); }
  if (req.method === 'POST' && p === '/api/duels/respond') { const b = await readBody(req); const duel = db.duels.find(function (d) { return d.id === b.duelId; }); if (!duel) return send(res, 404, { error: 'Duel not found' }); if (duel.rival !== b.address) return send(res, 403, { error: 'Only the rival can accept or decline this invite.' }); if (duel.status !== 'pending') return send(res, 400, { error: 'Duel is not pending (status: ' + duel.status + ')' }); if (duel.rivalResponse) return send(res, 400, { error: 'You already responded to this invite.' }); if (b.accept === true) { duel.rivalResponse = 'accepted'; } else if (b.accept === false) { duel.rivalResponse = 'declined'; duel.status = 'declined'; duel.decidedAt = new Date().toISOString(); } else return send(res, 400, { error: 'accept must be true or false.' }); save(db); return send(res, 200, { duel: duelView(duel) }); }
  if (req.method === 'POST' && p === '/api/duels/result') { const b = await readBody(req); const duel = db.duels.find(d => d.id === b.duelId); if (!duel || duel.status !== 'pending') return send(res, 400, { error: 'Duel not pending' }); if (duel.challenger !== b.address) return send(res, 403, { error: 'Only the challenger submits the result.' }); if ((duel.entryFee || 0) > 0) return send(res, 400, { error: 'This duel has a credits entry fee: start the live race and finish it there.' }); const score = Math.max(0, Math.min(100000, Number(b.score) || 0)); const won = score > duel.rivalBest; duel.status = won ? 'challenger_won' : 'challenger_lost'; duel.score = score; duel.decidedAt = new Date().toISOString(); const pl = db.players[b.address]; pl.gamesPlayed = (pl.gamesPlayed || 0) + 1; if (score > (pl.bestScore || 0)) pl.bestScore = score; if (won) { pl.wins = (pl.wins || 0) + 1; pl.credits = (pl.credits || 0) + 150; pl.xp = (pl.xp || 0) + 100; ensureQuests(pl); pl.questProgress.duelsWon = (pl.questProgress.duelsWon || 0) + 1; } else { pl.losses = (pl.losses || 0) + 1; pl.xp = (pl.xp || 0) + 20; } pl.bests = pl.bests || {}; if (score > (pl.bests['cosmos-btd'] || 0)) pl.bests['cosmos-btd'] = score; recordSeasonBest(pl, 'cosmos-btd', score); const achUnlocked = checkAchievements(pl); save(db); return send(res, 200, { duel: duelView(duel), won, rivalBest: duel.rivalBest, achievementsUnlocked: achUnlocked }); }
  // ---------------- CEO PANEL (ADR-36 signed, every action) ----------------
  const ceoOnly = async (body) => { if (!isCeoRequest(req, body)) { send(res, 401, { error: 'CEO wallet signature required: connect Keplr with the CEO address and sign.' }); return false; } return true; };
  if (p === '/api/admin/pending') { if (!(await ceoOnly({}))) return; return send(res, 200, { sales: db.sales.filter(s => s.status === 'pending').map(saleView), rentals: (db.rentals || []).filter(r => r.status === 'pending').map(rentalView), flags: db.flags.filter(f => !f.resolved), openDisputes: db.sales.filter(s => s.dispute && !s.dispute.resolved).length, settings: db.settings, feePercent: fee, orderTtlMinutes: ttl, ceoAddress: CEO_ADDRESS }); }
  if (p === '/api/admin/settings') {
    if (req.method === 'GET') { if (!(await ceoOnly({}))) return; return send(res, 200, { settings: db.settings, feePercent: fee, orderTtlMinutes: ttl, autoVerifyEnabled: autoVerifyEnabled(), ceoAddress: CEO_ADDRESS, lcdUrls: LCD_URLS, wsUrl: WS_URL }); }
    const b = await readBody(req); if (!(await ceoOnly(b))) return;
    if (b.feePercent !== undefined) { const f = parseFloat(b.feePercent); if (!isFinite(f) || f < 4 || f > 7) return send(res, 400, { error: 'CEO fee must be 4-7%.' }); db.settings.feePercent = f; }
    if (b.orderTtlMinutes !== undefined) { const t = parseFloat(b.orderTtlMinutes); if (!isFinite(t) || t < 1 || t > 1440) return send(res, 400, { error: 'Order timer must be 1-1440 minutes.' }); db.settings.orderTtlMinutes = t; }
    if (b.autoVerifyEnabled !== undefined) db.settings.autoVerifyEnabled = !!b.autoVerifyEnabled;
    addLedger('settings_changed', { feePercent: feePercent(), orderTtlMinutes: orderTtlMinutes(), autoVerifyEnabled: autoVerifyEnabled() }); addAudit('settings', { by: CEO_ADDRESS }); save(db);
    return send(res, 200, { settings: db.settings });
  }
  if (p === '/api/admin/ledger') { if (!(await ceoOnly({}))) return; const kind = u.searchParams.get('kind') || ''; const limit = Math.min(5000, Math.max(1, parseInt(u.searchParams.get('limit') || '200', 10))); const entries = db.ledger.filter(e => !kind || e.kind === kind).slice().reverse().slice(0, limit); const closed = db.sales.filter(s => s.status === 'closed' || s.status === 'approved'); const volume = round6(closed.reduce((a, s) => a + (s.priceAtom || 0), 0)); const fees = round6(closed.reduce((a, s) => a + (s.ceoFee || 0), 0)); const payouts = round6(db.sales.filter(s => s.sellerPayout && s.sellerPayout.status === 'paid').reduce((a, s) => a + (s.sellerPayout.amount || 0), 0)); return send(res, 200, { entries, totals: { volume, fees, payouts, orders: db.sales.length, pending: db.sales.filter(s => s.status === 'pending').length, closed: closed.length, expired: db.sales.filter(s => s.status === 'expired').length }, kinds: [...new Set(db.ledger.map(e => e.kind))] }); }
  if (p === '/api/admin/users') { if (!(await ceoOnly({}))) return; const users = Object.values(db.players).map(pl => ({ address: pl.address, name: pl.name, credits: pl.credits || 0, xp: pl.xp || 0, level: levelForXp(pl.xp || 0), bestScore: pl.bestScore || 0, bestWave: pl.bestWave || 0, totalPops: pl.totalPops || 0, achievements: (pl.achievements || []).length, heroes: db.heroes.filter(h => h.owner === pl.address).length, listings: db.listings.filter(l => l.sellerAddress === pl.address).length, orders: db.sales.filter(s => s.buyerAddress === pl.address || s.sellerAddress === pl.address).length, banned: isBanned(pl.address), ban: db.bans[pl.address] || null })); return send(res, 200, { users, banned: Object.keys(db.bans) }); }
  if (p === '/api/admin/flags') { if (!(await ceoOnly({}))) return; return send(res, 200, { flags: db.flags.slice().reverse() }); }
  if (p === '/api/admin/audit') { if (!(await ceoOnly({}))) return; return send(res, 200, { audit: db.auditLog.slice().reverse().slice(0, 200) }); }
  if (req.method === 'POST' && p === '/api/admin/auto-verify-order') { const b = await readBody(req); if (!(await ceoOnly(b))) return; const sale = db.sales.find(s => s.id === b.saleId); if (!sale) return send(res, 404, { error: 'Order not found' }); if (sale.status !== 'pending') return send(res, 400, { error: 'Order is not pending (status: ' + sale.status + ')' }); const v = await validateBuyerTx(sale); sale.lastVerification = { at: new Date().toISOString(), verified: v.verified, checks: v.checks }; save(db); return send(res, 200, { verified: v.verified, checks: v.checks, sale: saleView(sale) }); }
  if (req.method === 'POST' && p === '/api/admin/record-payout') { const b = await readBody(req); if (!(await ceoOnly(b))) return; const sale = db.sales.find(s => s.id === b.saleId); if (!sale) return send(res, 404, { error: 'Order not found' }); if (!isTxid(b.payoutTxid)) return send(res, 400, { error: 'Payout TXID must be 64 hex characters.' }); if (db.usedTxids.includes(b.payoutTxid.toLowerCase())) return send(res, 400, { error: 'Payout TXID already used.' }); sale.sellerPayout = sale.sellerPayout || { amount: sale.sellerAmount, to: sale.sellerAddress, status: 'pending', txid: null }; sale.sellerPayout.status = 'paid'; sale.sellerPayout.txid = b.payoutTxid.toLowerCase(); db.usedTxids.push(sale.sellerPayout.txid); addLedger('seller_payout', { saleId: sale.id, listingId: sale.listingId, heroName: sale.heroName, amount: sale.sellerPayout.amount, to: sale.sellerAddress, txid: sale.sellerPayout.txid, buyerAddress: sale.buyerAddress }); addAudit('record-payout', { saleId: sale.id }); save(db); return send(res, 200, { sale: saleView(sale) }); }
  if (req.method === 'POST' && p === '/api/admin/rentals/verify') { const b = await readBody(req); if (!(await ceoOnly(b))) return; const rental = db.rentals.find(r => r.id === b.rentalId); if (!rental) return send(res, 404, { error: 'Rental not found' }); if (rental.status !== 'pending') return send(res, 400, { error: 'Rental is not pending (status: ' + rental.status + ')' }); const v = await validateRentalTx(rental); rental.lastVerification = { at: new Date().toISOString(), verified: v.verified, checks: v.checks }; save(db); return send(res, 200, { verified: v.verified, checks: v.checks, rental: rentalView(rental) }); }
  if (req.method === 'POST' && p === '/api/admin/rentals/execute') {
    const b = await readBody(req); if (!(await ceoOnly(b))) return;
    const rental = db.rentals.find(r => r.id === b.rentalId); if (!rental || rental.status !== 'pending') return send(res, 400, { error: 'Rental not pending' });
    let verification = 'manual';
    if (b.autoVerify) { const v = await validateRentalTx(rental); rental.lastVerification = { at: new Date().toISOString(), verified: v.verified, checks: v.checks }; if (!v.verified) { save(db); return send(res, 400, { error: 'On-chain verification failed. Rental left pending.', checks: v.checks }); } verification = 'chain'; }
    else if (!b.checkedAmount || !b.checkedCeo || !b.checkedMemo || !b.checkedExplorer) return send(res, 400, { error: 'Tick all 4 checks, or use on-chain auto-verify.' });
    const hero = db.heroes.find(h => h.id === rental.heroId); if (!hero) return send(res, 400, { error: 'Hero missing' });
    if (hero.owner !== rental.ownerAddress) return send(res, 400, { error: 'Hero owner changed since the rental was created.' });
    rental.verification = verification; rental.status = 'active'; rental.startsAt = new Date().toISOString(); rental.endsAt = Date.now() + rental.days * 86400000; rental.endsAtIso = new Date(rental.endsAt).toISOString();
    hero.rentedTo = rental.renterAddress; hero.rentalId = rental.id; hero.rentalEndsAt = rental.endsAtIso;
    if (b.payoutTxid) { if (!isTxid(b.payoutTxid)) return send(res, 400, { error: 'Payout TXID must be 64 hex characters.' }); const pt = b.payoutTxid.toLowerCase(); if (db.usedTxids.includes(pt)) return send(res, 400, { error: 'Payout TXID already used.' }); rental.sellerPayout = { amount: rental.sellerAmount, to: rental.ownerAddress, status: 'paid', txid: pt }; db.usedTxids.push(pt); addLedger('rental_payout', { rentalId: rental.id, heroName: rental.heroName, amount: rental.sellerAmount, to: rental.ownerAddress, txid: pt, renterAddress: rental.renterAddress }); }
    addLedger('rental_verified', { rentalId: rental.id, verification, priceAtom: rental.priceAtom, txid: rental.txid });
    addLedger('rental_started', { rentalId: rental.id, heroId: rental.heroId, heroName: rental.heroName, priceAtom: rental.priceAtom, ceoFee: rental.ceoFee, sellerAmount: rental.sellerAmount, ownerAddress: rental.ownerAddress, renterAddress: rental.renterAddress, days: rental.days, endsAt: rental.endsAtIso });
    addAudit('execute-rental', { rentalId: rental.id, verification }); save(db);
    return send(res, 200, { rental: rentalView(rental), hero, note: rental.sellerPayout && rental.sellerPayout.status === 'paid' ? 'Rental started: verified, loan active, payout recorded. Hero returns automatically.' : 'Rental started: verified, loan active. Owner payout still pending — send it from the CEO wallet and record the TXID.' });
  }
  if (req.method === 'POST' && p === '/api/admin/rentals/record-payout') { const b = await readBody(req); if (!(await ceoOnly(b))) return; const rental = db.rentals.find(r => r.id === b.rentalId); if (!rental) return send(res, 404, { error: 'Rental not found' }); if (!isTxid(b.payoutTxid)) return send(res, 400, { error: 'Payout TXID must be 64 hex characters.' }); if (db.usedTxids.includes(b.payoutTxid.toLowerCase())) return send(res, 400, { error: 'Payout TXID already used.' }); rental.sellerPayout = rental.sellerPayout || { amount: rental.sellerAmount, to: rental.ownerAddress, status: 'pending', txid: null }; rental.sellerPayout.status = 'paid'; rental.sellerPayout.txid = b.payoutTxid.toLowerCase(); db.usedTxids.push(rental.sellerPayout.txid); addLedger('rental_payout', { rentalId: rental.id, heroName: rental.heroName, amount: rental.sellerPayout.amount, to: rental.ownerAddress, txid: rental.sellerPayout.txid, renterAddress: rental.renterAddress }); addAudit('record-rental-payout', { rentalId: rental.id }); save(db); return send(res, 200, { rental: rentalView(rental) }); }

  if (req.method === 'POST' && (p === '/api/admin/approve' || p === '/api/admin/reject')) {
    const b = await readBody(req); if (!(await ceoOnly(b))) return;
    const sale = db.sales.find(s => s.id === b.saleId); if (!sale || sale.status !== 'pending') return send(res, 400, { error: 'Order not pending' });
    const listing = db.listings.find(l => l.id === sale.listingId);
    if (p === '/api/admin/approve') { if (!b.checkedAmount || !b.checkedCeo || !b.checkedMemo || !b.checkedExplorer) return send(res, 400, { error: 'Tick all 4 checks: amount, CEO recipient, memo, explorer.' }); const hero = moveHeroToBuyer(sale); if (!hero) return send(res, 400, { error: 'Hero missing' }); sale.status = 'approved'; sale.verification = 'manual'; sale.decidedAt = new Date().toISOString(); closeListing(sale); recordSaleHistory(sale); addLedger('item_moved', { saleId: sale.id, heroId: sale.heroId, heroName: sale.heroName, to: sale.buyerAddress }); addLedger('order_approved', { saleId: sale.id, priceAtom: sale.priceAtom, ceoFee: sale.ceoFee, buyerAddress: sale.buyerAddress, sellerAddress: sale.sellerAddress }); addAudit('approve', { saleId: sale.id }); save(db); return send(res, 200, { sale: saleView(sale), hero }); }
    sale.status = 'rejected'; sale.reason = String(b.reason || 'Rejected by CEO').slice(0, 200); sale.decidedAt = new Date().toISOString(); if (listing) listing.status = 'active'; if (listing) restoreListingOffer(listing); addLedger('order_rejected', { saleId: sale.id, reason: sale.reason, priceAtom: sale.priceAtom }); addAudit('reject', { saleId: sale.id }); save(db); return send(res, 200, { sale: saleView(sale) });
  }
  // ONE-CLICK EXECUTE: verify + move + close in one CEO-signed action.
  // If autoVerify is set, the server re-checks the buyer TX on-chain and
  // fails closed when it cannot verify. Otherwise the 4 manual checks
  // must be ticked. Payout TXID is optional here — the CEO UI sends the
  // seller payout from the CEO wallet first, then calls execute with its
  // TXID; if the payout was already sent, record it afterwards.
  if (req.method === 'POST' && p === '/api/admin/execute-order') {
    const b = await readBody(req); if (!(await ceoOnly(b))) return;
    const sale = db.sales.find(s => s.id === b.saleId); if (!sale || sale.status !== 'pending') return send(res, 400, { error: 'Order not pending' });
    let verification = 'manual';
    if (b.autoVerify) { const v = await validateBuyerTx(sale); sale.lastVerification = { at: new Date().toISOString(), verified: v.verified, checks: v.checks }; if (!v.verified) { save(db); return send(res, 400, { error: 'On-chain verification failed. Order left pending.', checks: v.checks }); } verification = 'chain'; }
    else if (!b.checkedAmount || !b.checkedCeo || !b.checkedMemo || !b.checkedExplorer) return send(res, 400, { error: 'Tick all 4 checks, or use on-chain auto-verify.' });
    const hero = moveHeroToBuyer(sale); if (!hero) return send(res, 400, { error: 'Hero missing' });
    sale.verification = verification; sale.status = 'closed'; const nowIso = new Date().toISOString(); sale.decidedAt = nowIso; sale.closedAt = nowIso; sale.closedInSec = Math.max(0, Math.round((Date.now() - new Date(sale.createdAt).getTime()) / 1000)); closeListing(sale);
    if (b.payoutTxid) { if (!isTxid(b.payoutTxid)) return send(res, 400, { error: 'Payout TXID must be 64 hex characters.' }); const pt = b.payoutTxid.toLowerCase(); if (db.usedTxids.includes(pt)) return send(res, 400, { error: 'Payout TXID already used.' }); sale.sellerPayout = { amount: sale.sellerAmount, to: sale.sellerAddress, status: 'paid', txid: pt }; db.usedTxids.push(pt); addLedger('seller_payout', { saleId: sale.id, listingId: sale.listingId, heroName: sale.heroName, amount: sale.sellerAmount, to: sale.sellerAddress, txid: pt, buyerAddress: sale.buyerAddress }); }
    recordSaleHistory(sale); addLedger('order_verified', { saleId: sale.id, verification, priceAtom: sale.priceAtom, txid: sale.txid });
    addLedger('item_moved', { saleId: sale.id, heroId: sale.heroId, heroName: sale.heroName, to: sale.buyerAddress });
    addLedger('order_closed', { saleId: sale.id, listingId: sale.listingId, heroName: sale.heroName, priceAtom: sale.priceAtom, ceoFee: sale.ceoFee, sellerAmount: sale.sellerAmount, buyerAddress: sale.buyerAddress, sellerAddress: sale.sellerAddress, closedInSec: sale.closedInSec, verification });
    const sellerPl = db.players[sale.sellerAddress]; if (sellerPl) { sellerPl.salesClosed = (sellerPl.salesClosed || 0) + 1; checkAchievements(sellerPl); }
    addAudit('execute-order', { saleId: sale.id, verification }); save(db);
    return send(res, 200, { sale: saleView(sale), hero, note: sale.sellerPayout && sale.sellerPayout.status === 'paid' ? 'Executed: verified, item moved, payout recorded, order closed.' : 'Executed: verified, item moved, order closed. Seller payout still pending — send it from the CEO wallet and record the TXID.' });
  }
  if (req.method === 'POST' && p === '/api/admin/ban') { const b = await readBody(req); if (!(await ceoOnly(b))) return; if (!isAddress(b.address)) return send(res, 400, { error: 'Valid Cosmos address required.' }); if (b.address === CEO_ADDRESS) return send(res, 400, { error: 'Cannot ban the CEO address.' }); db.bans[b.address] = { reason: String(b.reason || 'Banned by CEO').slice(0, 200), at: new Date().toISOString(), by: CEO_ADDRESS }; let removed = 0; for (const l of db.listings) if (l.sellerAddress === b.address && l.status === 'active') { l.status = 'removed'; removed++; } let rentalsCancelled = 0; for (const r of (db.rentals || [])) if (r.ownerAddress === b.address && r.status === 'available') { r.status = 'cancelled'; rentalsCancelled++; } addLedger('user_banned', { address: b.address, reason: db.bans[b.address].reason, listingsRemoved: removed, rentalsCancelled }); addAudit('ban', { address: b.address }); save(db); return send(res, 200, { banned: b.address, listingsRemoved: removed, rentalsCancelled }); }
  if (req.method === 'POST' && p === '/api/admin/unban') { const b = await readBody(req); if (!(await ceoOnly(b))) return; if (!db.bans[b.address]) return send(res, 404, { error: 'Address is not banned.' }); delete db.bans[b.address]; addLedger('user_unbanned', { address: b.address }); addAudit('unban', { address: b.address }); save(db); return send(res, 200, { unbanned: b.address }); }
  if (req.method === 'POST' && p === '/api/admin/remove-listing') { const b = await readBody(req); if (!(await ceoOnly(b))) return; const l = db.listings.find(x => x.id === b.listingId); if (!l) return send(res, 404, { error: 'Listing not found' }); if (l.status !== 'active') return send(res, 400, { error: 'Only active listings can be removed (status: ' + l.status + '). Resolve its order first.' }); l.status = 'removed'; l.removedReason = String(b.reason || 'Removed by CEO').slice(0, 200); restoreListingOffer(l); addLedger('listing_removed', { listingId: l.id, heroId: l.heroId, heroName: l.heroName, reason: l.removedReason, sellerAddress: l.sellerAddress }); addAudit('remove-listing', { listingId: l.id }); save(db); return send(res, 200, { listing: l }); }
  if (req.method === 'POST' && p === '/api/admin/remove-hero') { const b = await readBody(req); if (!(await ceoOnly(b))) return; const idx = db.heroes.findIndex(h => h.id === b.heroId); if (idx < 0) return send(res, 404, { error: 'Hero not found' }); const hero = db.heroes[idx]; if (db.sales.some(s => s.heroId === hero.id && s.status === 'pending')) return send(res, 400, { error: 'Hero has a pending order. Resolve the order first.' }); if ((db.rentals || []).some(r => r.heroId === hero.id && (r.status === 'pending' || r.status === 'active' || r.status === 'available'))) return send(res, 400, { error: 'Hero has a rental. Resolve or cancel the rental first.' }); db.heroes.splice(idx, 1); let removed = 0; for (const l of db.listings) if (l.heroId === hero.id && l.status === 'active') { l.status = 'removed'; removed++; } addLedger('hero_removed', { heroId: hero.id, heroName: hero.name, owner: hero.owner, reason: String(b.reason || 'Removed by CEO').slice(0, 200), listingsRemoved: removed }); addAudit('remove-hero', { heroId: hero.id }); save(db); return send(res, 200, { removed: hero.id, listingsRemoved: removed }); }
  if (req.method === 'POST' && p === '/api/admin/flag-resolve') { const b = await readBody(req); if (!(await ceoOnly(b))) return; const f = db.flags.find(x => x.id === b.flagId); if (!f) return send(res, 404, { error: 'Flag not found' }); f.resolved = true; f.resolvedAt = new Date().toISOString(); addAudit('flag-resolve', { flagId: f.id }); save(db); return send(res, 200, { flag: f }); }
  if (p === '/api/admin/disputes') { if (!(await ceoOnly({}))) return; const disputed = db.sales.filter(s => s.dispute && !s.dispute.resolved).map(saleView); return send(res, 200, { disputes: disputed, count: disputed.length, flags: db.flags.filter(f => f.type === 'order-dispute' && !f.resolved) }); }
  if (req.method === 'POST' && p === '/api/admin/orders/dispute') { const b = await readBody(req); if (!(await ceoOnly(b))) return; const sale = db.sales.find(s => s.id === b.saleId); if (!sale) return send(res, 404, { error: 'Order not found' }); if (sale.dispute && !sale.dispute.resolved) return send(res, 400, { error: 'Order already has an open dispute.' }); const reason = String(b.reason || 'Disputed by CEO').slice(0, 200); sale.dispute = { reason, by: CEO_ADDRESS, at: new Date().toISOString(), resolved: false }; addFlag('order-dispute', { saleId: sale.id, listingId: sale.listingId, heroName: sale.heroName, address: sale.buyerAddress, reason }); addLedger('order_disputed', { saleId: sale.id, listingId: sale.listingId, heroName: sale.heroName, priceAtom: sale.priceAtom, buyerAddress: sale.buyerAddress, sellerAddress: sale.sellerAddress, reason }); addAudit('dispute-order', { saleId: sale.id, reason }); save(db); return send(res, 200, { sale: saleView(sale) }); }
  if (req.method === 'POST' && p === '/api/admin/orders/dispute/resolve') { const b = await readBody(req); if (!(await ceoOnly(b))) return; const sale = db.sales.find(s => s.id === b.saleId); if (!sale) return send(res, 404, { error: 'Order not found' }); if (!sale.dispute || sale.dispute.resolved) return send(res, 400, { error: 'Order has no open dispute.' }); sale.dispute.resolved = true; sale.dispute.resolvedAt = new Date().toISOString(); sale.dispute.resolution = String(b.note || 'Resolved by CEO').slice(0, 200); for (const f of db.flags) if (f.type === 'order-dispute' && f.saleId === sale.id && !f.resolved) { f.resolved = true; f.resolvedAt = new Date().toISOString(); } addLedger('dispute_resolved', { saleId: sale.id, listingId: sale.listingId, heroName: sale.heroName, resolution: sale.dispute.resolution }); addAudit('dispute-resolve', { saleId: sale.id }); save(db); return send(res, 200, { sale: saleView(sale) }); }
  if (p === '/api/admin/analytics') { if (!(await ceoOnly({}))) return; return send(res, 200, feeAnalytics(u.searchParams.get('days') || 14)); }
  if (p === '/api/admin/announce/scheduled') { if (!(await ceoOnly({}))) return; ensureScheduled(); return send(res, 200, { scheduled: db.scheduledAnnouncements.slice().reverse() }); }
  if (req.method === 'POST' && p === '/api/admin/announce/schedule') { const b = await readBody(req); if (!(await ceoOnly(b))) return; const title = String(b.title || '').slice(0, 80); const schedBody = String(b.body || '').slice(0, 500); if (!title || !schedBody) return send(res, 400, { error: 'Title and body required.' }); const at = Date.parse(b.publishAt); if (!isFinite(at)) return send(res, 400, { error: 'publishAt must be an ISO date/time.' }); if (at <= Date.now()) return send(res, 400, { error: 'Scheduled time must be in the future.' }); ensureScheduled(); if (db.scheduledAnnouncements.filter(s => s.status === 'scheduled').length >= 20) return send(res, 400, { error: 'Too many scheduled announcements (max 20).' }); const item = { id: uid('sched'), title, body: schedBody, publishAt: at, publishAtIso: new Date(at).toISOString(), status: 'scheduled', createdAt: new Date().toISOString(), by: CEO_ADDRESS }; db.scheduledAnnouncements.push(item); addLedger('announcement_scheduled', { title, scheduledId: item.id, publishAt: item.publishAtIso }); addAudit('announce-schedule', { title, scheduledId: item.id }); save(db); return send(res, 200, { scheduled: item }); }
  if (req.method === 'POST' && p === '/api/admin/announce/schedule/cancel') { const b = await readBody(req); if (!(await ceoOnly(b))) return; ensureScheduled(); const item = db.scheduledAnnouncements.find(s => s.id === b.id); if (!item) return send(res, 404, { error: 'Scheduled announcement not found' }); if (item.status !== 'scheduled') return send(res, 400, { error: 'Only a scheduled announcement can be cancelled (status: ' + item.status + ')' }); item.status = 'cancelled'; item.cancelledAt = new Date().toISOString(); addLedger('announcement_cancelled', { title: item.title, scheduledId: item.id }); addAudit('announce-cancel', { scheduledId: item.id }); save(db); return send(res, 200, { scheduled: item }); }
  if (req.method === 'POST' && p === '/api/admin/announce') { const b = await readBody(req); if (!(await ceoOnly(b))) return; const title = String(b.title || '').slice(0, 80); const body = String(b.body || '').slice(0, 500); if (!title || !body) return send(res, 400, { error: 'Title and body required.' }); db.announcements = db.announcements || []; db.announcements.unshift({ id: uid('ann'), title, body, at: new Date().toISOString(), by: CEO_ADDRESS }); db.announcements = db.announcements.slice(0, 10); addLedger('announcement', { title }); addAudit('announce', { title }); save(db); return send(res, 200, { announcements: db.announcements }); }
  // ---------------- Static files ----------------
  let file = p === '/' ? '/index.html' : p;
  const fp = path.join(__dirname, 'public', file);
  if (!fp.startsWith(path.join(__dirname, 'public'))) return send(res, 403, { error: 'bad path' });
  fs.readFile(fp, (e, data) => { if (e) return send(res, 404, { error: 'not found' }); res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'text/plain' }); res.end(data); });
}
const server = http.createServer(handle);
if (require.main === module) { server.listen(PORT, () => console.log('GAME listening on ' + PORT + ' mode=' + MODE + ' chain=' + CHAIN_ID + ' fee=' + feePercent() + '% ceo=' + CEO_ADDRESS)); setInterval(() => { try { publishDueAnnouncements(); } catch {} }, 60000); }
module.exports = handle;
module.exports.default = handle;
module.exports.verifyAdr36 = verifyAdr36;
module.exports.addressFromPubkey = addressFromPubkey;

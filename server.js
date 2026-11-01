// Voidfall Cosmos v2 - DEMO / TEST MODE ONLY.
// No real ATOM is moved, signed, or verified on-chain by this code.
// Wallet connect (Keplr) = identity + storage only. Payment = buyer sends
// ATOM themselves in TWO sends (seller net + CEO fee), submits both TXIDs,
// admin checks both on the explorer, then the hero moves.
// Real mainnet needs: CosmWasm escrow, audit, legal review, automatic on-chain verification.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PORT = parseInt(process.env.PORT || '3000', 10);
const ADMIN_KEY = process.env.ADMIN_KEY || '';
// CEO auth: Keplr signArbitrary (ADR-36), like Swap — you sign, nothing moves
// without your keys. No ADMIN_KEY is required in the UI. If ADMIN_KEY is set
// in the environment it is kept only as an emergency fallback for admin calls.
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
// Verify a Keplr signArbitrary (ADR-36) signature over `message` (plain text).
// Returns true only if the pubkey derives to `address` and the signature
// verifies over the ADR-36 amino doc for that message.
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
// "<path>\n<canonical body>\n<timestamp>". Timestamp must be within 5 min,
// so an old signature cannot be replayed forever, and the signature binds
// the exact action — like Swap, you sign every trade, here every CEO action.
function isCeoRequest(req, bodyForMessage) {
  if (ADMIN_KEY && req.headers['x-admin-key'] === ADMIN_KEY) return true;
  const address = req.headers['x-ceo-address'], sig = req.headers['x-ceo-signature'], pub = req.headers['x-ceo-pubkey'], ts = Number(req.headers['x-ceo-timestamp']);
  if (!address || !sig || !pub || !isFinite(ts)) return false;
  if (address !== CEO_ADDRESS) return false;
  if (Math.abs(Date.now() - ts) > CEO_SESSION_TTL_MS) return false;
  const u = new URL(req.url, 'http://x');
  const message = u.pathname + '\n' + canonicalJson(bodyForMessage || {}) + '\n' + String(ts);
  return verifyAdr36(address, message, sig, pub);
}
const MODE = (process.env.MODE || 'demo').toLowerCase();
const EXPLORER = process.env.EXPLORER_TX_URL || 'https://www.mintscan.io/cosmos/txs/';
const CHAIN_ID = process.env.CHAIN_ID || 'cosmoshub-4';
let FEE_PERCENT = parseFloat(process.env.FEE_PERCENT || '5');
if (!isFinite(FEE_PERCENT)) FEE_PERCENT = 5;
FEE_PERCENT = Math.min(7, Math.max(4, FEE_PERCENT));
const CEO_ADDRESS = process.env.CEO_ADDRESS || 'cosmos1cccccccccccccccccccccccccccccccccccccc';
const IS_VERCEL = !!process.env.VERCEL;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
// Vercel serverless functions run on a read-only filesystem: creating a
// data folder crashes the whole function (500). On Vercel, storage is
// in-memory only (see load()/save()), so skip the folder entirely there.
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
function uid(p) { return p + '_' + crypto.randomBytes(6).toString('hex'); }
function isAddress(a) { return typeof a === 'string' && /^cosmos1[0-9a-z]{38,45}$/.test(a); }
function isTxid(t) { return typeof t === 'string' && /^[0-9a-fA-F]{64}$/.test(t); }
function round6(n) { return Math.round(n * 1e6) / 1e6; }
function levelForXp(xp) { return Math.min(20, 1 + Math.floor((xp || 0) / 400)); }
function load() { if (IS_VERCEL) return { players: {}, heroes: [], listings: [], sales: [], usedTxids: [], duels: [] }; try { const d = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); if (d && Array.isArray(d.heroes)) { d.duels = d.duels || []; d.usedTxids = d.usedTxids || []; return d; } } catch {} return { players: {}, heroes: [], listings: [], sales: [], usedTxids: [], duels: [] }; }
function save(db) { if (IS_VERCEL) return; fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
let db = load();
function send(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }
function readBody(req) { return new Promise((resolve) => { let s=''; req.on('data', c=>s+=c); req.on('end', ()=>{ try{ resolve(s?JSON.parse(s):{}); }catch{ resolve({}); } }); }); }
const MIME = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.json':'application/json', '.png':'image/png' };
function leaderboard() { return Object.values(db.players).map(p=>({ address: p.address, name: p.name, level: levelForXp(p.xp||0), xp: p.xp||0, bestScore: p.bestScore||0, wins: p.wins||0, losses: p.losses||0, games: p.gamesPlayed||0, heroes: db.heroes.filter(h=>h.owner===p.address).length })).sort((a,b)=> b.bestScore-a.bestScore || b.level-a.level); }
async function handle(req, res) {
  const u = new URL(req.url, 'http://x'); const p = u.pathname;
  if (p === '/api/config') return send(res, 200, { mode: MODE, chainId: CHAIN_ID, explorerTxUrl: EXPLORER, walletConnect: true, demoOnly: true, feePercent: FEE_PERCENT, ceoAddress: CEO_ADDRESS, heroDefs: HERO_DEFS, platform: 'GAME', domain: 'game.atomstaking.app', games: [{id:'defend-atom',name:'Defend ATOM',status:'playable',tagline:'Defend the ATOM core from layered space monsters.'},{id:'space-shooter',name:'Space Shooter',status:'coming-soon'},{id:'asteroid-miner',name:'Asteroid Miner',status:'coming-soon'},{id:'validator-runner',name:'Validator Runner',status:'coming-soon'}], unlockLevels: UNLOCK });
  if (p === '/api/state') return send(res, 200, { mode: MODE, chainId: CHAIN_ID, explorerTxUrl: EXPLORER, feePercent: FEE_PERCENT, ceoAddress: CEO_ADDRESS, players: Object.values(db.players).map(x=>({address:x.address, name:x.name, credits:x.credits||0, xp:x.xp||0, level:levelForXp(x.xp||0), bestScore:x.bestScore||0})), heroes: db.heroes, listings: db.listings.filter(l=>l.status!=='closed'), sales: db.sales.map(s=>({...s, txidMasked: s.txid ? s.txid.slice(0,10)+'…'+s.txid.slice(-6) : ''})), leaderboard: leaderboard() });
  if (p === '/api/leaderboard') return send(res, 200, { leaderboard: leaderboard(), feePercent: FEE_PERCENT });
  if (req.method === 'POST' && p === '/api/player') { const b = await readBody(req); if (!isAddress(b.address)) return send(res, 400, { error: 'Need a valid Cosmos address (cosmos1...). Connect Keplr, or paste a valid address in demo mode.' }); if (!db.players[b.address]) db.players[b.address] = { address: b.address, name: String(b.name||'Player').slice(0,40), credits: 1000, xp: 0, bestScore: 0, wins: 0, losses: 0, gamesPlayed: 0, createdAt: new Date().toISOString() }; else if (b.name) db.players[b.address].name = String(b.name).slice(0,40); save(db); const pl=db.players[b.address]; return send(res, 200, { player: {...pl, level: levelForXp(pl.xp||0)}, heroes: db.heroes.filter(h=>h.owner===b.address) }); }
  if (req.method === 'POST' && p === '/api/progress') { const b = await readBody(req); const pl = db.players[b.address]; if (!pl) return send(res, 400, { error: 'Connect wallet / create player first.' }); const score = Math.max(0, Math.min(100000, Number(b.score)||0)); const wave = Math.max(0, Math.min(20, Number(b.waveReached)||0)); const won = !!b.won; const oldLevel = levelForXp(pl.xp||0); const xpGain = wave*40 + Math.floor(score/20); const creditGain = wave*20 + (won?100:0); pl.xp=(pl.xp||0)+xpGain; pl.credits=(pl.credits||0)+creditGain; pl.gamesPlayed=(pl.gamesPlayed||0)+1; if (score>(pl.bestScore||0)) pl.bestScore=score; const newLevel = levelForXp(pl.xp); const unlocked = HERO_DEFS.filter(d=>d.unlockLevel>oldLevel && d.unlockLevel<=newLevel).map(d=>d.id); save(db); return send(res, 200, { player: {...pl, level:newLevel}, xpGain, creditGain, unlocked }); }
  if (req.method === 'POST' && p === '/api/heroes/demo') { const b = await readBody(req); if (!isAddress(b.address) || !db.players[b.address]) return send(res, 400, { error: 'Connect wallet / create player first.' }); const def = HERO_DEFS.find(d=>d.id===b.defId) || HERO_DEFS[5]; const lvl = levelForXp(db.players[b.address].xp||0); if (lvl < def.unlockLevel) return send(res, 403, { error: def.name+' unlocks at level '+def.unlockLevel+'. You are level '+lvl+'. Play waves to earn XP.' }); const hero = { id: uid('hero'), defId: def.id, name: def.name, rarity: def.rarity, basePower: def.basePower, ability: def.ability, color: def.color, tagline: def.tagline, level: 1, owner: b.address, isDemo: true, createdAt: new Date().toISOString() }; db.heroes.push(hero); save(db); return send(res, 200, { hero }); }
  if (req.method === 'POST' && p === '/api/heroes/upgrade') { const b = await readBody(req); const hero = db.heroes.find(h=>h.id===b.heroId); if (!hero) return send(res, 404, { error: 'Hero not found' }); if (hero.owner !== b.address) return send(res, 403, { error: 'You do not own this hero' }); const cost = 200 * hero.level; const pl = db.players[b.address]; if (!pl || (pl.credits||0) < cost) return send(res, 400, { error: 'Not enough in-game credits. Cost: '+cost }); pl.credits -= cost; hero.level += 1; save(db); return send(res, 200, { hero, credits: pl.credits }); }
  if (req.method === 'POST' && p === '/api/listings') { const b = await readBody(req); const hero = db.heroes.find(h=>h.id===b.heroId); if (!hero) return send(res, 404, { error: 'Hero not found' }); if (hero.owner !== b.address) return send(res, 403, { error: 'You do not own this hero' }); if (db.listings.some(l=>l.heroId===hero.id && l.status==='active')) return send(res, 400, { error: 'Already listed' }); const price = Number(b.priceAtom); if (!isFinite(price) || price <= 0 || price > 100000) return send(res, 400, { error: 'Price must be > 0 ATOM' }); if (!isAddress(b.sellerAddress)) return send(res, 400, { error: 'Seller Cosmos address required (your connected wallet address). Do NOT send real ATOM in demo mode.' }); const fee = round6(price * FEE_PERCENT / 100); const listing = { id: uid('list'), heroId: hero.id, heroName: hero.name, rarity: hero.rarity, level: hero.level, priceAtom: price, sellerAmount: round6(price-fee), ceoFee: fee, feePercent: FEE_PERCENT, ceoAddress: CEO_ADDRESS, sellerAddress: b.sellerAddress, sellerName: (db.players[b.address]||{}).name||'Seller', status: 'active', createdAt: new Date().toISOString() }; db.listings.push(listing); save(db); return send(res, 200, { listing }); }
  if (req.method === 'POST' && p === '/api/buy') { const b = await readBody(req); const listing = db.listings.find(l=>l.id===b.listingId); if (!listing || listing.status !== 'active') return send(res, 400, { error: 'Listing not active' }); if (!isAddress(b.buyerAddress)) return send(res, 400, { error: 'Buyer Cosmos address required (connected wallet).' }); if (b.buyerAddress === listing.sellerAddress) return send(res, 400, { error: 'Buyer and seller addresses are the same.' }); if (!isTxid(b.txid) || !isTxid(b.txidFee)) return send(res, 400, { error: 'Two TXIDs required: seller send + CEO fee send, each 64 hex characters.' }); const tx = b.txid.toLowerCase(), txF = b.txidFee.toLowerCase(); if (tx === txF) return send(res, 400, { error: 'Seller TXID and fee TXID must be different sends.' }); if (db.usedTxids.includes(tx) || db.usedTxids.includes(txF)) return send(res, 400, { error: 'A TXID was already used for another sale.' }); if (Number(b.amountAtom) !== Number(listing.sellerAmount) || Number(b.feeAmount) !== Number(listing.ceoFee)) return send(res, 400, { error: 'Amounts must match exactly: seller '+listing.sellerAmount+' ATOM + CEO fee '+listing.ceoFee+' ATOM = '+listing.priceAtom+' ATOM total.' }); if (String(b.memo||'').trim() !== listing.id) return send(res, 400, { error: 'Memo must be exactly the listing ID: '+listing.id }); const sale = { id: uid('sale'), listingId: listing.id, heroId: listing.heroId, heroName: listing.heroName, priceAtom: listing.priceAtom, sellerAmount: listing.sellerAmount, ceoFee: listing.ceoFee, feePercent: listing.feePercent, sellerAddress: listing.sellerAddress, ceoAddress: listing.ceoAddress, buyerAddress: b.buyerAddress, txid: tx, txidFee: txF, amountAtom: Number(b.amountAtom), feeAmount: Number(b.feeAmount), memo: listing.id, status: 'pending', explorerUrl: EXPLORER + tx, explorerFeeUrl: EXPLORER + txF, createdAt: new Date().toISOString() }; listing.status = 'reserved'; db.sales.push(sale); db.usedTxids.push(tx, txF); save(db); return send(res, 200, { sale, note: 'Pending admin check of BOTH sends. No hero moved yet.' }); }
  if (req.method === 'POST' && p === '/api/duels') { const b = await readBody(req); if (!db.players[b.challengerAddress] || !db.players[b.rivalAddress]) return send(res, 400, { error: 'Both players must connect wallet first.' }); if (b.challengerAddress===b.rivalAddress) return send(res, 400, { error: 'Cannot duel yourself.' }); const duel = { id: uid('duel'), challenger: b.challengerAddress, rival: b.rivalAddress, rivalBest: db.players[b.rivalAddress].bestScore||0, status: 'pending', createdAt: new Date().toISOString() }; db.duels.push(duel); save(db); return send(res, 200, { duel }); }
  if (req.method === 'POST' && p === '/api/duels/result') { const b = await readBody(req); const duel = db.duels.find(d=>d.id===b.duelId); if (!duel || duel.status!=='pending') return send(res, 400, { error: 'Duel not pending' }); if (duel.challenger!==b.address) return send(res, 403, { error: 'Only the challenger submits the result.' }); const score = Math.max(0, Math.min(100000, Number(b.score)||0)); const won = score > duel.rivalBest; duel.status = won?'challenger_won':'challenger_lost'; duel.score=score; duel.decidedAt=new Date().toISOString(); const pl=db.players[b.address]; pl.gamesPlayed=(pl.gamesPlayed||0)+1; if (score>(pl.bestScore||0)) pl.bestScore=score; if (won){ pl.wins=(pl.wins||0)+1; pl.credits=(pl.credits||0)+150; pl.xp=(pl.xp||0)+100; } else { pl.losses=(pl.losses||0)+1; pl.xp=(pl.xp||0)+20; } save(db); return send(res, 200, { duel, won, rivalBest: duel.rivalBest }); }
  if (p === '/api/admin/pending') { if (!isCeoRequest(req, {})) return send(res, 401, { error: 'CEO wallet signature required: connect Keplr with the CEO address and sign.' }); return send(res, 200, { sales: db.sales.filter(s=>s.status==='pending'), feePercent: FEE_PERCENT, ceoAddress: CEO_ADDRESS }); }
  if (req.method === 'POST' && (p === '/api/admin/approve' || p === '/api/admin/reject')) {
    const b = await readBody(req);
    if (!isCeoRequest(req, b)) return send(res, 401, { error: 'CEO wallet signature required: connect Keplr with the CEO address and sign.' });
    const sale = db.sales.find(s=>s.id===b.saleId); if (!sale || sale.status !== 'pending') return send(res, 400, { error: 'Sale not pending' });
    const listing = db.listings.find(l=>l.id===sale.listingId); const hero = db.heroes.find(h=>h.id===sale.heroId);
    if (p === '/api/admin/approve') { if (!b.checkedAmount || !b.checkedFee || !b.checkedRecipient || !b.checkedCeo || !b.checkedMemo || !b.checkedExplorer) return send(res, 400, { error: 'Admin must tick all 6 checks: seller amount, CEO fee, seller recipient, CEO recipient, memo, explorer.' }); if (!hero) return send(res, 400, { error: 'Hero missing' }); hero.owner = sale.buyerAddress; sale.status = 'approved'; sale.decidedAt = new Date().toISOString(); if (listing) listing.status = 'closed'; save(db); return send(res, 200, { sale, hero }); }
    sale.status = 'rejected'; sale.reason = String(b.reason||'Rejected by admin').slice(0,200); sale.decidedAt = new Date().toISOString(); if (listing) listing.status = 'active'; save(db); return send(res, 200, { sale });
  }
  let file = p === '/' ? '/index.html' : p;
  const fp = path.join(__dirname, 'public', file);
  if (!fp.startsWith(path.join(__dirname, 'public'))) return send(res, 403, { error: 'bad path' });
  fs.readFile(fp, (e, data) => { if (e) return send(res, 404, { error: 'not found' }); res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'text/plain' }); res.end(data); });
}
const server = http.createServer(handle);
if (require.main === module) { server.listen(PORT, () => console.log('GAME / Defend ATOM listening on ' + PORT + ' mode=' + MODE + ' chain=' + CHAIN_ID + ' fee=' + FEE_PERCENT + '%')); }
module.exports = handle;
module.exports.default = handle;
module.exports.verifyAdr36 = verifyAdr36;
module.exports.addressFromPubkey = addressFromPubkey;

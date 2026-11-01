# GAME — game.atomstaking.app

Game engine/platform by GalacticTools (Swap + AtomStaking + GAME). Game 1: **Defend ATOM** — defend the ATOM core from space monsters, Bloons-style layered popping.

# Voidfall: Orbital Defense — Cosmos Heroes (GitHub + Railway ready)

Playable tower defense + hero marketplace. **DEMO / TEST MODE ONLY.**

## What is built
- **Play tab:** canvas tower defense, 5 towers, 20 waves, credits/lives/score, hero placement.
- **Heroes:** 6 hero types (Astra, Lyra, Koda, Nova-7, Vex, Orin). Heroes are stored under a Cosmos address, can be upgraded with in-game credits, equipped in defense, and listed for sale. Demo heroes are NOT real NFTs.
- **Wallet connect (Keplr):** Connect Keplr to store your address, name, heroes, listings and sales under that address. No seed phrase is ever requested. If Keplr is not installed, a demo address can be used in demo mode.
- **Marketplace — no wallet signing in this build, smoother manual flow:**
  1. Seller lists a hero, price in ATOM, seller address = connected wallet.
  2. Buyer sends the exact ATOM themselves from their own wallet to the seller, memo = listing ID.
  3. Buyer submits the 64-char TXID, exact amount, and memo.
  4. CEO/Admin panel: open the Mintscan explorer link, check amount / recipient / memo / confirmation, tick all 4 boxes, approve. Only then does the hero move to the buyer. Reject re-opens the listing. Duplicate TXIDs are rejected.
- **Backend:** Node.js with zero dependencies (stdlib only), JSON file storage. No real ATOM is moved, signed, or verified on-chain by this code.

## CEO fee, progression, leaderboard (v2)
- Fee: `FEE_PERCENT` default 5, clamped to 4-7. Buyer sends seller net + CEO fee in two sends, both with listing ID as memo, submits both TXIDs. Admin ticks 6 checks.
- Progression: waves earn XP/credits. Level = 1 + floor(XP/400), max 20. Heroes unlock at levels 1/3/5/8/12/15.
- Leaderboard & duels: best score, level, wins/losses. Duels are async: challenger submits a score vs rival best score, winner gets +150 credits / +100 XP (in-game only).

## Why no real ATOM yet
Manual TXID + admin approval is trust-based and can be faked, double-spent, or disputed, and payments are irreversible. A real mainnet version needs a CosmWasm escrow contract, a security audit, legal/tax review, and automatic on-chain verification (LCD/explorer API). Until then: demo / testnet only. Do NOT send real ATOM to demo addresses.

## Run locally
```bash
cp .env.example .env   # set CEO_ADDRESS to the real CEO Cosmos address
node server.js         # http://localhost:3000
```
Test flow: Connect (demo address) -> My Heroes -> Get demo hero -> List for sale -> copy listing ID -> second demo address -> Buy -> submit a 64-hex TXID + exact price + memo=listing ID -> CEO panel (connect Keplr with the CEO address, sign with your keys, ADR-36) -> tick 6 checks -> Approve -> hero owner changes.

## Push to GitHub (your account — I cannot push for you)
```bash
cd voidfall-cosmos
git init
git add .
git commit -m "GAME / Defend ATOM: playable game + hero marketplace, demo mode"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/voidfall-cosmos.git
git push -u origin main
```
Create the empty repo on github.com first, in your own account. Do not share GitHub passwords/tokens in chat.

## Deploy on Railway (not Vercel/Render, as requested)
1. railway.app -> New Project -> Deploy from GitHub repo -> pick `voidfall-cosmos`.
2. Railway detects the Dockerfile. If it asks for a start command, use `node server.js`.
3. Variables tab: set `MODE=demo`, `CHAIN_ID=cosmoshub-4`, `FEE_PERCENT=5`, `CEO_ADDRESS=<real CEO address>`. No ADMIN_KEY is needed in the UI — the CEO panel opens by signing with the CEO wallet. ADMIN_KEY, if set, is only an emergency fallback.
4. Deploy, open the Railway URL, test the flow above.
5. Note: `data/db.json` is on the container filesystem and can be lost on redeploy. For production, move storage to Railway Postgres / a volume. That is listed as a TODO in the code comments.

## Files
- `server.js` — API + static server, marketplace/admin logic
- `public/index.html`, `public/styles.css`, `public/app.js`, `public/game.js`
- `Dockerfile`, `railway.toml`, `Procfile`, `.env.example`, `.gitignore`

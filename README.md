# GAME — game.atomstaking.app

Game engine/platform by GalacticTools (Swap + AtomStaking + GAME).
One wallet, one level, one set of heroes across every game.

## Model — read this first

**No contracts.** There is no CosmWasm contract, no escrow contract, and
none is needed for this model. Payments are plain ATOM bank sends the
buyer signs in their own wallet (Keplr), exactly like the user did
in the past:

1. Seller lists a hero for X ATOM.
2. Buyer sends the **full price in ONE send to the CEO address**,
   memo = listing ID, from their own wallet (in-page Keplr send, or
   send from any wallet + submit the TXID).
3. CEO verifies the TX (on-chain auto-verify, or 4 manual checks on the
   explorer), then **one-click execute**: verify → send the seller
   their cut from the CEO wallet → move the item ID to the buyer →
   close the order.
4. CEO fee (default 5%, configurable 4–7% in the CEO panel, new
   listings only) stays with the CEO. Seller gets price − fee.

ATOM sends are **irreversible**. Always check the recipient, amount and
memo in your wallet before signing. Test with a tiny amount first.
The server never holds keys and never moves ATOM.

## Games (Engine Hub)

- **Cosmos BTD** (`public/games/cosmos-btd/`) — Bloons-style tower
  defense. Procedural canvas art (no image assets), 50 waves, boss
  every 10, 5 towers (Dart, Cannon, Sniper, Frost, Plasma Mortar),
  targeting First/Last/Strong/Weak, 1x–3x speed, auto-start, hero
  units with abilities and XP, spatial-hash collisions, pooled
  particles/projectiles, 60 FPS loop, clean `init`/`destroy` lifecycle.
- **Space Tycoon** — rigs earn while away (offline earnings capped at
  8h), overseer heroes boost output. Local save only.
- **ATOM Core Clicker** — tap the core, multiplier surges, session
  proof hash shown. Local save only.
- **Defend ATOM** — legacy canvas game (`public/game.js`, `public/app.js`);
  kept on disk, no longer the hub front end.

Shared shell (`public/engine/`): `EngineHost` (load/unload, zero-leak
teardown), `EngineEvents` bus (typed event registry), `WalletManager`
(Keplr identity, balance, ADR-36 CEO signing, real Amino send),
`RpcWatcher` (CometBFT WebSocket + REST fallback; notification only —
approval always re-checks server-side and fails closed).

## CEO panel — advanced

Opens only with the CEO wallet (ADR-36 signature per action, like
Swap). Features:

- **Orders**: pending orders with live expiry countdown (order timer,
  default 30 min, configurable 1–1440) + progress bar, 4 manual
  checks, on-chain verify, **one-click execute** (verify → send seller
  payout from CEO wallet → move item → close), approve/reject,
  record payout TXID, ban buyer.
- **Ledger**: every order, payout, fee, ban, removal and settings
  change, with totals (volume / fees / payouts) and CSV export.
- **Users**: ban/unban (banned addresses cannot play, list or buy;
  their active listings are removed), remove heroes, remove listings.
- **Flags**: anti-cheat flags from hashed wave reports (session hash +
  XP/wave rate caps) with resolve.
- **Settings**: CEO fee %, order timer, auto-verify toggle, chain/LCD
  info, RPC watcher start.
- **Audit**: every CEO action, timestamped.

Orders auto-close when the timer runs out: the listing re-opens and
the sale is marked expired (ledger records it).

## Anti-cheat (honest limits)

Each run gets a server-issued session ID + nonce. Every completed wave
produces `SHA256(sessionId:wave:pops:heroXp:nonce)`, recomputed
server-side in `/api/progress/secure` with XP-per-wave caps and a
minimum gap between waves. Mismatches are flagged and earn nothing.
This proves the submitted numbers match the hash — it does not make
client-side play unforgeable. A fully server-authoritative simulation
would be needed for that, and is not built here.

## Run locally

```bash
cp .env.example .env   # CEO_ADDRESS is already the user's address by default
node server.js         # http://localhost:3000
```

Flow to test (use tiny amounts, desktop Keplr):
Connect wallet → My Heroes → Get demo hero → Marketplace → List →
second wallet → Buy with Keplr (review address + memo in wallet) →
CEO Panel → Sign in as CEO → One-click execute → hero moves, seller
payout sent, order closes.

## What was tested locally (2026-11-01)

- `node --check` on every JS file: pass.
- Server flow test (26 checks, generated test CEO key, LCD pointed
  unreachable): config, list/buy validation, duplicate-TXID rejection,
  unsigned CEO refusal, auto-verify fail-closed, one-click execute,
  ledger totals, ban/unban, remove listing/hero, fee change, secure
  progress good-hash credit + tampered-hash flag: **all pass**.
- BTD harness (stub DOM/canvas): tower placement cost, firing, pops,
  score, wave-clear bonus, upgrade/sell placement, destroy cancels
  the animation frame: **pass**.
- Live serve check: `/`, `/api/config`, `/api/state`, hub CSS/JS and
  game files all return 200; config shows the real CEO address.

## v3.9.0 — 2026-11-01 (5 more, 91 tracked features)

Batch 10 (Space Shooter depth): drone/boss power-up drops (shield, rapid fire, spread shot, extra life), boss drone every 5 waves with a health bar, combo multiplier up to x3 (shield blocks preserve it), touch controls (virtual joystick + FIRE button on canvas), and a server shooter leaderboard (per-game bests via /api/progress, Shooter filter in Top Players). Tests: server 29/29, BTD 146/146, shooter harness pass incl. Batch 10 checks.

## v3.8.1 — 2026-11-01 (1 more, 86 tracked features)

Keplr only: the other wallet option was removed from the UI, wallet detection, signing and all wording. Players connect with Keplr.

## v3.8.0 — 2026-11-01 (9 more, 85 tracked features)

LEVEL UP launcher look: 3-column layout (nav rail / stage / profile rail), featured Cosmos BTD hero, game cards with an info window, Recently Played, Find Games search, separate Keplr/Leap connect buttons with sticky provider signing, demo mode removed, CEO side tabs, space ATOM-orb battlefield. Link previews: Open Graph + Twitter tags with the battlefield image (1600x900) and platform description.

## v3.6.0 — 2026-11-01 (5 more, 71 tracked features)

Batch 8 (BTD depth II): mortar/cannon splash preview ring while
placing, Sell button shows the exact refund, hero ability cooldown bar
with seconds left, +25g wave-skip bonus for manual early starts
(auto-start never pays), motion streaks on fast Pink/Zebra balloons.
Tests: server 25/25, BTD 129/129, shooter pass.

## v3.5.0 — 2026-11-01 (3 more, 66 tracked features)

Pillar 5 (runtime & dev tools): custom-track map editor, debug
console + performance monitor, JSON mod loader. Tests: server 25/25,
BTD 116/116, shooter pass.

## v3.4.0 — 2026-11-01 (9 more, 63 tracked features)

Track 3 items 141–150 (mega-list), gaps only — branching trees (143)
and hero commander patrol (144) were already delivered by Batch 6
(Pillar 4, v3.3.0) and are not double-counted here: multi-lane fork
path (every 3rd balloon takes a branch lane, rejoins at 85%),
Closest/Elite targeting, status effects (burn/poison/stun/shred),
Synergy Beacon tower, boss phase shields + minions, logarithmic
endless scaling past wave 50, hero radial cooldown ring, FCT physics
arcs + crit rolls, action-bar branch/patrol controls. Tests: server
25/25, BTD 86/86, shooter pass.

## v3.3.0 — 2026-11-01 (4 more, 54 tracked features)

Pillar 4: branching tower upgrade trees (Rapid Fire / Heavy Impact,
3 points, locked path, Lv4 Evolved / Lv5 Ascended), hero commander
(patrol, +3 XP/kill, ability tiers, weapon/charm gear), hazard zones
with lateral detours + wave-variant routing, storm/blizzard weather.
Tests: server 25/25, BTD 59/59, shooter pass.

## v3.2.0 — 2026-11-01 (5 more, 50 tracked features)

Pillar 3: glassmorphism theme engine, floating combat text,
inspection stat cards, settings (FPS target, particle density,
motion blur, HiDPI display scale), ECS-table iteration. Tests:
server 25/25, BTD 34/34, shooter pass.

## v3.1.0 — 2026-11-01 (11 more, 45 tracked features)

Pillars 1+2: bloom glow pass, dynamic 2D lighting, vignette + danger
pulse, tilt-shift DoF bands, animated water shader, particle engine,
contextual shake; ECS + fixed 60Hz timestep + AssetManager + spatial-hash
stats. Settings gained PostFX / tilt-shift toggles. Tests: server 25/25,
BTD 27/27, shooter pass. Normal maps + GPU particles deferred (WebGL).

## v3.0.0 — 2026-11-01 (34 tracked features)

- Cosmos BTD: Tesla Coil + Spike Factory towers, Camo/Fortified/Regen
  enemies, endless mode, pause, in-run hero leveling, image sprites
  (battlefield photo, monster/tower/hero art) with procedural fallback,
  damage numbers, Lv 5 MAX upgrades, wave-clear interest, touch support,
  FPS counter + quality setting, boss shields (wave 30+), challenge mode.
- Platform: daily quests, 12 achievements, CEO announcements, player
  stats (best wave, total pops, per-game bests), per-game leaderboard,
  `/api/health`, feature tracker at `/features.json` + What's New view.
- Games: Space Shooter added (4th playable game).
- Hub UI: announcements banner, profile/quests/achievements sidebar,
  marketplace search/filter/sort, settings panel, leaderboard tabs,
  action-bar controls (pause/endless/challenge/shortcuts), CEO Announce tab.
- Tests: server flow 25/25, BTD harness 18/18, Space Shooter harness
  all checks pass. See `FEATURES.md` for the per-feature registry and
  `IMPROVEMENT_BACKLOG.md` for the next batches the auto-improve loop
  works through every 10 minutes.

## NOT tested

- Real Keplr/Leap send (`sendAtom`) with a real wallet — the code is
  written (Amino sign + broadcast) but untested end-to-end. Test with
  a tiny amount on desktop first.
- Real LCD/WebSocket auto-verify against the live chain — depends on
  public endpoints; the server fails closed when they are unreachable.
- Order expiry sweep over a real 30-minute wait (logic runs on every
  request; `secondsLeft` was verified in tests).
- Vercel deployment of this build, and the `game.atomstaking.app`
  domain (still "DNS Change Recommended" — CNAME target change pending).

## Deploy (Vercel, existing project `game-engine`)

Push `game-engine` to GitHub (`Galactic0017/game-engine`, main) and
redeploy the existing Vercel project. Set env vars in Vercel:
`MODE=demo`, `CHAIN_ID=cosmoshub-4`, `FEE_PERCENT=5`,
`CEO_ADDRESS=cosmos1pyp3wd7dsa7zmu7ges2dar2e6lk77lfa9qchlm`,
`ORDER_TTL_MINUTES=30`. No `ADMIN_KEY` is needed. Storage on Vercel
is in-memory (data resets on redeploy/instance recycle) — move to a
real database before treating sales history as permanent.

## Files

- `server.js` — API + static server, CEO-escrow marketplace, ledger,
  bans, flags, anti-cheat, settings, audit. Zero dependencies.
- `public/index.html`, `public/hub.css` — Engine Hub shell UI.
- `public/engine/` — event-bus, wallet, engine-host, rpc-watcher,
  shell, marketplace-ui, ceo-ui.
- `public/games/` — cosmos-btd, space-tycoon, atom-clicker.
- `public/game.js`, `public/app.js`, `public/styles.css` — legacy
  Defend ATOM front end (kept, not loaded by the hub).
- `Dockerfile`, `railway.toml`, `Procfile`, `.env.example` — legacy
  deploy files; current target is Vercel (see `vercel.json`).

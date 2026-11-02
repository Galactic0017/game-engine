# IMPROVEMENT BACKLOG — worked top-down by the auto-improve loop

Rules for every batch (no exceptions):
- Implement only the batch's items. Small, additive, tested changes.
- Run `node --check` on every changed JS file, the server flow test,
  and the BTD/Shooter harnesses. All must pass before pushing.
- Update `public/features.json` (new entries, honest `tested` notes)
  and this file (mark the batch DONE with date + test result).
- Push changed files to GitHub `Galactic0017/game-engine` (main) via a
  browser task with the saved GitHub login. Never touch Vercel settings,
  env vars, domains, or the CEO address. Vercel auto-deploys on push.
- Verify live `/api/config` shows the new version (bump `VERSION` in
  `server.js` + manifest versions for changed games, e.g. 3.2.0).
- Never claim a feature exists unless it is built, tested, and live.
- If a push or live check fails, log it here, do NOT retry in the same
  run, and try again next run. Never ask the user for codes.
- Stop conditions: user says stop; or a batch breaks the live site
  (then revert the batch's push and report it).
- Overlap lock: `~/workspace/game-engine/.improve-lock` — if a manual
  build is in progress (lock file <60 min old), end silently.

## Pillar direction (user, 2026-11-01 14:10 EST)
Upgrade game.atomstaking.app into a commercial-feeling engine: 5 pillars.
Pillars 1+2 were built first (Batch 4). Pillars 3, 4, 5 follow as
Batches 5, 6, 7. Honest scope notes: canvas 2D, not WebGL/Unreal.
Normal maps + true GPU particles need a WebGL renderer — NOT faked;
they stay queued as research items, never claimed.

## Batch 4 — DONE 2026-11-01 — v3.1.0 (11 features, 45 total)
Pillar 1 visuals: bloom glow pass, dynamic 2D lighting, vignette +
danger pulse, tilt-shift DoF bands, animated water shader, particle
engine (spark/smoke/ring/splash + wind), contextual screen shake.
Pillar 2 core: ECS (component tables + Movement/Combat/Projectile/Fx/
Spike systems), fixed 60Hz timestep + render interpolation, AssetManager
(queue + pre-decode + retry), spatial-hash stats in HUD. Shell settings
gained PostFX + tilt-shift toggles.
Tests: server 25/25, BTD 27/27, shooter harness all pass; serve 200s.
Limits: DoF/water/lighting visual quality not browser-verified;
danger pulse code-reviewed only; normal maps deferred (see above).

## Batch 5 — DONE 2026-11-01 — v3.2.0 (5 features, 50 total)
Pillar 3: Engine UI/UX Framework
- [x] Glassmorphism theme engine: unified reactive UI layer (translucent
      dark glass, backdrop blur, glowing borders, dynamic font scaling,
      hover/click sound feedback) across hub + CEO panel.
- [x] Floating combat text: damage numbers, crits, coin gains with
      gravity + fade (build on existing floaters).
- [x] Inspection stat cards: hover any tower/unit opens a card with
      animated stat bars, upgrade tree, tactical effectiveness chart.
- [x] Settings modal: FPS target (30/60/120), motion blur toggle,
      particle density (Low/Med/High), master audio, display scaling
      (Retina/HiDPI canvas scaling).
- [x] ECS remainder: migrate balloons/towers to id-array iteration
      (component tables as the single iteration source), harness-gated.
Tests: server 25/25, BTD 34/34, shooter pass; serve 200s.
Limits: shell/modal/inspect-card DOM rendering + glass visuals are
code-reviewed only (no browser/DOM harness for the shell); 120 FPS is
a cap only, display refresh limits it; motion blur is projectile/beam
streaks, not a frame-blur pass; strokeText guarded for minimal canvas
impls. CEO panel itself unchanged (glass applies via shared hub.css).

## Batch 6 — DONE 2026-11-01 — v3.3.0 (4 features, 54 total)
Pillar 4: Deep Gameplay & Progression
- [x] Branching tower upgrade trees: 2 paths per tower (Rapid Fire /
      Heavy Impact, 3 points, one locked path, Lv2+ to choose),
      Evolved at Lv4 / Ascended at Lv5 (larger sprite + ring).
- [x] Hero Commander system: patrol mode walks the spline, XP per
      hero kill (+3), ability tiers 1-3 by run level, weapon/charm
      equipment slots (in-run only, no server persistence).
- [x] Adaptive AI pathfinding: mud/bramble hazard zones on the
      Catmull-Rom spline slow balloons + trigger lateral detours;
      every 10th wave takes a wide high-road offset. Not A*; towers
      cannot block the path, so no tower-avoidance reroute.
- [x] Environment & weather hazards: thunderstorm lightning strikes
      near towers every 2s, blizzard slows all balloons to 70%;
      auto-triggered on waves %5 (storm) / %10 (blizzard), 8s.
Tests: server 25/25, BTD 59/59, shooter pass; serve 200s.
Limits: branch buttons are API + inspect-card only (no dedicated
shell buttons yet); gear/patrol visuals are labels + movement only;
weather visuals are HUD label + lightning effects, no rain/snow
particle layer; hazard detour is a lateral offset, not replanning.

## Track 3 (141–150) — DONE 2026-11-01 — v3.4.0 (9 features, 63 total)
Mega-list Track 3: Tower Defense Deep Mechanics. Items 143 (branching
trees) and 144 (hero commander) were already delivered by Batch 6
(v3.3.0) and are NOT double-counted here; the remaining gaps were
built on top of Batch 6 in this batch.
- [x] Multi-lane splitting paths: fork at 45%, rejoin at 85%; every
      3rd spawn takes the branch lane; placement blocking + ghost
      respect both lanes; branch gravel drawn in the background.
- [x] Advanced targeting AI: Closest + Elite-only modes added to
      First/Last/Strong/Weak; shell select + API whitelist updated.
- [x] Hero radial cooldowns: circular sweep ring around the hero
      during the 12s ability recharge; heroCd exposed in HUD.
- [x] Boss phase shields: 50% health triggers a 3s shield + 2 Pink
      minions; segmented 5-bar boss health display.
- [x] Logarithmic endless scaling: waves 50+ gain log layers (cap +6)
      and speed; bosses +2 layers/wave past 50.
- [x] Floating combat text: physics arcs (vx drift + gravity) and
      10% crit rolls (+1 dmg, CRIT label). Coin/damage kinds existed
      from Pillar 3.
- [x] Tower synergy buff nodes: Synergy Beacon (200g, key 8), no
      attack; nearby towers fire 0.80x/0.72x/0.65x by beacon level.
- [x] Status effect stacking: burn (mortar), poison (tesla), stun
      (sniper), shred (power-branch hits bypass lead/fortified);
      burn/poison tick 1 layer/s, stun freezes, colored status dots.
- [x] Branch + patrol controls in the shell action bar (branch
      buttons with cost/locked states, hero patrol toggle).
Tests: server 25/25 (1 failure before features.json bump — resolved),
BTD 86/86, shooter pass. Limits: lane visuals share main-path art;
radial ring + status dots canvas-only (no browser screenshot check).

## Batch 7 — DONE 2026-11-01 — v3.5.0 (3 features, 66 total)
Pillar 5: Runtime & Developer Tools
- [x] Level / map editor mode: Dev Tools tab to edit the Catmull-Rom
      control points, place tree/rock/pond terrain, mark spawn/finish
      (exported), export maps as clean JSON, apply live, reset default.
      Track rebuild re-samples the spline + hazards + branch lane.
- [x] Debug console + performance monitor: `~` overlay with 60-frame
      FPS graph, frame time (avg/max), entity/particle/grid counts,
      JS heap when exposed, command line (help/fps/stats/entities/
      mem/version/clear, no eval).
- [x] Modding & config loader: JSON mods (v1) add towers, enemies and
      wave compositions to the live BTD game — validated, no code
      execution, browser-local only; example mod included in the UI.
Tests: server 25/25, BTD 116/116, shooter pass; serve 200s.
Limits: editor/mod/overlay DOM wiring is code-reviewed only (no
browser/DOM harness for the shell); heap shows n/a outside Chrome;
custom tracks keep the fixed branch-lane shape (fork 45%/rejoin 85%).
Reconciliation: at this run's start the local copy already reported
v3.4.0 / 63 features (9 BTD depth features, BTD harness 86 checks)
while live was v3.3.0 and this backlog stopped at 54 — that v3.4.0
build was tested locally, never pushed, and never logged. It ships
with this push under v3.5.0; the 9 features were already listed in
public/features.json and are real code in btd.js/shell.js.

## Batch 8 — DONE 2026-11-01 — v3.6.0 (5 features, 71 total)
BTD depth II
- [x] Mortar target preview: dashed splash ring (82 mortar / 58 cannon) at the cursor while placing a splash tower; `placingSplash` in HUD.
- [x] Tower sell preview: Sell button shows the exact refund from the inspect payload (e.g. +70g for a base dart tower), else "Sell 70%".
- [x] Hero ability cooldown bar in the action bar: fill + seconds-left label (max 12/9/7s by ability tier, `heroCdMax` in HUD).
- [x] Wave skip bonus: +25 gold for a manual start between waves after wave 1; auto-start and wave 1 pay nothing; counters in HUD/state, cleared on reset.
- [x] Balloon speed lines: Pink (112) / Zebra (96) balloons draw 3 trailing streaks; slower balloons and bosses draw none.
Tests: server 25/25, BTD 129/129, shooter pass; serve 200s (server test covers homepage/config/features/shooter).
Limits: splash ring + speed lines are canvas draw code, harness-verified via helpers/state only (no browser screenshot check); cooldown bar + sell label are shell DOM, code-reviewed only.

## Batch 9 — DONE 2026-11-01 — v3.7.0 (5 features, 76 total)
Visuals
- [x] Tower muzzle flash + recoil animation on fire (barrel kick): recoil=1 on every shot, decays in CombatSystem, 5px kick along the firing angle + muzzle star while flash>0; sprite + procedural branches.
- [x] Leak warning: screen edge flashes red at 80% path progress: furthest live balloon's lane fraction; pulsing red border + banner; suppressed once won/lost; `leakWarning`/`leakProgress` in HUD + state.
- [x] Victory/defeat end screens with run stats (waves, pops, score, gold, time, hero kills): run clock starts at wave 1, freezes on win/loss; `runSummary` in HUD + state; R restart clears it.
- [x] Animated starfield behind the hub header (CSS only, respects Low quality): two tiled gradient star layers drifting; `body[data-quality="low"]` (set by the shell from Graphics quality) + prefers-reduced-motion freeze the animation.
- [x] Hero portrait glow for the equipped hero in the sidebar: `.equipped` class on the hero card + pulsing gold glow on the portrait.
Tests: server 25/25, BTD 146/146, shooter pass; serve 200s (server test covers homepage/config/features/shooter).
Limits: flash/recoil + leak edge + end-screen panel are canvas draw code, harness-verified via helpers/state only (no browser screenshot check); starfield + hero glow are CSS/DOM, code-reviewed only.

## LEVEL UP redesign — DONE 2026-11-01 — v3.8.0 (9 features, 85 total)
- [x] LEVEL UP 3-column launcher layout + featured hero + game cards + info window + Recently Played + Find Games search.
- [x] Wallet provider choice (Keplr/Leap, sticky signing) + no-demo real players + CEO side tabs.
- [x] Space ATOM look (energy lane + ATOM orb) + link preview OG/Twitter tags (battlefield.jpg 1600x900).
- Tests: server 25/25, BTD harness, shooter pass; serve 200s incl. OG tags + image.
- Limits: launcher/modal/rail rendering code-reviewed + serve-checked (no browser screenshot/click check); wallet harness covers provider choice, not a real wallet send.

## Keplr-only — DONE 2026-11-01 — v3.8.1 (1 feature, 86 total)
- [x] Other wallet option removed everywhere; Keplr only (button, detection, signing, wording, stored sessions).
- Tests: server 25/25, BTD harness, shooter pass; wallet harness Keplr-only.
- Limits: wallet harness covers provider detection, not a real wallet send.

## Batch 10 — DONE 2026-11-01 — v3.9.0 (5 features, 91 total)
Space Shooter depth (was Batch 6)
- [x] Power-ups: shield (absorbs one hit), rapid fire (6s), spread shot (8s, 3 bullets), extra life — 22% drop from drones, 2 drops from bosses; distinct on-canvas icons (S/R/W/+).
- [x] Boss drone every 5 waves with a health bar: 20+2/wave HP, 3-bolt fan, 500 pts (combo-multiplied), wave cannot clear while it lives; health bar above the playfield.
- [x] Combo multiplier for consecutive kills without taking damage: +0.5x per 5 combo, capped x3; a lost life resets it, a shield block preserves it; shown in HUD + top bar + game-over screen.
- [x] Touch controls: virtual joystick (left half, anchored at touch point) + FIRE button (right half) drawn on the canvas, multi-touch by identifier; listeners removed on destroy.
- [x] Shooter leaderboard: best score per player on the server — /api/progress accepts game=space-shooter (per-game bests; BTD bestScore/bestWave untouched, unknown game falls back to BTD), shell submits only the final game-over emit (dedupe by address+score+wave+kills), Top Players rail gains a Shooter filter.
Tests: server 29/29 (25 prior + 4 shooter), BTD 146/146, shooter harness pass incl. Batch 10 checks (combo 275, shield block, 4 power-up kinds, boss kill 750+350 wave-clear, joystick + fire). Serve check pending at push time; live /api/config verification after push.
Limits: power-up/boss/combo/touch visuals are canvas code, harness-verified via state/HUD only (no browser screenshot or real-device touch check); shooter submission uses legacy /api/progress, not the hashed secure path (BTD-only); shell submission + leaderboard filter are code-reviewed only (no shell DOM harness).

## Cleanup + tags — DONE 2026-11-01 — v3.15.2 (4 features, 118 total)
- [x] Game tags (manifests + server config + registry), tag chips on cards/info window, tag filter row, search matches tags.
- [x] Engine open fail-safe: failed module load throws before the engine marks it open; shell clears the viewport on open failure.
- [x] Legacy cleanup: deleted public/app.js, public/game.js, public/styles.css, Dockerfile, Procfile, railway.toml; removed the legacy Defend ATOM config entry; fixed the stale demo description in package.json.
- Tests: server 25/25, BTD harness, shooter pass, wallet harness, tags harness, serve 200s.
- Limits: tag chips/filter rendering code-reviewed only (no browser screenshot); tag filter state is not persisted.

## Batch 11 — DONE 2026-11-01 — v3.10.0 (4 features, 95 total)
Platform & social (was Batch 7)
- [x] Friend challenges: send a duel invite by address, async results.
- [x] Seasonal ladder: monthly leaderboard reset + badge for top 3.
- [x] Share card: PNG snapshot of a run (canvas toDataURL) to download.
- [x] Referral code in profile: track invited addresses (no payouts).
Tests: server 48/48, BTD 146/146, shooter pass; serve 200s.
Limits: season bests recorded only from v3.10.0 on (no backfill); share card canvas code code-reviewed only, tainted canvas fails with a toast; Challenges/season/referral shell UI code-reviewed only (no browser/DOM harness); referral grants no credits to either side by design.

## Batch 12 — Marketplace depth (was Batch 8)
- [ ] Price history sparkline per hero (last 10 sales).
- [ ] Offer system: buyer makes an offer below list price, seller accepts/declines.
- [ ] Hero rental: time-boxed loan, auto-return, fee split.
- [ ] Bulk list: list several heroes in one signed batch.

## Batch 12 — DONE 2026-11-01 — v3.11.0 (4 features, 99 total)
Marketplace depth
- [x] Price history sparkline per hero (last 10 closed sales per hero type, last/avg/count; SVG sparkline under each listing price; history endpoint + /api/state priceHistory).
- [x] Offer system: buyer offers below list price, seller accepts/declines; accept reprices the listing to the offer, reserves it for that buyer (other buyers get 400 on /api/buy), supersedes other pending offers; accepted offers expire with the order timer and restore the original price.
- [x] Hero rental: owner lists a hero for a total price over 1–30 days; renter sends the full price to the CEO address (memo = rental ID) via the same escrow request flow; CEO verify/execute endpoints start the loan with the same fee split; active loans auto-return on expiry (sweep on every request); rented/listed heroes cannot do the other.
- [x] Bulk list: up to 10 owned heroes in one batch, validated first (atomic — one bad hero lists nothing), via /api/listings/bulk + marketplace form.
Tests: server 73/73 (48 prior + 25 Batch 12), BTD 146/146, shooter pass; serve 200s.
Limits: rental CEO execute + auto-return sweep code-reviewed only (CEO-signed, no test keys in harness); offer/rental/sparkline/bulk shell + CEO-panel UI code-reviewed only (no browser/DOM harness); price history records only on CEO approve/execute, not pending orders; rented heroes show in the marketplace, in-game equip of a rented hero is not yet wired.

## Batch 13 — CEO tools II (was Batch 9)
- [ ] Dispute queue: flagged orders get a dedicated review view.
- [ ] Fee analytics chart: fees/volume by day (canvas chart, no deps).
- [ ] Scheduled announcements: post at a chosen time (server timer).
- [ ] Export full ledger to CSV from the CEO panel (already per-kind; add all).

## Batch 13 — DONE 2026-11-01 — v3.12.0 (4 features, 103 total)
CEO tools II
- [x] Dispute queue: CEO-signed flag/resolve on any order (marker on the sale + matching `order-dispute` flag); dedicated Disputes tab lists open disputes + unresolved dispute flags; a dispute changes nothing about the order timer or the escrow model — the order still executes/rejects via the normal paths.
- [x] Fee analytics: CEO-signed `/api/admin/analytics` aggregates closed sales + started rentals by UTC day (volume/fees/orders/rentals/payouts, 7/14/30-day windows); CEO panel Analytics tab draws a canvas bar chart (volume + fees, no deps) with the same numbers in a day table.
- [x] Scheduled announcements: CEO-signed schedule/cancel + list; due posts publish via a sweep on every request (same pattern as order expiry) plus a 60s timer on the standalone server; cap 20 scheduled; past times rejected.
- [x] Full ledger export: ledger limit raised 200-default/500-cap to 5000-cap; CEO panel "Export FULL ledger (all kinds)" fetches all entries regardless of the kind filter and downloads one CSV with the union of all entry fields; the per-kind filtered export is unchanged.
Tests: server 94/94 (73 prior + 21 Batch 13, CEO endpoints exercised via the ADMIN_KEY test bypass in the local harness only), BTD 146/146, shooter pass; serve 200s (config 3.12.0, features.json 103, Batch 13 markers in served ceo-ui.js).
Limits: dispute/analytics/schedule/ledger-export shell UI code-reviewed only (no browser/DOM harness); scheduled posts on Vercel publish on the first request after their due time (no background job on serverless); analytics counts rentals only once started, never pending ones.

## Batch 14 — DONE 2026-11-01 — v3.13.0 (4 features, 107 total)
Asteroid Miner game
- [x] New playable module: click/drag mining (click strikes, hold-and-drag beam keeps mining the rock under the cursor), 6 ore tiers (Iron/Nickel/Cobalt/Gold/Platinum/ATOM Crystal) with the mix shifting rarer in deeper belts.
- [x] Drill upgrades: Drill Power (damage), Auto-Drill (passive DPS to the nearest rock), Scanner (+25% ore value per level), bought with banked credits via canvas buttons or keys 1/2/3; Bank (B) converts cargo ore to credits.
- [x] Asteroid belt progression: mining a belt's quota (6 + 2/belt) advances the belt with a credit bonus, tougher/more valuable rocks, more rocks on screen; belt progress bar + ore legend in the HUD.
- [x] Local save + server bests: per-address localStorage (credits, drill levels, best belt/value, total mined; upgrades persist across shifts); End Shift (E) banks cargo and emits one final game:ended, shell submits it to /api/progress as game=asteroid-miner, per-game leaderboard + Miner filter in Top Players.
Tests: server 99/99 (94 prior + 5 Batch 14: config lists miner playable, miner.js served, progress accepted, miner leaderboard, per-game best stored with BTD bestScore untouched), BTD 146/146, shooter pass, miner harness pass (click/drag/hold mining, upgrades, auto-drill, belt advance, pause, end-shift dedupe, local save, destroy). Serve 200s.
Live status 2026-11-01 17:57 EST: API/config/health LIVE at 3.13.0, but Batch 14 statics NOT live — miner.js returns {"error":"not found"}, features.json still 3.12.0/103, homepage shows no Miner, config lists asteroid-miner as coming-soon (file check fails in the live deployment). Likely the live deployment was built from the first Batch 14 commit (server.js) before the miner files landed — same one-deployment static lag as Batches 11/13. Do NOT report Batch 14 as shipped; next run must re-check miner.js + features.json. No re-push in this run (loop rule).
Limits: miner canvas/button/beam visuals code-reviewed + harness-verified via state only (no browser screenshot or real-device check); ore-mix shift for belts 2+ code-reviewed; belt cap for XP/credits is 200 (same as shooter).

## Batch 15 — DONE 2026-11-01 — v3.14.0 (3 features, 110 total)
Performance
- [x] Offscreen sprite pre-rendering for towers/balloons at each level: BTD prerender() cache keyed by sprite+size (towers, sprite balloons) and color+radius+armored (procedural balloon bodies) / kind+color (procedural tower bases); one drawImage per frame + dynamic overlays (angle, flash, stars, layer text, status dots); null-safe fallback to direct drawing without a canvas API; bosses + pulsing beacon stay live-drawn.
- [x] Particle cap adapts to measured FPS (dynamic quality): dynFactorFor 1 / 0.6 / 0.35 at >=90% / >=60% / below target FPS with step-up hysteresis (>=95% to recover); BTD cap 150/400 x factor + spawn-count scaling, Shooter 400, Miner 300; FPS now measured in Shooter/Miner loops; cap + factor exposed in HUD/state/debug stats.
- [x] Lazy-load game modules: only load the selected game's script. Game <script> tags removed from index.html; GameScriptLoader in engine-host.js injects on first selection, caches the promise, resolves immediately if the global exists, clears cache on failure so retries re-inject; shell registers all 5 games with lazy loaders, Shooter/Miner gated on /api/config playable status.
Tests: server 111/111 (99 prior + 12 Batch 15: no eager game scripts, loader vm behaviour incl. cache/retry, features 110), BTD 156/156, shooter pass, miner pass. Serve 200s.
Live status: see Run log.
Limits: pre-render + lazy-load verified in Node harnesses + serve checks only (no browser screenshot or real-device check); visual equivalence of pre-rendered bodies code-reviewed (same draw calls, same coordinates); lazy-load first-click path in a real browser not exercised (no live browser run in this batch).

## Batch 16 — DONE 2026-11-01 — v3.15.0 (4 features, 114 total)
Accessibility & mobile
- [x] Colorblind palette toggle for balloon layers: Okabe-Ito-inspired hues + 3-letter code label per type (ring + label on sprite balloons, recolored body + label on procedural ones); mod/custom enemies keep their color but still get a name label; pop particles follow the palette; palette switch clears the sprite cache.
- [x] Reduced-motion mode: disables screen shake, particle bursts and tilt-shift DoF bands; danger glow goes static; defaults to the OS prefers-reduced-motion setting when never chosen; Settings toggle + body attribute freezes the CSS starfield/glow animations.
- [x] Keyboard-only play: arrow keys move a visible crosshair cursor (24px, Shift = 96px, clamped to the board), Enter places/selects at the cursor (hero placement order preserved: unplaced hero claims an activation first, same as a click), U upgrades, X sells; mouse movement deactivates the cursor automatically; cursor + flags exposed in HUD.
- [x] Larger touch targets: 44px+ action-bar buttons/selects, 52px tower tiles, single-column tower grid on small screens / coarse pointers; desktop mouse layout unchanged.
Tests: server 116/116 (111 prior + 5 Batch 16), BTD 184/184 (156 prior + 28 Batch 16, incl. full keyboard place/select/upgrade/sell flow), shooter pass, miner pass. Serve 200s.
Limits: colorblind sprite art itself is unchanged (images cannot be recolored — ring + label carry it); reduced-motion water shimmer still animates (background decor, not listed in the batch); touch-target sizing is CSS code-reviewed only (no real-device check); keyboard flow harness-verified in the VM (no real keyboard/browser check).
Live status: see Run log.

## Batch 17 — DONE 2026-11-01 — v3.16.0 (4 features, 122 total)
Tycoon & Clicker depth (was Batch 13)
- [x] Tycoon prestige: reset rigs/credits at 5,000 credits for a permanent +25% earnings multiplier per prestige (stacking); lifetime earnings tracked; offline/tick/collect earnings use the multiplier; persisted per address.
- [x] Tycoon rig skins: Standard (free) / Gold (1,000) / Void (2,500) skins bought with credits; equipped skin colors rig cards; owned skins persist per address.
- [x] Clicker combo + golden shards: clicks within 1.5s chain a streak (+10% per 10 streak, capped 3x); rare golden shard events pay +10 per click for 8s; best combo tracked; surge behaviour unchanged.
- [x] Clicker server bests + shard conversion: Save Best emits a final game:ended (score = best combo) and the shell records it on the per-game Clicker leaderboard (filter added to Top Players); 100 banked shards convert to 10 in-game credits via POST /api/convert-shards (100–5000 per call, multiple of 100, ledger-recorded, capped like legacy progress); rate also in /api/config.
Tests: server 132/132 (116 prior + 16 Batch 17), BTD 184/184, shooter pass, miner pass, tycoon/clicker harness pass (32 checks). Serve 200s via server test.
Limits: prestige/skins/combo/golden/convert UI are DOM code, harness-verified via state/helpers + render strings only (no browser screenshot or real-device check); shard conversion trusts the client's banked total (capped + ledgered, same model as legacy progress — the server cannot verify a local-save balance); tycoon bests are whitelisted in /api/progress but no shell submission yet (tycoon stays local-save).

## Batch 18 — PvP duels II (was Batch 14)
- [ ] Live duels: two players, same seed, real-time score race (polling).
- [ ] Duel history + rematch button.
- [ ] Duel entry fee in credits with winner-takes-most (server escrow of credits only).

## Batch 18 — DONE 2026-11-01 — v3.17.0 (4 features, 126 total)
PvP duels II (was Batch 14)
- [x] Live duels: after the rival accepts, either player starts a 10-minute race (shared seed, same for both); both post live scores (monotonic max, capped 100000, waves to 200) via POST /api/duels/live; GET /api/duels/:id/live polls scores, leader (score, then wave, then tie) and secondsLeft; Finish decides by higher live score. Expired races are decided by the request-time sweep, same pattern as order expiry.
- [x] Duel entry fee in credits: 0/50/100/250 at invite time; nothing is held until the race starts, when both balances are debited into a pot (credits only — no ATOM, no escrow-model change). Winner takes most: 90% of the pot, 10% rake ledger-recorded; a draw refunds both fees. Legacy /api/duels/result rejects fee duels so a pot can never pay twice. Insufficient credits block the start.
- [x] Duel history + rematch: GET /api/duels/history lists decided duels newest-first with the viewer's won/lost/draw outcome, scores, fee and payout; POST /api/duels/rematch creates a fresh pending duel with the same rival, same fee and a new seed (pending duels cannot be rematched).
- [x] Shared duel seed in BTD: setDuelSeed/getDuelSeed reseed the background/starfield decor generator (identical rnd sequence verified in the harness) and the seed is exposed in HUD and state; the shell applies the seed on race start (Apply seed button too). Wave compositions are already deterministic, so both racers face the same waves.
Tests: server 158/158 (132 prior + 26 Batch 18 incl. fee accounting 900->900+180+150 achievement, draw refund, drain-to-blocked, monotonic scores, idempotent finish), BTD 188/188 (184 prior + 4 seed checks), shooter pass, miner pass, tycoon/clicker pass. Serve 200s via server test.
Limits: expired-race decision happens on the next request (no background job on Vercel); the seed covers decor + wave composition — balloon spawn jitter still uses Math.random, so runs are not bit-identical; shell live panel, fee selector, history/rematch UI and 5s polling are code-reviewed only (no browser/DOM harness); the winner's +150 first-duel-win achievement stacks on top of the pot payout, as with legacy duels.
Live status: see Run log.

## Batch 19 — Polish (was Batch 15)
- [ ] Hub loading screen with progress bar + tips.
- [ ] Sound: ambient space hum + UI hover ticks (Web Audio, no assets).
- [ ] Footer: version, build date, links to AtomStaking + Swap.

## Batch 19 — DONE 2026-11-01 — v3.18.0 (3 features, 129 total)
Polish
- [x] Hub loading screen: #hubLoader overlay in index.html (progress bar + % + rotating tip, 5 honest tips), updateHubLoader called at real init stages (config 10/35%, games 60%, first game 80/100%), hideHubLoader on ready, 20s safety timeout + init-failure catch so the overlay can never trap the user; CSS in hub.css, bar transition frozen under reduced motion.
- [x] Ambient space hum: two quiet detuned Web Audio sine oscillators (54/81 Hz, gain 0.012 x volume, no assets) sharing the uiTick AudioContext; starts only after the first pointer/key gesture (no autoplay), gated by the new ambientHum setting + UI sounds + volume > 0, live gain updates on volume change; Settings toggle #setAmbientHum. UI hover/click ticks already existed from Batch 5 and are unchanged.
- [x] Hub footer: #hubFooter with #hubFooterVersion + #hubFooterDate filled by renderHubFooter from /api/config (version + new buildDate 2026-11-01, also on /api/health), plus links to AtomStaking + Swap + game.atomstaking.app; static HTML carries the same links and a fallback v3.18.0 / Build 2026-11-01 so the footer is never empty. No game manifest changed (no game module touched); CEO address, env vars, domains and escrow model untouched.
Tests: server 164/164 (158 prior + 6 Batch 19: buildDate format/match, 129 features incl. all 3 Batch 19 ids, loader + footer markers in served homepage, loader/footer/hum markers in shell.js, .hubLoader in hub.css), BTD 188/188, shooter pass, miner pass, tycoon/clicker pass. Serve 200s via server test.
Limits: loader/hum/footer rendering + gesture-gated hum start are code-reviewed + marker-checked only (no browser screenshot or real-audio check); the hum cannot be heard in a harness; scheduled posts / Vercel background behaviour unchanged.
Live status: see Run log.

## Batch 20 — Quality of life (first batch defined by the loop; the backlog had no undone batch left)
- [x] Selected-tower splash ring: a selected cannon/mortar draws its dashed blast radius (splash + branch splashBonus); `selectedSplash` exposed in HUD (0 for non-splash towers).
- [x] Next-wave danger rating: `waveDangerRating(w)` scores the deterministic wave composition (layers × speed, armored/fortified ×1.5, boss +500) into Calm/Guarded/Dangerous/Extreme; `nextWaveDanger` in HUD; wave 1 Calm, wave 50 Extreme.
- [x] Keyboard shortcuts overlay: `?` toggles a hub modal listing every real game key (1–8/Space/Enter/arrows/U/X/P/R/Esc/~), Esc closes it, backdrop click closes it, `?` is ignored while typing in inputs; button in the left rail.
- [x] Honest feature count: `totalFeatures` in features.json (equals the features array length) and in /api/config, read by the server from the same file it serves; null, never guessed, if the file is unreadable.
Tests: server 169/169 (164 prior + 5 Batch 20), BTD 192/192 (188 prior + 4 Batch 20), shooter pass, miner pass, tycoon/clicker pass. Serve 200s via server test.
Limits: splash ring + danger label are canvas/HUD data, harness-verified via helpers/state only (no browser screenshot check); shortcuts overlay rendering code-reviewed + marker-checked only (no browser click check).
Live status: see Run log.

## Batch 21 — Game feel II (defined by the loop; the backlog had no undone batch left)
- [x] Sell refund counts full investment: towers track `invested` (base + linear upgrades + branch points); sell refund and inspect payload pay 70% of invested; towers without the field fall back to base cost.
- [x] Boss-wave warning: `isBossWave(w)` (every 10th wave) exposed in HUD as `nextWaveBoss` for the wave after the current one.
- [x] Shooter graze bonus: skimming an asteroid within 22px of contact without touching it pays +5 score once per asteroid (`grazes` counter in HUD/state, reset on restart).
- [x] Miner rich vein: every 10th mined rock yields a bonus ore of the same type (`richVeins` counter in HUD/state, reset on restart).
Tests: server 175/175 (169 prior + 6 Batch 21), BTD 197/197 (192 prior + 5 Batch 21), shooter pass (3 clean runs; combo test fixed to assert a score delta with the field isolated so drifting spawns cannot graze-score mid-check), miner pass, tycoon/clicker pass. Serve 200s via server test.
Limits: graze/rich-vein/sell-refund visuals are HUD/state data, harness-verified only (no browser screenshot check); graze floater text is canvas-only.
Live status: see Run log.

## Batch 22 — Game feel III (defined by the loop; the backlog had no undone batch left)
- [x] Hero XP progress: `heroXpProgress(heroXp)` reports the in-run level implied by hero XP (100 XP per level) plus XP into the level and XP to the next; `heroXpProgress` in HUD and getState.
- [x] Shooter accuracy: `accuracyFor(shotsFired, kills)` — kills per firing volley as a percent to one decimal, capped at 100 (a spread volley can kill more than one target); `accuracy` in HUD, getState and the game-over screen.
- [x] Miner cargo breakdown: per-ore counts + base values richest-first (`cargoBreakdown`) and the richest ore id (`richestOre`, null when empty) in HUD and state; base values so the scanner multiplier cannot change the ordering.
- [x] Clicker milestones: 100/500/1000/2500/5000 total clicks toast once each when crossed, persist with the local save (`milestones`), legacy saves seed silently from their stored click total; next milestone shown in the game and in getState.
Tests: server 180/180 (175 prior + 5 Batch 22), BTD 201/201 (197 prior + 4 Batch 22), shooter pass, miner pass, tycoon/clicker pass. Serve 200s via server test.
Limits: accuracy/HUD/state data only, harness-verified (no browser screenshot check); milestone toasts are DOM-toast calls, harness-verified via the onToast stub; cargo breakdown values are base values before the scanner multiplier (cargoValue stays the scanner-adjusted total).
Live status: see Run log.

## Batch 23 — Game feel IV (defined by the loop; the backlog had no undone batch left)
- [x] BTD balloons remaining: `balloonsRemaining` (live balloons + queued spawns) in HUD and getState.
- [x] Shooter best wave: highest wave reached in the run, in HUD, getState and the game-over screen; reset on restart.
- [x] Miner belt progress percent: mined/quota as a percent capped at 100, in HUD and getState.
- [x] Tycoon prestige progress: percent toward 5,000 credits plus credits remaining, in getState and the tycoon panel.
Tests: server 186/186 (180 prior + 6 Batch 23), BTD 204/204 (201 prior + 3 Batch 23), shooter pass, miner pass, tycoon/clicker pass. Serve 200s via server test.
Limits: HUD/state data only, harness-verified (no browser screenshot check); best-wave game-over line is canvas text, marker-checked only.
Live status: see Run log.

## Research (never claim as built)
- WebGL renderer + generated normal maps for true deferred lighting.
- GPU particle engine (WebGL points) replacing canvas pools.
- CosmWasm contracts — SUPERSEDED by the user's no-contracts CEO-escrow model. Do not build.

## Run log
- 2026-11-01 ~14:10: cron game-auto-improve created (every 10 min).
- 2026-11-01 ~14:14: v3.0.0 push started (browser task, 13 files) — result pending at time of Batch 4 build; v3.1.0 push waits for it.
- 2026-11-01 ~14:19: Batch 4 built locally (v3.1.0): server 25/25, BTD 27/27, shooter pass. Push queued after the v3.0.0 upload finishes.
- 2026-11-01 14:29 EST: Batch 5 built locally (v3.2.0, Pillar 3): server 25/25, BTD 34/34, shooter pass. Health 200 (3.1.0) at run start. Push via browser task; verify /api/config shows 3.2.0.
- 2026-11-01 ~14:36 EST: Batch 5 pushed (browser task, saved GitHub login, no challenge): 9 files, 5 commits fc0265e, 8a2ed59, a57f5ab, 8cd01eb, 39e71ef (HEAD, 45 commits total). server.js at HEAD shows VERSION 3.2.0. Live /api/config verification pending after auto-deploy.
- 2026-11-01 14:39 EST: VERIFIED LIVE — text fetches served stale crawls, so a live browser reload was used: /api/config version 3.2.0 (real CEO address, 5% fee, 30-min orders) and /api/health version 3.2.0 at 2026-11-01T19:39:26Z. Batch 5 shipped.
- 2026-11-01 14:40 EST: Batch 6 built locally (v3.3.0, Pillar 4): server 25/25, BTD 59/59, shooter pass. Health/config 200 at run start (stale crawls showed 3.1.0/3.0.0; live 3.2.0 verified previous run). Push via browser task; verify /api/config shows 3.3.0.
- 2026-11-01 14:51 EST: VERIFIED LIVE — 6 files pushed (commits 46ec7d5, de3002c, a8cf3b4, 2069f20, 6dd2a0b, e177410; HEAD e177410, 51 commits). Fresh /api/config crawl 19:51 UTC shows version 3.3.0, real CEO address, 5% fee, 30-min orders. Batch 6 shipped. (/api/health still served a stale 19:29 crawl showing 3.1.0; same deployment as config, crawler artifact only.)
- 2026-11-01 14:52 EST: Batch 7 built locally (v3.5.0, Pillar 5): health/config 200 at run start (config fresh 3.3.0; health stale 3.1.0 crawl). Local copy already at v3.4.0/63 features, unpushed — reconciled above, ships with this push. Tests: server 25/25, BTD 116/116, shooter pass. Push via browser task; verify /api/config shows 3.5.0.
- 2026-11-01 ~14:53 EST: Track 3 gaps built locally (v3.4.0, 9 features, 63 total): BTD 86/86, server 25/25, shooter pass. Batch 6 verified live 3.3.0 before this push. Push via browser task; verify /api/config shows 3.4.0.
- 2026-11-01 15:05 EST: VERIFIED LIVE — push 9 files / 9 commits (HEAD 7221b4b, 65 commits total; GitHub server.js was 3.4.0 before replace). Fresh live-browser reload: /api/config version 3.5.0 (real CEO address, 5% fee, 30-min orders), /api/health version 3.5.0 at 2026-11-01T20:05:08Z. Batch 7 shipped. Correction to the reconciliation note above: per the memory record, the v3.4.0 Track 3 push had landed 5 of 8 files (HEAD 9b9554a) before this run, not zero; the complete v3.4.0 + v3.5.0 set shipped together in this push.
- 2026-11-01 15:07 EST: Batch 8 built locally (v3.6.0, BTD depth II): health/config 200 at run start (live 3.5.0). Tests: server 25/25, BTD 129/129, shooter pass. Push via browser task; verify /api/config shows 3.6.0.
- 2026-11-01 15:20 EST: VERIFIED LIVE — push 8 files / 8 commits (HEAD dd10ddc, 73 commits total; previous HEAD 7221b4b). Fresh live-browser reload: /api/config version 3.6.0 (real CEO address, 5% fee, 30-min orders), /api/health version 3.6.0 at 2026-11-01T20:19:45Z (timestamp advanced on reload, live not cached). Batch 8 shipped.
- 2026-11-01 15:24 EST: Batch 9 built locally (v3.7.0, Visuals): health/config 200 at run start (live 3.6.0; crawls stale at 3.5.0/3.3.0). Tests: server 25/25, BTD 146/146, shooter pass. Push via browser task; verify /api/config shows 3.7.0.
- 2026-11-01 15:29 EST: Batch 9 pushed (browser task, saved GitHub login, no challenge): 9 files, 9 commits e230fef, 53abad2, ed5772c, 2c79600, 305e67e, 6b791bb, e2e53a5, bd3d5c4, 4e3bb88 (HEAD, 82 commits total). GitHub server.js + features.json verified 3.7.0 on main. Live /api/config verification pending after auto-deploy.
- 2026-11-01 15:31 EST: VERIFIED LIVE — fresh live-browser reload: /api/config version 3.7.0 (real CEO address, 5% fee, 30-min orders), /api/health version 3.7.0 at 2026-11-01T20:31:12Z. Batch 9 shipped.
- 2026-11-01 15:32 EST: LEVEL UP redesign built locally (v3.8.0): health/config 200 at run start (live 3.7.0). Tests: server 25/25, BTD harness, shooter pass. Push via browser task; verify /api/config shows 3.8.0.
- 2026-11-01: Keplr-only built locally (v3.8.1) after the v3.8.0 push landed. Tests: server 25/25, BTD harness, shooter pass, wallet harness. Push via browser task; verify /api/config shows 3.8.1.
- 2026-11-01 15:47 EST: VERIFIED LIVE — v3.8.0 push 16 files / 16 commits (HEAD 9a607c0, 98 commits total). Fresh curl: /api/config version 3.8.0 (real CEO address, mode demo via Vercel env), /api/health 200, homepage 200. Batch v3.8.0 shipped.
- 2026-11-01 15:54 EST: VERIFIED LIVE — v3.8.1 (Keplr only) push 10 files / 10 commits (HEAD dbed350, 108 commits total). Fresh curl: /api/config version 3.8.1 (real CEO address, mode demo via Vercel env), homepage 200, no Leap button in served HTML, no global.leap in served wallet.js. Overlap lock deleted; cron resumes with Batch 10 next.
- 2026-11-01 16:00 EST: Batch 10 built locally (v3.9.0, Space Shooter depth): health/config 200 at run start (live 3.8.1). Tests: server 29/29, BTD 146/146, shooter pass incl. Batch 10 checks. Push via browser task; verify /api/config shows 3.9.0. NOTE: a separate staged tags/cleanup patch (~/workspace/levelup-patch/patch_tags_cleanup382.py, per MEMORY.md) was NOT applied in this run — it must wait until this run's lock is gone.
- 2026-11-01 16:17 EST: VERIFIED LIVE — push 8 files / 8 commits (HEAD 911fe04, 116 commits total). Fresh live-browser reload: /api/config version 3.9.0 (real CEO address, 5% fee, 30-min orders), /api/health version 3.9.0 at 2026-11-01T21:17:44Z (timestamp advanced across reloads, live not cached). Batch 10 shipped. Overlap lock deleted; cron resumes with Batch 11 next. The tags/cleanup patch remains unapplied (staged elsewhere, waits for lock release).
- 2026-11-01 16:20 EST: Batch 11 built locally (v3.10.0, Platform & social): health/config 200 at run start (text-fetch crawls stale at 3.8.1; live 3.9.0 verified previous run). Tests: server 48/48, BTD 146/146, shooter pass. Push via browser task; verify /api/config shows 3.10.0. NOTE: the staged tags/cleanup patch was NOT applied in this run either — it is separate from Batch 11 and asserts no lock exists; this run holds the loop lock. It stays staged for a separate run.
- 2026-11-01 16:31 EST: Batch 11 pushed (browser task, saved GitHub login, no challenge): 7 files / 7 commits, HEAD 7d2fee9, 123 commits total. GitHub server.js + features.json verified 3.10.0 / 95 features on main.
- 2026-11-01 16:32 EST: API VERIFIED LIVE — fresh hard-reload: /api/config version 3.10.0 (real CEO address, 5% fee, 30-min orders), /api/health version 3.10.0, timestamp advancing live.
- 2026-11-01 16:41 EST: STATIC FILES NOT YET LIVE — hard-reload checks at 16:36 and 16:41 EST: live homepage + engine/shell.js still serve pre-Batch-11 code (no btnShareCard/challengeBox/referralBox/renderChallenges in DOM or shell.js), while GitHub main contains the new code (verified: index.html 97fca0a, shell.js f75e013, no stray root index.html). Cause unknown; Vercel dashboard was not opened (loop rule). Batch 11 UI is NOT confirmed live. Next run must re-check the homepage/shell.js before reporting Batch 11 as shipped; do not re-push unless the static files are still stale after the next check. Overlap lock deleted; cron resumes with Batch 12 next, but the static re-check comes first.
- 2026-11-01 16:45 EST: BATCH 11 STATIC RE-CHECK (Batch 12 run): fresh text-fetch crawl of /engine/shell.js still shows no Batch 11 markers (no renderChallenges/challengeBox/referralBox/btnShareCard) while /api/config + /api/health are live 3.10.0. Batch 11 UI still NOT confirmed live. No re-push of Batch 11 files in this run; the Batch 12 push may deploy the Batch 11 statics with it — re-check shell.js + marketplace-ui.js markers after the Batch 12 deploy before reporting either batch as shipped.
- 2026-11-01 17:02 EST: Batch 12 built locally (v3.11.0, Marketplace depth): server 73/73, BTD 146/146, shooter pass. Health/config 200 at run start (live 3.10.0 API; Batch 11 statics stale, see above). Push via browser task; verify /api/config shows 3.11.0 and served marketplace-ui.js shows Batch 12 markers. NOTE: the staged tags/cleanup patch was NOT applied in this run either — it is separate from Batch 12 and must wait for a run without the loop lock.
- 2026-11-01 17:09 EST: Batch 12 pushed (browser task, saved GitHub login, no challenge): 5 files / 5 commits, HEAD 63a21f6, 128 commits total (e87e258 server.js, c40cb05 marketplace-ui.js, 1240580 ceo-ui.js, fcf611f features.json, 63a21f6 backlog). GitHub main verified 3.11.0 / 99 features, sparklineSvg + mkBulkList in marketplace-ui.js, executeRental in ceo-ui.js.
- 2026-11-01 17:14 EST: VERIFIED LIVE — fresh live-browser hard-reload with cache-busters: /api/config 3.11.0 (real CEO address), /api/health 3.11.0 with advancing timestamps (22:10:34Z and 22:13:20Z). Served shell.js contains all Batch 11 markers (renderChallenges/challengeBox/referralBox/btnShareCard) and served marketplace-ui.js contains all Batch 12 markers (sparklineSvg/data-offer/mkBulkList/data-rent); homepage shows the share-card button + referral/challenges sections. The Batch 11 static-staleness from 16:41/16:45 EST is RESOLVED — Batch 11 UI is live with this deploy. Batch 12 shipped. Overlap lock deleted; cron resumes with Batch 13 next. The tags/cleanup patch remains unapplied (staged elsewhere).
- 2026-11-01 17:19 EST: Batch 13 built locally (v3.12.0, CEO tools II): server 94/94 (73 prior + 21 Batch 13 via ADMIN_KEY test bypass, local harness only), BTD 146/146, shooter pass. Health/config 200 at run start (live 3.11.0). Push via browser task; verify /api/config shows 3.12.0. NOTE: the staged tags/cleanup patch was NOT applied in this run either — it is separate from Batch 13 and must wait for a run without the loop lock.
- 2026-11-01 17:30 EST: Batch 13 pushed (browser task, saved GitHub login, no challenge): 4 files / 4 commits, HEAD cacf87c, 132 commits total (001cec8 server.js, 0b4fa83 backlog, 197c051 features.json, cacf87c ceo-ui.js). GitHub main verified 3.12.0 / 103 features, Batch 13 markers in ceo-ui.js.
- 2026-11-01 17:33 EST: API VERIFIED LIVE — fresh fetches: /api/config version 3.12.0 (real CEO address, 5% fee, 30-min orders), /api/health version 3.12.0 with advancing timestamp (22:33:10Z).
- 2026-11-01 17:36 EST: STATIC FILE NOT YET LIVE — live-browser hard-reload with cache-buster of /engine/ceo-ui.js shows the PRE-Batch-13 file (tabs orders/ledger/users/flags/settings/announce/audit; no renderDisputes/drawFeeChart/ledExportAll/annSchedule/openDisputes), while GitHub main contains the new code and the API is 3.12.0. Same static-staleness pattern as Batch 11 (16:41/16:45 EST), which resolved on the next deployment. Batch 13 UI is NOT confirmed live. No re-push in this run; do not report Batch 13 as shipped. Next run must re-check served ceo-ui.js markers before reporting Batch 13 as shipped; the Batch 14 push may deploy the Batch 13 statics with it. Cause unknown; Vercel dashboard was not opened (loop rule).
- 2026-11-01 17:44 EST: Batch 14 built locally (v3.13.0, Asteroid Miner): server 99/99, BTD 146/146, shooter pass, miner harness pass. Health/config 200 at run start (text-fetch crawls stale at 3.11.0; live API 3.12.0 verified previous run, Batch 13 statics stale — re-check after this push). Push via browser task; verify /api/config shows 3.13.0 and served ceo-ui.js shows Batch 13 markers + miner.js served.
- 2026-11-01 18:05 EST: Batch 14 static re-check at run start: API/config live 3.13.0, but miner.js still 404 live and served features.json stale — Batch 14 statics NOT live (same one-deployment lag as Batches 11/13). Batch 15 built locally (v3.14.0, Performance): server 111/111, BTD 156/156, shooter pass, miner pass. Push via browser task; verify /api/config shows 3.14.0 and served miner.js + features.json show Batch 14/15 markers. NOTE: the staged tags/cleanup patch was NOT applied in this run either — it is separate from Batch 15 and must wait for a run without the loop lock.
- 2026-11-01 19:00 EST: Batch 16 run start: health/config 200, live 3.14.0 (real CEO address, asteroid-miner playable). Batch 14 statics RESOLVED (miner.js live). Batch 15 statics STILL LAGGING: served features.json is 3.13.0/107 (no Batch 15 entries) — same one-deployment static lag as Batches 11/13; this run's push should deploy them. No re-push of Batch 15 files alone.
- 2026-11-01 19:19 EST: Batch 16 built locally (v3.15.0, Accessibility & mobile): server 116/116, BTD 184/184, shooter pass, miner pass. Push via browser task; verify /api/config shows 3.15.0 and served features.json shows 3.15.0/114 (which also confirms Batch 15 statics deployed).
- 2026-11-01 19:31 EST (delivery check): Batch 16 VERIFIED LIVE in substance — /api/config 3.15.0 (real CEO address), served btd.js has all Batch 16 markers (colorblind/crosshair/reduced-motion), served shell.js has GameScriptLoader (Batch 15 lazy-load live), served index has Batch 15 comment. Served /features.json still lags at 3.14.0/110 (local 3.15.0/114) — Updates view only. Batch 16 worker lock was stale (written 19:00:01 EST, no edits since 19:19 EST); lock cleared for manual tags/cleanup apply.
- 2026-11-01: Cleanup + tags built locally (v3.15.2) after the Batch 10 run finished. Tests: server 25/25, BTD harness, shooter pass, wallet harness, tags harness. Push via browser task (replace 12 files + delete 6 dead files); verify /api/config shows 3.15.2 with tags and no legacy entry.
- 2026-11-01 19:53 EST (delivery check): v3.15.2 pushed to GitHub (HEAD d6484a8, 169 commits; 15 files replaced + 4 deleted; Procfile/railway.toml were never on GitHub main, only local — all 6 dead files absent from main). /api/config LIVE at 3.15.2 with tags on all 5 games, no defend-atom, real CEO address. Served static STILL LAGGING (features.json 3.15.0/114, shell/index no tagFilter, app.js still 200) — same one-deployment static lag; next cron push promotes the 3.15.2 static. Do not report 3.15.2 fully live until served shell/index show tagFilter.
- 2026-11-01 20:00 EST: Batch 17 built locally (v3.16.0, Tycoon & Clicker depth): health/config 200 at run start (live 3.15.2). Tests: server 132/132, BTD 184/184, shooter pass, miner pass, tycoon/clicker harness pass. Push via browser task; verify /api/config shows 3.16.0 and served features.json shows 3.16.0/122 (which also confirms the 3.15.2 statics finally deployed).
- 2026-11-01 20:21 EST: Batch 17 pushed (browser task, saved GitHub login, no challenge): 9 files / 9 commits, HEAD f78e260, 178 commits total (2c462d1 server.js, e844f75 package.json, 25f2c7a features.json, d27f093 shell.js, 72caf74 tycoon.js, 7003361 tycoon manifest, 56042fc clicker.js, f25279b clicker manifest, f78e260 backlog). GitHub main verified 3.16.0 / manifests 3.16.0.
- 2026-11-01 20:22-20:25 EST: LIVE CHECK (cache-busted, twice for features.json/shell.js) — API LIVE at 3.16.0: /api/config 3.16.0 with shardConversion 100:10 and real CEO address; /api/health 3.16.0 with current timestamp 01:22:38Z. STATIC FILES STILL LAGGING (same one-deployment lag as Batches 11/13/14/15): served features.json is 3.15.2/118, served shell.js has no _clickerSubmitted / no Clicker filter, served tycoon.js has no prestige/SKIN_DEFS, served clicker.js has no combo/convert-shards. Batch 17 UI is NOT confirmed live; do NOT report Batch 17 as shipped. No re-push in this run (loop rule). Next run must re-check served tycoon.js/clicker.js/shell.js/features.json markers before reporting Batch 17 as shipped; the Batch 18 push may deploy the Batch 17 statics with it. Served features.json is still 3.15.2/118, consistent with the 3.15.2 deployment being the served static set; tagFilter itself was not checked in this run (an external MEMORY.md update claims it confirmed live 20:24 EST — not verified by this run's checks).

- 2026-11-01 20:27 EST: Batch 18 built locally (v3.17.0, PvP duels II): server 158/158, BTD 188/188, shooter pass, miner pass, tycoon/clicker pass. Health/config 200 at run start (text-fetch crawls stale at 3.15.2; live API 3.16.0 verified previous run). Two test bugs fixed in-run: the live-poll GET handler shadowed POST /api/duels/live (method guard added), and test addresses collided with earlier batches (q/r/s -> a/b/c/d). Push via browser task; verify /api/config shows 3.17.0 and served shell.js/tycoon.js/clicker.js show Batch 17+18 markers (Batch 17 static re-check folded into this verification — Batch 17 must not be reported shipped until its markers appear).

- 2026-11-01 20:54 EST: Batch 18 push verified on GitHub (7 files, HEAD 4ce0242, 185 commits). LIVE CHECK (fresh cache-busted browser reloads, 01:50-01:51 UTC): /api/config + /api/health still 3.16.0 — Batch 18 NOT live (same one-deployment static lag as Batches 11/13/14/15; no duels object in config, features.json 3.16.0/122, no duel markers in served shell.js/btd.js). Do NOT report Batch 18 as shipped. Batch 17 UI CONFIRMED LIVE in the same check: served tycoon.js has prestige/SKIN_DEFS, clicker.js has combo/convert-shards, shell.js has tagFilter + atom-clicker filter — Batch 17 may now be reported shipped. No re-push in this run (loop rule); next run must re-check config 3.17.0 + duel markers before reporting Batch 18. Overlap lock deleted.

- 2026-11-01 21:05 EST: Batch 19 built locally (v3.18.0, Polish): server 164/164, BTD 188/188, shooter pass, miner pass, tycoon/clicker pass. Health/config 200 at run start (live 3.16.0; Batch 18 statics still lagging — this run's push should promote them). Push via browser task; verify /api/config shows 3.18.0 and served shell.js/index show Batch 18 + 19 markers.

- 2026-11-01 21:12 EST: Batch 19 pushed (browser task, saved GitHub login, no challenge): 7 files / 7 commits, HEAD 0805dd8, 192 commits total (d362738 server.js, df63d64 package.json, 57078b8 index.html, f6bb018 hub.css, 052f69b shell.js, 3ddab55 features.json, 0805dd8 backlog). GitHub main verified 3.18.0 / Batch 19 markers in shell.js by the push task. (Push-task report also claimed a "totalFeatures": 129 field in features.json — no such field exists in the local file; disregard that detail.)
- 2026-11-01 21:25 EST: LIVE CHECK (fresh cache-busted live-browser reloads): /api/config + /api/health LIVE at 3.18.0 with buildDate 2026-11-01, duels entryFees 0/50/100/250, real CEO address; health timestamp advancing live. BATCH 18 CONFIRMED LIVE: served shell.js contains duels/live polling + liveScores markers — Batch 18 may now be reported shipped. BATCH 19 STATICS STILL LAGGING (same one-deployment lag as Batches 11/13/14/15): served shell.js has 0 Batch 19 markers (no updateHubLoader/startAmbientHum/renderHubFooter), served features.json is 3.17.0/126 ending at duel-shared-seed, rendered homepage footer is the old text. Batch 19 is NOT confirmed live; do NOT report it as shipped. No re-push in this run (loop rule). Next run must re-check served shell.js/index/features.json Batch 19 markers before reporting Batch 19 as shipped; the next push may deploy the Batch 19 statics with it. Overlap lock deleted.

- 2026-11-01 21:34 EST: LIVE RE-CHECK (fresh cache-busted live-browser reloads, browser task 02:27–02:33 UTC): /api/config + /api/health LIVE at 3.18.0 (buildDate, duels entryFees, real CEO address all present; health timestamp advancing). BATCH 19 STATICS STILL LAGGING: served shell.js has no updateHubLoader/startAmbientHum/renderHubFooter (Batch 18 markers present), served features.json is 3.17.0 with no Batch 19 ids, homepage has no #hubLoader/#hubFooter. Batch 19 still NOT confirmed live. This run defines Batch 20 (no undone batch remained in the backlog) and pushes it; the Batch 20 deployment should also promote the Batch 19 statics — re-check both batches' markers after it.

- 2026-11-01 21:45 EST: Batch 20 built locally (v3.19.0, QoL): server 169/169, BTD 192/192, shooter pass, miner pass (4/4 clean standalone runs), tycoon/clicker pass. Health/config 200 at run start (live 3.18.0 API; Batch 19 statics lagging — re-check after this push). Push via browser task; verify /api/config shows 3.19.0 and served shell.js/index/features.json show Batch 19 + 20 markers.

- 2026-11-01 22:30 EST: Batch 20 API VERIFIED LIVE at run start (fresh crawls 03:30 UTC): /api/health + /api/config 200 at 3.19.0, real CEO address, duels entryFees, shardConversion. BUT totalFeatures is 129 (Batch 19 count, not 133) and served /features.json still ends at the Batch 15 set (lazy-game-modules) — the Batch 20 features.json never reached the served deployment (same static lag as Batches 11/13/14/15, only worse: two deployments behind). Batch 19 + 20 statics still NOT confirmed live; this run's Batch 21 push (which re-pushes features.json + the changed game files) should promote them — re-check served features.json (must show 3.20.0/137) + shell.js Batch 19/20 markers after it. Batch 21 built locally (v3.20.0, Game feel II): server 175/175, BTD 197/197, shooter pass x3, miner pass, tycoon/clicker pass. Push via browser task; verify /api/config shows 3.20.0.

- 2026-11-01 22:54 EST: Batch 21 SHIPPED LIVE — push via browser task (saved GitHub login, no challenge): 10 files / 10 commits, HEAD 1abadb6, 210 commits total. GitHub main verified 3.20.0 / Batch 21 markers in btd.js (investedFor, nextWaveBoss), shooter.js (GRAZE), miner.js (RICH VEIN). Live (fresh cache-busted checks 22:52–22:54 EST): /api/config 3.20.0, totalFeatures 137, real CEO address; /features.json 3.20.0 ending at miner-rich-vein; served shell.js contains updateHubLoader + startAmbientHum + renderHubFooter (Batch 19) AND toggleShortcuts (Batch 20) — BATCHES 19 + 20 STATICS FINALLY CONFIRMED LIVE, resolving the lag tracked since 21:25/21:34 EST; homepage footer renders "GAME · v3.20.0 · Build 2026-11-01". Shipment messages owed for Batches 19, 20 and 21. Overlap lock deleted.
- 2026-11-01 22:57 EST (memory update, after the 22:54 entry): Batch 21 game JS still lagging live — served btd.js/shooter.js/miner.js showed 0 Batch 21 markers (invested/isBossWave/grazes/richVeins) at that check, i.e. the Batch 20 build was still served for game files. Do NOT report v3.20.0 as fully live until those markers appear. This run's Batch 22 push re-pushes all three game files plus features.json, so it should promote the Batch 21 statics with it — re-check Batch 21 + 22 markers in the served files after it.
- 2026-11-01 ~23:00 EST: user asked for a solo-engine redesign (sidebar + side tabs, games open in a new tab ?game=<id> inside the engine, Friends = real duel rivals only, Hero Shop + CEO panels, OG share image/description). Staged patch at ~/workspace/levelup-patch/patch_solo_engine321.py — do NOT apply while the Batch 22 cron lock is active; a later run applies it after the lock clears, then pushes + verifies live. This run does not touch it.
- 2026-11-01 23:0x EST: Batch 22 built locally (v3.21.0, Game feel III): server 180/180, BTD 201/201, shooter pass, miner pass, tycoon/clicker pass. Health/config 200 at run start (stale crawls showed 3.19.0/129; live 3.20.0 per the 22:54 entry, Batch 21 game statics lagging per the 22:57 update — re-check after this push). Push via browser task; verify /api/config shows 3.21.0 and served btd.js/shooter.js/miner.js/clicker.js show Batch 21 + 22 markers.
- 2026-11-01 23:19 EST: Batch 22 PUSHED, NOT YET LIVE — push via browser task (saved GitHub login, no challenge): 12 files / 12 commits, HEAD 439feca, 222 commits total (ba1a4e0 server.js, 78ba069 package.json, ce5339f backlog, c70a0c3 features.json, 820441a btd.js, f3651d0 BTD manifest, 2463d4b shooter.js, 7f4c207 shooter manifest, 1ebab96 miner.js, d222b15 miner manifest, 4c71d33 clicker.js, 439feca clicker manifest). GitHub main verified 3.21.0 / 141 features ending at clicker-milestones. LIVE (fresh cache-busted checks 23:18–23:19 EST): /api/config 3.21.0 with real CEO address BUT totalFeatures 137; /api/health 3.21.0 with current timestamp; served features.json still 3.20.0/137 ending at miner-rich-vein; served game files have Batch 21 markers (investedFor/nextWaveBoss, grazes, richVeins — BATCH 21 STATICS FINALLY CONFIRMED LIVE, resolving the 22:57 lag note; Batch 21 may now be reported shipped) but NO Batch 22 markers (heroXpProgress/accuracyFor/cargoBreakdown/milestonesReached absent) and manifests still old (BTD 3.20.0, clicker 3.16.0, shooter 1.3.0, miner 1.2.0). Same one-deployment static lag as Batches 11/13/14/15. Do NOT report Batch 22 as shipped. No re-push in this run (loop rule); next run must re-check served features.json (3.21.0/141) + Batch 22 markers before reporting Batch 22. Overlap lock deleted — the staged solo-engine patch (patch_solo_engine321.py) may now be applied by a later run.
- 2026-11-01 23:2x EST: Batch 23 built locally (v3.22.0, Game feel IV): server 186/186, BTD 204/204, shooter pass, miner pass, tycoon/clicker pass. Health/config 200 at run start (live 3.21.0 API, totalFeatures 137 — Batch 22 statics still lagging, re-check after this push). Push via browser task; verify /api/config shows 3.22.0 and served features.json shows 3.22.0/145 plus Batch 22 + 23 markers in the served game files. NOTE: the staged solo-engine patch (patch_solo_engine321.py) was NOT applied in this run — it asserts the overlap lock is absent, and this run holds the loop lock; it stays staged for a separate unlocked run. Do not report Batch 22 as shipped until its markers appear.

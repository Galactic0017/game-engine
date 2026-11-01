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

## Batch 10 — Space Shooter depth (was Batch 6)
- [ ] Power-ups: shield, rapid fire, spread shot, dropping from drones.
- [ ] Boss drone every 5 waves with a health bar.
- [ ] Combo multiplier for consecutive kills without taking damage.
- [ ] Touch controls: virtual joystick + fire button on mobile.
- [ ] Shooter leaderboard: best score per player on the server.

## Batch 11 — Platform & social (was Batch 7)
- [ ] Friend challenges: send a duel invite by address, async results.
- [ ] Seasonal ladder: monthly leaderboard reset + badge for top 3.
- [ ] Share card: PNG snapshot of a run (canvas toDataURL) to download.
- [ ] Referral code in profile: track invited addresses (no payouts).

## Batch 12 — Marketplace depth (was Batch 8)
- [ ] Price history sparkline per hero (last 10 sales).
- [ ] Offer system: buyer makes an offer below list price, seller accepts/declines.
- [ ] Hero rental: time-boxed loan, auto-return, fee split.
- [ ] Bulk list: list several heroes in one signed batch.

## Batch 13 — CEO tools II (was Batch 9)
- [ ] Dispute queue: flagged orders get a dedicated review view.
- [ ] Fee analytics chart: fees/volume by day (canvas chart, no deps).
- [ ] Scheduled announcements: post at a chosen time (server timer).
- [ ] Export full ledger to CSV from the CEO panel (already per-kind; add all).

## Batch 14 — Asteroid Miner game (was Batch 10)
- [ ] New playable module: click/drag mining, ore tiers, drill upgrades,
      asteroid belt progression, local save + server bests.

## Batch 15 — Performance (was Batch 11)
- [ ] Offscreen sprite pre-rendering for towers/balloons at each level.
- [ ] Particle cap adapts to measured FPS (dynamic quality).
- [ ] Lazy-load game modules: only load the selected game's script.

## Batch 16 — Accessibility & mobile (was Batch 12)
- [ ] Colorblind palette toggle for balloon layers.
- [ ] Reduced-motion mode: disables shake, DoF bands, particle bursts.
- [ ] Keyboard-only play: full tower placement via keyboard.
- [ ] Larger touch targets on the action bar for small screens.

## Batch 17 — Tycoon & Clicker depth (was Batch 13)
- [ ] Tycoon: prestige reset with permanent multiplier; rig skins.
- [ ] Clicker: combo streaks, golden shard events, clicker bests on server.
- [ ] Cross-game currency: shards convert to credits at a fixed rate.

## Batch 18 — PvP duels II (was Batch 14)
- [ ] Live duels: two players, same seed, real-time score race (polling).
- [ ] Duel history + rematch button.
- [ ] Duel entry fee in credits with winner-takes-most (server escrow of credits only).

## Batch 19 — Polish (was Batch 15)
- [ ] Hub loading screen with progress bar + tips.
- [ ] Sound: ambient space hum + UI hover ticks (Web Audio, no assets).
- [ ] Footer: version, build date, links to AtomStaking + Swap.

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

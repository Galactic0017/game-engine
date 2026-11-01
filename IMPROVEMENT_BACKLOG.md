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

## Batch 7 — Pillar 5: Runtime & Developer Tools
- [ ] Level / map editor mode: dev tab to draw custom tracks, place
      terrain, mark spawn points, export maps as clean JSON configs.
- [ ] Debug console + performance monitor: `~` overlay with FPS graph,
      frame time (ms), particle counts, memory usage, entity counts.
- [ ] Modding & config loader: game modules loadable from external JSON
      schemas — add towers, enemies, waves by editing text files.

## Batch 8 — BTD depth II (was Batch 4)
- [ ] Mortar target preview: show splash radius ring while placing mortar.
- [ ] Tower sell preview: show refund amount on the Sell button.
- [ ] Hero ability cooldown bar in the action bar (seconds left).
- [ ] Wave skip bonus: +25 gold for starting the next wave early.
- [ ] Balloon speed lines: fast balloons (Pink/Zebra) get motion streaks.

## Batch 9 — Visuals (was Batch 5)
- [ ] Tower muzzle flash + recoil animation on fire (barrel kick).
- [ ] Leak warning: screen edge flashes red at 80% path progress.
- [ ] Victory/defeat end screens with run stats (waves, pops, score, gold, time).
- [ ] Animated starfield behind the hub header (CSS only, respects Low quality).
- [ ] Hero portrait glow for the equipped hero in the sidebar.

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

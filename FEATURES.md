# FEATURES.md — GAME Engine Hub feature registry

Every feature shipped in `public/features.json` (also served live at
`/features.json` and shown in the hub's **Updates** view). Counts here
are only features actually built and tested — never claims.

## v3.1.0 — 2026-11-01 — 11 features (45 total)

| Area | Features |
|---|---|
| Engine Visuals (7) | Bloom glow pass, Dynamic 2D lighting, Vignette + danger pulse, Tilt-shift DoF bands, Water shader, Particle engine, Contextual shake |
| Engine Core (4) | ECS architecture, Fixed 60Hz timestep, Asset pipeline manager, Spatial-hash stats |

Honest limits: DoF/water/lighting visual quality not browser-verified
(harness only); danger pulse code-reviewed; normal maps + true GPU
particles deferred to WebGL research — not claimed.

## v3.0.0 — 2026-11-01 — 34 features (this release)

| Area | Features |
|---|---|
| Cosmos BTD (16) | Tesla Coil, Spike Factory, Camo, Fortified, Regen, Endless mode, Pause, Hero in-run leveling, Sprite rendering, Damage numbers, Lv 5 MAX upgrade, Wave interest, Touch support, FPS + quality, Boss shield, Challenge mode |
| Platform (7) | Daily quests, 12 achievements, Announcements, Player stats, Per-game leaderboard, Health endpoint, Version 3.0.0 |
| Games (1) | Space Shooter |
| Hub UI (8) | Updates tracker, Announcement banner, Marketplace filters, Settings panel, Profile panel, Quests UI, Achievements UI, Action-bar controls |
| CEO Panel (1) | Announce tab |
| Operations (1) | 10-minute auto-improve loop |

## Test evidence (2026-11-01, local)

- Server flow test `/tmp/test_server_v3.js`: **25/25** (health, config,
  secure progress + tampered-flag, quests claim/double-claim, achievements,
  duel quest, per-game leaderboard, announcements, features.json, shooter.js).
- BTD harness `/tmp/test_btd_v3.js`: **18/18** (7 towers, placement cost,
  pops/score, spike piles live, pause freeze, endless flag, Lv 5 upgrade
  costing exactly 920 gold, FPS, next-wave preview, destroy teardown).
- Space Shooter harness `/tmp/test_shooter.js`: **all checks pass**
  (move, fire, pause, game over, restart, HUD, destroy teardown).
- `node --check` on all JS files: pass.

## Honest limits

- Boss shield (wave 30), endless past wave 50, and hero in-run leveling
  were code-reviewed, not driven to those states in the harness.
- Real Keplr/Leap `sendAtom` and LCD auto-verify are untested with a
  real wallet / live chain data (fail closed when unreachable).
- On Vercel, state is in-memory and resets on redeploy/instance recycle;
  move to a real database before treating sales history as permanent.

## How to verify live

- Homepage: https://game.atomstaking.app/ (200)
- Config: https://game.atomstaking.app/api/config (version 3.0.0, games list)
- Health: https://game.atomstaking.app/api/health
- Features: https://game.atomstaking.app/features.json

Next batches live in `IMPROVEMENT_BACKLOG.md`. The auto-improve loop
works through them top-down, tests each batch, and pushes to GitHub
(Vercel auto-deploys). A batch is only marked done after its tests pass.

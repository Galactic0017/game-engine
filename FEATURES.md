# FEATURES.md — GAME Engine Hub feature registry

Every feature shipped in `public/features.json` (also served live at
`/features.json` and shown in the hub's **Updates** view). Counts here
are only features actually built and tested — never claims.

## v3.10.0 — 2026-11-01 — 4 features (95 total)

| Area | Features |
|---|---|
| Platform & social (4) | Friend challenges (duel invites with accept/decline + async results), Seasonal ladder (monthly bests, This month toggle, last-month top 3 + trophy badges), Share card (PNG snapshot of the run canvas + stats banner), Referral code in profile (counted once, no payouts) |

Honest limits: season bests are recorded only from this version on (no backfill of earlier scores); the share card needs an untainted same-origin canvas or it only shows a toast; the Challenges / season-toggle / referral shell UI is code-reviewed only (no browser/DOM harness).

## v3.9.0 — 2026-11-01 — 5 features (91 total)

| Area | Features |
|---|---|
| Space Shooter (5) | Power-ups (shield / rapid / spread / life drops), Boss drone every 5 waves with health bar, Combo multiplier up to x3, Touch controls (virtual joystick + FIRE button), Shooter leaderboard (per-game server bests + Top Players Shooter filter) |

Honest limits: power-up/boss/combo/touch visuals are canvas draw code, harness-verified via state/HUD helpers only (no browser screenshot or real-device touch check); shooter score submission uses the legacy /api/progress endpoint (not the hashed secure path, which stays BTD-only); the shell's Shooter leaderboard filter and game-over submission are code-reviewed only (no browser/DOM harness for the shell).

## v3.15.2 — 2026-11-01 — 4 features (118 total)

| Area | Features |
|---|---|
| Hub UI (2) | Game tags on every game (chips on cards + info window), tag filter + search by tag |
| Engine (2) | Engine open fail-safe (failed loads throw before opening), legacy cleanup (dead files/configs removed) |

## v3.8.1 — 2026-11-01 — 1 feature (86 total)

| Area | Features |
|---|---|
| Hub UI (1) | Keplr-only wallet — the other wallet option was removed everywhere (button, provider detection, signing, wording); stored sessions from it are not restored |

## v3.8.0 — 2026-11-01 — 9 features (85 total)

| Area | Features |
|---|---|
| Hub UI (7) | LEVEL UP 3-column launcher layout, Featured game hero banner, Game cards + info window, Recently Played rail, Find Games search, Wallet provider choice (Keplr/Leap), No demo mode (real players only) |
| CEO Panel (1) | Side tabs (vertical rail) |
| Cosmos BTD (1) | Space ATOM look — energy lane + ATOM orb |
| Sharing (link preview) | Open Graph + Twitter card tags with battlefield.jpg (1600x900) and the platform description, so shared links show an image + description |

## v3.7.0 — 2026-11-01 — 5 features (76 total)

| Area | Features |
|---|---|
| Cosmos BTD (3) | Muzzle flash + recoil on fire, Leak warning at 80% path progress, Victory/defeat end screens with run stats |
| Hub UI (2) | Animated starfield behind the header (CSS only, static on Low quality), Equipped-hero portrait glow |

Honest limits: muzzle flash/recoil + leak edge + end-screen panel are canvas draw code, harness-verified via state/HUD helpers only (no browser screenshot check); starfield + hero glow are CSS/DOM, code-reviewed only; end-screen run time starts at the first wave and freezes on win/loss.

## v3.6.0 — 2026-11-01 — 5 features (71 total)

| Area | Features |
|---|---|
| Cosmos BTD (5) | Mortar splash preview ring, Sell refund preview, Hero cooldown bar, Wave-skip bonus (+25g), Fast-balloon speed lines |

Honest limits: splash ring + speed lines + cooldown bar are canvas/DOM
draw code, harness-verified via state/HUD helpers only (no browser
screenshot check); skip bonus pays only on manual starts between
waves, never on auto-start or wave 1.

## v3.5.0 — 2026-11-01 — 3 features (66 total)

| Area | Features |
|---|---|
| Engine Tools (3) | Map editor, Debug console + perf monitor, JSON mod loader |

Honest limits: editor/mod/overlay DOM wiring code-reviewed only (no
browser/DOM harness for the shell); custom tracks keep the fixed
branch-lane shape.

## v3.4.0 — 2026-11-01 — 9 features (63 total)

| Area | Features |
|---|---|
| Cosmos BTD (8) | Multi-lane fork path, Closest/Elite targeting, Status effects (burn/poison/stun/shred), Synergy Beacon, Boss phase shields + minions, Log endless scaling, Hero radial cooldown, FCT arcs + crit rolls |
| UI/UX (1) | Action-bar branch + patrol controls |

Honest limits: branch-lane visuals are the same gravel style as the
main path (no distinct branch art); DoF/water/lighting still not
browser-verified; radial cooldown ring + status dots code-reviewed
in canvas draw code, harness-verified via state/HUD only.

## v3.3.0 — 2026-11-01 — 4 features (54 total)

| Area | Features |
|---|---|
| Gameplay depth (4) | Branching upgrade trees, Hero commander (patrol/gear/tiers), Hazard detours + wave routing, Storm/blizzard weather |

## v3.2.0 — 2026-11-01 — 5 features (50 total)

| Area | Features |
|---|---|
| UI/UX framework (5) | Glassmorphism theme, Floating combat text, Inspection stat cards, Settings (FPS/particles/motion blur/HiDPI), ECS-table iteration |

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

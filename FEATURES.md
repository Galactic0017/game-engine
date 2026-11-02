# FEATURES.md — GAME Engine Hub feature registry

Every feature shipped in `public/features.json` (also served live at
`/features.json` and shown in the hub's **Updates** view). Counts here
are only features actually built and tested — never claims.

## v3.41.1 — Redesign: new look, no escapes, everything in side tabs

- Removed every literal unicode escape from user-visible text (real characters everywhere, including link titles).
- Aurora-dusk look: new palette, button gradients and tab styling across the shell; same space/ATOM identity and own art.
- Left sidebar in Play/System tabs; center below the game in Your Games/Guide/Details tabs; right-rail switching scoped to its rail.

## v3.39.1 — Right sidebar tabs

- Right sidebar organized into Social / You / Play tabs; wallet pinned above.
- Social (default): Friends, Challenges, Referral. You: Profile, My Heroes, Quests, Achievements. Play: Top Players, Recently Played, Settings.
- All 10 sidebar box ids preserved; render functions untouched; tab switching mirrors the existing showView pattern.

## v3.41.0 — 2026-11-02 — 5 features (235 total)

Game feel XXIII: pops per minute (BTD), score per boss (Shooter, incl. game-over line), credits per shift (Miner), banked per milestone (Clicker, panel line), credits per prestige (Tycoon, panel line). All five are HUD/state ratio readouts over existing counters; no gameplay, economy, or escrow changes.

Honest limits: HUD/state/panel data only, harness-verified (no browser screenshot check); the shooter game-over line and the clicker/tycoon panel lines are render-string checked in the harness; credits-per-shift, banked-per-milestone and credits-per-prestige use current unspent/banked balances, not cumulative earnings; pops-per-minute is 0 until the first wave starts.

## v3.40.0 — 2026-11-02 — 5 features (230 total)

Game feel XXII: gold per wave (BTD), power-ups per minute (Shooter, incl. game-over line), credits per belt (Miner), shards per milestone (Clicker, panel line), lifetime per prestige (Tycoon, panel line). All five are HUD/state ratio readouts over existing counters; no gameplay, economy, or escrow changes.

Honest limits: HUD/state/panel data only, harness-verified (no browser screenshot check); the shooter game-over line and the clicker/tycoon panel lines are render-string checked in the harness; gold-per-wave and credits-per-belt use current unspent balances, not cumulative earnings; lifetime-per-prestige is 0 until the first prestige.

## v3.30.1 — 2026-11-01 — 5 features (182 total)

Solo engine: in-screen game side panel (Towers/Upgrades/Hero/Play tabs + tower shop inside the screen), HUD strip, open-in-new-tab (?game=), Friends rail from real duel history, professional 1200x630 share image + description. All games shown are the user's own games, with real art and real data only.

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

## v3.49.1 — Hub + dedicated game screen (blueprint build)
- Home Hub (/) vs dedicated game screen (/game/cosmos-btd) with Exit to Home Hub; only Cosmos BTD is playable, other slots are unnamed COMING SOON / TITLE UNANNOUNCED.
- Game top deck (wave / gold / ATOM shield / auto-wave / speed / pause), scrollable bottom deck (8 towers + hero, real costs and hotkeys), slide-over Entity Inspector + marketplace list, real performance overlay (FPS / entities / particles / heap).
- ATOM Orb: rotating electron rings, pulsing cyan/violet glow, in-canvas shield bar; leaks trigger red lightning, shockwave ripple and screen shake.
- Server falls back to index.html for extensionless non-API routes so /game/cosmos-btd loads directly.

## v3.49.2 — Hero economy + late-campaign ramp
- Buy any hero with in-game credits (Common 2,500 / Rare 5,000 / Epic 9,000 / Legendary 15,000) — no unlock-level gate when paying. Free claim at unlock level stays.
- Hero cap Lv 100 on upgrade and XP paths; upgrade costs 200 x level. Active marketplace listings follow the hero's level.
- Waves 26-50 ramp: extra balloon layers + speed; boss layers scale (wave-40 boss 90 layers). Late waves need leveled heroes + maxed towers.

## v3.49.3 — Deep-link fix
- /game/cosmos-btd returned 404 on Vercel: the catch-all rewrite dropped the original path. The rewrite now carries `?__path=/$1` and the SPA fallback also covers a bare GET /api/index.

## v3.49.4 — Deep-link fix, corrected
- v3.49.3 broke /api/* live (config returned HTML): the fallback safety net fired for rewritten API requests. Removed. /game/* now rewrites statically to /index.html, before the catch-all; the API path is untouched.

## v3.49.5 — Game would not open from /game/cosmos-btd: fixed
- Relative hub.css / engine script paths resolved under /game/ and came back as HTML, so the page stayed unstyled and init never ran. Added <base href="/"> and made head asset refs root-absolute; every route now loads the same files.

## v3.49.6 — Two maps
- Space map kept; Jungle map added (bright grass, foliage borders, stone-slab winding path, START marker, leafy trees, same track geometry, waves and ATOM orb). Switch with Map: Space/Jungle in the game top bar; the choice is remembered.
- Store card fix (same version): the `featured` banner overlay covered the card art over the title/buttons; the card now uses its own highlight class, the top bar no longer overlaps the board, and the shield bar fits inside the canvas.

## v3.49.7 — Sharp board
- The tilt-shift blur bands blurred the top/bottom of the board; they now default off so the board is sharp all over. Still available in Settings as "Cinematic tilt-shift bands".

## v3.49.8 — Realistic jungle, full-game features, marketplace redesign

- Realistic jungle map: meadow patches, rocky cliff borders, pond shores with reeds and lily pads, pebble-edged stone path (realistic-jungle)
- Towers sit on stone (jungle) / metal (space) pedestals with a shadow base (tower-pedestals)
- Selected tower shows a soft range fill plus an outer ring, like the reference look (range-polish)
- Pause menu: Resume, Restart run, Map switch, Settings, Exit to Home Hub (pause-menu)
- Call Wave button in the top deck between waves (manual start, +25g skip bonus after wave 1) (call-wave-early)
- Undo last placement: full refund, only between waves; placements lock when the wave starts (undo-placement)
- 4x game speed option (clamped 1-4x) (speed-4x)
- Top-deck sound on/off toggle (restores the volume setting on unmute) (mute-toggle)
- Top deck shows enemies left and total pops live (foes-pops-chips)
- Inspector shows the next wave's composition, danger rating, and boss warning (next-wave-preview)
- Marketplace redesign: hero portrait cards, level badges, rarity edges, big ATOM price, live for-sale/floor/average stats, scrolling tables (marketplace-cards)
- Skins section removed from the marketplace (skins changed nothing visible) (skins-removed)
- DEV STUDIO SETUP button and Dev Tools menu entry removed (dev-setup-removed)
- Phone + desktop polish: 560px layout (compact top bars, smaller deck tiles, full-width inspector, 16px inputs), marketplace tables scroll (responsive-phone)

## v3.49.9 — Menu close + place selects tower

- Library ... menu closes on outside click and Escape (menu-outside-close)
- Placing a tower selects it so the Entity Inspector opens at once (place-selects-tower)

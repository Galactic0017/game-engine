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
  `server.js` + manifest versions for changed games, e.g. 3.1.0).
- Never claim a feature exists unless it is built, tested, and live.
- If a push or live check fails, log it here, do NOT retry in the same
  run, and try again next run. Never ask the user for codes.
- Stop conditions: user says stop; or a batch breaks the live site
  (then revert the batch's push and report it).

## Batch 3 — DONE 2026-11-01 — v3.0.0 (34 features)
BTD depth + quests/achievements/announcements + Space Shooter + hub UI.
Tests: server 25/25, BTD 18/18, shooter harness all pass.

## Batch 4 — BTD depth II
- [ ] Mortar target preview: show splash radius ring while placing mortar.
- [ ] Tower sell preview: show refund amount on the Sell button for the selected tower.
- [ ] Hero ability cooldown bar in the action bar (seconds left).
- [ ] Wave skip bonus: +25 gold for starting the next wave early (during between-waves).
- [ ] Balloon speed lines: fast balloons (Pink/Zebra) get motion streaks.

## Batch 5 — Visuals
- [ ] Tower muzzle flash + recoil animation on fire (already flash ring; add barrel kick).
- [ ] Leak warning: screen edge flashes red when a balloon reaches 80% of the path.
- [ ] Victory/defeat end screens with run stats (waves, pops, score, gold earned, time).
- [ ] Animated starfield behind the hub header (CSS only, respects Low quality).
- [ ] Hero portrait glow for the equipped hero in the sidebar.

## Batch 6 — Space Shooter depth
- [ ] Power-ups: shield (1 hit), rapid fire (8s), spread shot (8s), dropping from drones.
- [ ] Boss drone every 5 waves with a health bar.
- [ ] Score submit: shooter score saves to the server leaderboard (bests['space-shooter']) via a signed session report like BTD.
- [ ] Touch controls: left/right on-screen buttons + auto-fire toggle on mobile.
- [ ] New enemy: splitter asteroid that breaks into 2 small ones.

## Batch 7 — Platform: social + retention
- [ ] Weekly leaderboard reset + "last week's winners" note in the sidebar.
- [ ] Player profiles: public profile view (name, level, bests, achievements) at /api/profile?address=.
- [ ] Referral-free invite link: shareable link with ?ref=address that shows the inviter's name on the hub (no rewards, display only).
- [ ] Streaks: daily login streak counter (visit = +1 day, shown in profile; resets after 48h gap).
- [ ] Duel history: list of past duels with results in the sidebar.

## Batch 8 — Marketplace depth
- [ ] Hero price history: last 5 closed sale prices per hero shown on its listing.
- [ ] "Make offer" flow: buyer proposes a price, seller accepts in a new CEO-panel offers tab (CEO still escrows the final send).
- [ ] Listing expiry: listings auto-expire after 7 days (server sweep, ledger entry).
- [ ] Rarity filter chips in the CEO users/heroes tables.
- [ ] Watchlist: star a listing; watched listings get a badge in My Orders.

## Batch 9 — CEO tools II
- [ ] Broadcast message: CEO can push a toast to all connected hubs (announcement + bus event, no PII).
- [ ] Fee analytics chart: volume/fees per day (last 14 days) from the ledger, rendered as bars in the Ledger tab.
- [ ] Bulk actions: ban + remove all listings for an address in one signed action (already exists separately; combine with confirm).
- [ ] Export users CSV from the Users tab.
- [ ] Order SLA timer: show each pending order's age + a warning color after 15 minutes.

## Batch 10 — New game: Asteroid Miner (playable)
- [ ] Click/drag to mine asteroids, upgrade drill + cargo, sell ore for credits (local save like Tycoon).
- [ ] Register in shell + config, manifest, destroy teardown, harness test.

## Batch 11 — Performance + reliability
- [ ] BTD object pools for floaters + beams (cap + reuse, no per-frame allocation in hot loops).
- [ ] Reduce HUD updates to 4/sec (already throttled; verify no per-frame DOM writes in draw).
- [ ] Lazy-load game scripts: load each game's script only when first opened (keep BTD eager).
- [ ] Service-worker-free offline fallback page: if /api/config fails, hub shows a cached-games notice instead of a blank viewport.
- [ ] Server: request logging to a rotating in-memory ring (last 100) + GET /api/admin/logs for the CEO.

## Batch 12 — Accessibility + mobile
- [ ] Full keyboard play for BTD: arrows move a placement cursor, Enter places, U upgrades, S sells.
- [ ] Color-blind balloon outlines: optional pattern mode (stripes/dots per balloon type).
- [ ] Larger tap targets on mobile action bar (min 44px) + responsive canvas scaling.
- [ ] Reduced-motion setting: disables shake + particles + starfield.
- [ ] Screen-reader labels on nav tabs and wallet widget (aria-labels).

## Batch 13 — Tycoon + Clicker depth
- [ ] Tycoon: 3rd rig tier + prestige reset (keep 10% of lifetime earnings as a permanent multiplier).
- [ ] Tycoon: rig breakdowns — random event, pay credits to repair or lose output for 1h.
- [ ] Clicker: combo meter (clicks within 1s build a multiplier up to 5x), clicker prestige.
- [ ] Clicker: auto-clicker upgrade bought with shards.
- [ ] Cross-game credits: Tycoon/Clicker earnings convert to hub credits at a fixed rate, capped daily, via a signed claim endpoint.

## Batch 14 — PvP duels II
- [ ] Live duel rooms: two players, same seed, race to the highest wave in 10 minutes; winner decided by score (server-verified reports).
- [ ] Duel wagering stays DISABLED (in-game credits only) until legal review — do not build ATOM wagering.
- [ ] Duel rematch button + best-of-3 series tracking.
- [ ] Spectate: watch a friend's run state (read-only, 5s poll, no chat).

## Batch 15 — Polish pass
- [ ] Loading skeletons for marketplace/CEO panels instead of blank cards.
- [ ] Empty states with art for heroes/listings/orders when the user has none.
- [ ] Confirm dialogs for destructive CEO actions use the hub toast style (no native prompt()).
- [ ] Footer: live chain status dot (LCD reachable?) from /api/health.
- [ ] Favicon + Open Graph tags for game.atomstaking.app.

## Run log
- 2026-11-01: Batch 3 shipped (v3.0.0). Next: Batch 4.

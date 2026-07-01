# LMP 2.0 — Product Roadmap

**Season context:** 2026/27 pre-season. The FPL API is currently off-season (no active GWs). All current data in `fpl_data.json` is zeroed out (`MAX_GW: 0`, empty standings). `data.json` carries the live roster and fines ledger. The 2025/26 season is archived in `data/seasons/2025-26.json` and drives "The Run In" tab until GW10 of the new season triggers the live cutover.

---

## Phase 10 — Teams & Squad Viewer

> Let everyone see each manager's current squad with real player photos, positions, captain, and price.

**What's needed in `sync_fpl.js`:**
- Add `now_cost` (player price ÷ 10 = £x.x) to `playerMap` — currently only `web_name`, `team`, `element_type`, `code` are stored
- Add `ownership` (ownership %) from `bootstrap-static` elements — needed for differential calculations later
- Store full `picks` per GW per manager (currently only current GW picks are kept) — enables transfer tracking across the season

**New tab — `07 · SQUADS`**
- Dropdown/card selector to switch between managers
- Formation layout: GK / DEF / MID / FWD rows + bench row
- Each player card shows:
  - FPL photo (`https://resources.premierleague.com/premierleague/photos/players/110x140/p{code}.png`)
  - Player name, position badge, price (£x.xm)
  - GW points (once season is live)
  - Captain (C) / Vice-captain (V) badge
  - Active chip banner (Wildcard, Bench Boost, Triple Captain, Free Hit)
- Off-season state: show squads once managers have drafted — FPL API exposes picks even before GW1

---

## Phase 11 — Analytics Tab

> Deep stats for the mini-league. The raw data is mostly already synced — this is a display/computation layer.

**New tab — `08 · ANALYTICS`**

All panels below are derived from existing `fpl_data.json` fields unless noted.

### Mini-league stats (available from GW1)

| Panel | Data source |
|---|---|
| Captaincy tracker — who picked the right armband each GW, total captain pts | `currentPicks` → `is_captain` + GW pts |
| Bench points wasted (season total + per-GW chart) | `benchTotal` already in sync |
| Hit frequency — total -4 pts taken, worst offenders | `gwHits` already in sync |
| Chip timeline — who used what and when | `chips` already in sync |
| Form table — last 5 GW rank vs overall rank | `gwRanks` already in sync |
| Weekly winner board — who finished GW1 first, GW2 first, etc. | `weeklyRanks` already in sync |
| Head-to-head heatmap — who beats who most often | `gwPts` already in sync |
| Biggest single GW score / lowest single GW score | `gwPts` already in sync |

### Player-level stats (require per-GW picks history — Phase 10 data work)

| Panel | Notes |
|---|---|
| Most transferred in within the mini-league | Compare picks GW-to-GW |
| Most transferred out within the mini-league | Compare picks GW-to-GW |
| Differentials — players owned in the league but low overall % (hidden gems) | Requires `ownership` field from bootstrap |
| Template players — owned by 10+ of 17 managers | Cross-reference all squads |
| Most captained player in the league this season | Aggregate captain picks |
| Highest-scoring player no one owns | All `bootstrap` elements vs. all picks |

### Pre-season / off-season state
- Show last season's archived stats (from `data/seasons/2025-26.json`) with a clear "2025/26 Season Review" banner until GW1 starts
- Panels that need live data show a "Season hasn't started yet" placeholder, styled consistently with the terminal aesthetic

---

## Phase 12 — Manager Profile Pages

> Clicking a manager name anywhere in the app opens a full profile.

- Season summary: total pts, current rank, fines total, fines paid/outstanding
- Squad snapshot (links to Phase 10 squad view)
- GW points bar chart (full season)
- Fine history table (from `data.json` fines array) — same data the ledger shows but scoped per manager
- Epithet + tagline with the easter-egg reveal animation already in the codebase
- Head-to-head record vs. every other manager (once enough GWs played)
- Previous season comparison card (from archive)

---

## Phase 13 — Season Archive & Historical Comparisons

> The 2025/26 archive is already in `data/seasons/2025-26.json`. Make it browsable.

- Archive browser tab or modal: select season from dropdown
- Full 2025/26 Run In replay (already partly handled by the existing Run In tab)
- Season-over-season points comparison for managers who were in both seasons
- Hall of fame: season winners, last-place finishers, biggest fine payers per season

---

## Ongoing / Cross-cutting

- **Sync script hardening:** store `now_cost` + `ownership` + full per-GW picks from Phase 10 onwards
- **Off-season UX:** consistent "no data yet" states across all new tabs — the app should feel intentional, not broken, when `MAX_GW === 0`
- **Mobile layout:** the squads tab formation view needs careful grid work on small screens
- **Testing:** at minimum, unit tests for fine calculation logic in `apply_lmp_fines.js` and the bottom-3 override — real money, real consequences

---

## Prioritisation

```
Phase 10 (Squads)       ← start here, unblocks Phase 11 player stats
Phase 11 (Analytics)    ← mostly free once sync data is richer
Phase 12 (Profiles)     ← moderate work, high user delight
Phase 13 (Archive)      ← nice-to-have, low urgency pre-season
```

**Immediate pre-season action:** extend `sync_fpl.js` to capture `now_cost`, `ownership`, and per-GW full picks before GW1 fires — retrofitting mid-season is painful.

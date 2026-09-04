// Refresh LIVE points/charts from the public FPL API -> fpl_data.json.
// Money/fines/bottom-finishes now live in data.json (see apply_lmp_fines.js).
// This script no longer reads any Excel file.
//
// Resilience: global player data (prices, ownership, top transfers) always loads
// from bootstrap-static FIRST, so an empty or unreachable mini-league never blocks
// the player feeds the site renders. Pre-season the standings table is empty
// (members sit in `new_entries`) and squad picks aren't public until each GW's
// deadline passes — both are treated as "nothing yet", not failures, so the sync
// always writes a usable fpl_data.json instead of aborting with nothing.

const fs = require('fs');
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

const API = 'https://fantasy.premierleague.com/api';
const LEAGUE_ID = config.fpl_league_id;
const DATA_FILE = 'fpl_data.json';

// Times out a stalled request (the FPL API can hang under load, e.g. around a
// deadline) and retries transient network/timeout errors and 5xx responses
// (the API's own transient failures) — never 4xx, since retrying a bad
// request or missing resource can't fix it — so one blip can't wedge the
// whole job for 15 minutes.
async function fetchJSON(url, { retries = 2, timeoutMs = 15000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let r;
    try {
      r = await fetch(url, { headers: { 'User-Agent': 'LMP-Terminal/1.0' }, signal: ctrl.signal });
    } catch (e) {
      clearTimeout(timer);
      if (attempt >= retries) throw new Error(`${url} -> ${e.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : e.message}`);
      await new Promise(res => setTimeout(res, 500 * (attempt + 1)));
      continue;
    }
    clearTimeout(timer);
    if (!r.ok) {
      if (r.status >= 500 && attempt < retries) {
        await new Promise(res => setTimeout(res, 500 * (attempt + 1)));
        continue;
      }
      throw new Error(`${url} -> HTTP ${r.status}`);
    }
    return r.json();
  }
}

// Soft fetch: a missing per-manager endpoint (e.g. picks before a deadline)
// degrades to a fallback instead of killing the whole sync.
async function fetchSoft(url, fallback, label) {
  try { return await fetchJSON(url); }
  catch (e) { console.warn(`    ${label} unavailable (${e.message})`); return fallback; }
}

async function sync() {
  console.log(`Syncing live points for league ${LEAGUE_ID}...`);

  // 1) Global player data — always available, loaded first so it survives an
  //    empty/broken league below.
  const bootstrap = await fetchJSON(`${API}/bootstrap-static/`);

  // The gameweek currently underway (deadline passed, live scores flowing) is
  // `is_current`, not `finished` — `finished` only flips true once bonus points
  // are confirmed, a day or two after the last match. Gating on `finished` left
  // currentGW at 0 for the whole live gameweek, even though history.current
  // already carries a live provisional row for it — hence live points never
  // showing and the site stuck on its off-season "GW0" state mid-gameweek.
  const currentEvent = bootstrap.events.find(e => e.is_current)
    || [...bootstrap.events].filter(e => e.finished).pop();
  const currentGW = currentEvent ? currentEvent.id : 0;   // 0 = no GW started yet
  // The event whose squads are (or are about to become) public — used only to
  // read picks. Picks 404 until that GW's deadline passes; that's handled softly.
  const squadEvent = currentEvent
    || bootstrap.events.find(e => e.is_next)
    || bootstrap.events[0];
  const squadGW = squadEvent ? squadEvent.id : 1;

  const playerMap = {};
  bootstrap.elements.forEach(p => {
    playerMap[p.id] = {
      web_name: p.web_name, team: p.team, element_type: p.element_type, code: p.code,
      now_cost: p.now_cost, selected_by_percent: p.selected_by_percent,
    };
  });

  // Top FPL transfers this GW (global, not mini-league).
  const topFplTransfers = [...bootstrap.elements]
    .sort((a, b) => b.transfers_in_event - a.transfers_in_event)
    .slice(0, 20)
    .map(p => ({ id: p.id, name: p.web_name, code: p.code, position: p.element_type,
      now_cost: p.now_cost, transfers_in: p.transfers_in_event, transfers_out: p.transfers_out_event,
      selected_by_percent: p.selected_by_percent }));

  const COLORS = ['#e63946','#f4845f','#4dabf7','#b197fc','#ff6b9d','#38d9a9','#9775fa','#339af0','#ff8c42','#74c0fc','#ffa94d','#5c7cfa','#c9f542','#da77f2','#63e6be','#ffe066','#ff6b6b'];

  // 2) League roster. Pre-season the standings are empty and members live in
  //    `new_entries`; a transient failure here degrades to "player data only"
  //    rather than aborting the sync.
  let managers = [];
  try {
    const leagueData = await fetchJSON(`${API}/leagues-classic/${LEAGUE_ID}/standings/`);
    const standingsRes = (leagueData.standings && leagueData.standings.results) || [];
    const newRes = (leagueData.new_entries && leagueData.new_entries.results) || [];
    const src = standingsRes.length ? standingsRes : newRes;
    managers = src.map(m => ({
      entry: m.entry,
      entry_name: m.entry_name,
      player_name: m.player_name
        || [m.player_first_name, m.player_last_name].filter(Boolean).join(' ').trim()
        || 'Unknown',
      total: m.total || 0,
    }));
    console.log(`  roster: ${managers.length} manager(s) via ${standingsRes.length ? 'standings' : 'new_entries'}`);
  } catch (e) {
    console.warn(`  league fetch failed (${e.message}); writing player data only.`);
  }

  // 3) Per-manager gameweek + squad data. Every fetch soft-fails so one manager
  //    with no history/picks yet can't sink the run.
  const gwData = [];
  for (const m of managers) {
    console.log(`  ${m.player_name}...`);
    const history = await fetchSoft(`${API}/entry/${m.entry}/history/`, { current: [], chips: [] }, 'history');
    const rows = history.current || [];
    // FPL's per-entry history is authoritative once a gameweek is settled, but
    // its `points` field for the live/in-progress gameweek sits at 0 (or
    // whatever it was at the last internal sync) for hours after kickoff —
    // even though the mini-league standings' live `total` (m.total, above)
    // updates continuously as matches are played. So: trust history for every
    // finished gameweek, but derive the live one dynamically as (live total -
    // already-settled cumulative), so bottom-3/standings always reflect "as
    // things stand right now" instead of waiting on history to catch up.
    // Transfer cost is fixed at the deadline (not points-dependent), so it's
    // read straight from the row — including the live GW's — when present.
    let priorCum = 0;
    const gwPts = [], gwHits = [];
    for (let gw = 1; gw <= currentGW; gw++) {
      const row = rows.find(h => h.event === gw);
      const hits = row ? row.event_transfers_cost : 0;
      const pts = gw < currentGW ? (row ? row.points - hits : 0) : (m.total || 0) - priorCum - hits;
      gwPts.push(pts); gwHits.push(hits);
      priorCum += pts;
    }
    const benchTotal = rows.filter(h => h.event < currentGW).reduce((a, h) => a + (h.points_on_bench || 0), 0);
    const transfersTotal = rows.filter(h => h.event <= currentGW).reduce((a, h) => a + (h.event_transfers || 0), 0);

    // Picks are public only after a GW's deadline; before that this 404s.
    const picksData = await fetchSoft(`${API}/entry/${m.entry}/event/${squadGW}/picks/`, { picks: [], active_chip: null }, 'picks');
    const currentPicks = (picksData.picks || []).map(p => {
      const pl = playerMap[p.element] || {};
      return {
        id: p.element, name: pl.web_name, position: pl.element_type,
        code: pl.code, multiplier: p.multiplier,
        is_captain: p.is_captain, is_vice_captain: p.is_vice_captain,
        cost: pl.now_cost || 0,
        ownership: pl.selected_by_percent || '0',
      };
    });
    const captain = currentPicks.find(p => p.is_captain);
    const squadValue = currentPicks.reduce((a, p) => a + (p.cost || 0), 0);

    gwData.push({
      team: m.entry_name, manager: m.player_name, entry: m.entry,
      gwPts, gwHits, benchTotal, transfersTotal, chips: history.chips || [], total: m.total,
      currentCaptain: captain ? captain.name : 'Unknown',
      activeChip: picksData.active_chip, currentPicks, squadValue,
    });
  }

  // Cumulative + weekly ranks per GW (no-op until scores exist).
  const numGWs = gwData.length ? gwData[0].gwPts.length : 0;
  for (let g = 0; g < numGWs; g++) {
    gwData.map(m => ({ entry: m.entry, cumPts: m.gwPts.slice(0, g + 1).reduce((a, b) => a + b, 0) }))
      .sort((a, b) => b.cumPts - a.cumPts)
      .forEach((s, i) => { const m = gwData.find(d => d.entry === s.entry); (m.gwRanks || (m.gwRanks = []))[g] = i + 1; });
    gwData.map(m => ({ entry: m.entry, gwPt: m.gwPts[g], totalPts: m.gwPts.slice(0, g + 1).reduce((a, b) => a + b, 0) }))
      .sort((a, b) => b.gwPt - a.gwPt || b.totalPts - a.totalPts)
      .forEach((s, i) => { const m = gwData.find(d => d.entry === s.entry); (m.weeklyRanks || (m.weeklyRanks = []))[g] = i + 1; });
  }

  // Standings (points only; bottomApps comes from data.json via the site adapter)
  const standings = gwData
    .map(m => ({ manager: m.manager, team: m.team, pts: m.total, bottomApps: 0 }))
    .sort((a, b) => b.pts - a.pts);

  const runInData = gwData.map((m, i) => ({
    f: m.manager, s: m.manager.split(' ')[0], t: m.team, r: m.gwRanks, c: COLORS[i % COLORS.length],
  }));

  // Mini-league ownership: count how many managers own each player in their current squad
  const ownershipCount = {};
  gwData.forEach(g => {
    (g.currentPicks || []).forEach(p => {
      if (!ownershipCount[p.id]) ownershipCount[p.id] = { id: p.id, name: p.name, code: p.code, position: p.position, cost: p.cost, fpl_pct: p.ownership, count: 0 };
      ownershipCount[p.id].count++;
    });
  });
  const leagueOwnership = Object.values(ownershipCount)
    .sort((a, b) => b.count - a.count || parseFloat(b.fpl_pct) - parseFloat(a.fpl_pct));

  const out = { MAX_GW: currentGW, standings, gwData, runInData, leagueOwnership, topFplTransfers };
  fs.writeFileSync(DATA_FILE, JSON.stringify(out, null, 2));
  console.log(`Done. fpl_data.json updated through GW${currentGW} (${managers.length} managers, ${gwData.length} with data).`);
}

sync().catch(e => { console.error('SYNC FAILED:', e.message); process.exit(1); });

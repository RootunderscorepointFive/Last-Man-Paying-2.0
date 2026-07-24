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

async function fetchJSON(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'LMP-Terminal/1.0' } });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.json();
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

  const finishedEvent = [...bootstrap.events].filter(e => e.finished).pop();
  const currentGW = finishedEvent ? finishedEvent.id : 0;   // 0 = no GW played yet
  // The event whose squads are (or are about to become) public — used only to
  // read picks. Picks 404 until that GW's deadline passes; that's handled softly.
  const squadEvent = bootstrap.events.find(e => e.is_current)
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
    const pastGWs = (history.current || []).filter(h => currentGW && h.event <= currentGW);
    const gwPts = pastGWs.map(h => h.points - h.event_transfers_cost); // post-hits
    const gwHits = pastGWs.map(h => h.event_transfers_cost);
    const benchTotal = pastGWs.reduce((a, h) => a + (h.points_on_bench || 0), 0);
    const transfersTotal = pastGWs.reduce((a, h) => a + (h.event_transfers || 0), 0);

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

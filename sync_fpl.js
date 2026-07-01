// Refresh LIVE points/charts from the public FPL API -> fpl_data.json.
// Money/fines/bottom-finishes now live in data.json (see apply_lmp_fines.js).
// This script no longer reads any Excel file.

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

async function sync() {
  console.log(`Syncing live points for league ${LEAGUE_ID}...`);
  const leagueData = await fetchJSON(`${API}/leagues-classic/${LEAGUE_ID}/standings/`);
  const managers = leagueData.standings.results;

  const bootstrap = await fetchJSON(`${API}/bootstrap-static/`);
  const currentEvent = bootstrap.events.find(e => e.is_current)
    || [...bootstrap.events].filter(e => e.finished).pop();
  const currentGW = currentEvent ? currentEvent.id : 1;

  const playerMap = {};
  bootstrap.elements.forEach(p => {
    playerMap[p.id] = {
      web_name: p.web_name, team: p.team, element_type: p.element_type, code: p.code,
      now_cost: p.now_cost, selected_by_percent: p.selected_by_percent,
    };
  });

  // Top FPL transfers this GW (global, not mini-league)
  const topFplTransfers = [...bootstrap.elements]
    .sort((a, b) => b.transfers_in_event - a.transfers_in_event)
    .slice(0, 20)
    .map(p => ({ id: p.id, name: p.web_name, code: p.code, position: p.element_type,
      now_cost: p.now_cost, transfers_in: p.transfers_in_event, transfers_out: p.transfers_out_event,
      selected_by_percent: p.selected_by_percent }));

  const COLORS = ['#e63946','#f4845f','#4dabf7','#b197fc','#ff6b9d','#38d9a9','#9775fa','#339af0','#ff8c42','#74c0fc','#ffa94d','#5c7cfa','#c9f542','#da77f2','#63e6be','#ffe066','#ff6b6b'];

  const gwData = [];
  for (const m of managers) {
    console.log(`  ${m.player_name}...`);
    const history = await fetchJSON(`${API}/entry/${m.entry}/history/`);
    const pastGWs = history.current.filter(h => h.event <= currentGW);
    const gwPts = pastGWs.map(h => h.points - h.event_transfers_cost); // post-hits
    const gwHits = pastGWs.map(h => h.event_transfers_cost);
    const benchTotal = pastGWs.reduce((a, h) => a + (h.points_on_bench || 0), 0);
    const transfersTotal = pastGWs.reduce((a, h) => a + (h.event_transfers || 0), 0);

    const picksData = await fetchJSON(`${API}/entry/${m.entry}/event/${currentGW}/picks/`);
    const currentPicks = picksData.picks.map(p => {
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
      gwPts, gwHits, benchTotal, transfersTotal, chips: history.chips, total: m.total,
      currentCaptain: captain ? captain.name : 'Unknown',
      activeChip: picksData.active_chip, currentPicks, squadValue,
    });
  }

  // Cumulative + weekly ranks per GW
  const numGWs = gwData[0].gwPts.length;
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
  console.log(`Done. fpl_data.json updated through GW${currentGW} (${managers.length} managers).`);
}

sync().catch(e => { console.error('SYNC FAILED:', e.message); process.exit(1); });

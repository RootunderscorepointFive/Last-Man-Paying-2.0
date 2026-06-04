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
    playerMap[p.id] = { web_name: p.web_name, team: p.team, element_type: p.element_type, code: p.code };
  });

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
    const currentPicks = picksData.picks.map(p => ({
      id: p.element, name: playerMap[p.element].web_name, position: playerMap[p.element].element_type,
      code: playerMap[p.element].code, multiplier: p.multiplier,
      is_captain: p.is_captain, is_vice_captain: p.is_vice_captain,
    }));
    const captain = currentPicks.find(p => p.is_captain);

    gwData.push({
      team: m.entry_name, manager: m.player_name, entry: m.entry,
      gwPts, gwHits, benchTotal, transfersTotal, chips: history.chips, total: m.total,
      currentCaptain: captain ? captain.name : 'Unknown',
      activeChip: picksData.active_chip, currentPicks,
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

  const out = { MAX_GW: currentGW, standings, gwData, runInData };
  fs.writeFileSync(DATA_FILE, JSON.stringify(out, null, 2));
  console.log(`Done. fpl_data.json updated through GW${currentGW} (${managers.length} managers).`);
}

sync().catch(e => { console.error('SYNC FAILED:', e.message); process.exit(1); });

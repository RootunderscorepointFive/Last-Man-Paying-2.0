// Personal "brag card" data extractor — one manager's story for one gameweek,
// pulled from the same feeds as the weekly summary (see lib/weekly.js) but
// scoped to a single name instead of the whole league.

function buildBrag(fpl, ledger, config, name, gwArg) {
  const gwData = (fpl && fpl.gwData) || [];
  const entry = gwData.find(g => g.manager === name);
  if (!entry) return { ready: false, name, reason: 'manager not found' };

  const maxScored = (entry.gwPts || []).length;
  const gw = gwArg ? Number(gwArg) : maxScored;
  if (!gw || gw < 1 || gw > maxScored) return { ready: false, name, gw: gw || 0, reason: 'no scored gameweek yet' };
  const idx = gw - 1;

  const totalMgrs = gwData.length;
  const seasonTotal = entry.gwPts.slice(0, idx + 1).reduce((a, b) => a + b, 0);
  const bestGW = Math.max(...entry.gwPts.slice(0, idx + 1));
  const isLatest = gw === maxScored;

  const ledgerManager = ((ledger && ledger.managers) || []).find(m => m.name === name);

  return {
    ready: true,
    name,
    team: entry.team,
    gw,
    season: (config && config.season) || (config && config.current_season) || '',
    gwPts: entry.gwPts[idx],
    gwRank: (entry.weeklyRanks || [])[idx] || null,
    seasonTotal,
    seasonRank: (entry.gwRanks || [])[idx] || null,
    totalMgrs,
    bestGW,
    captain: isLatest ? entry.currentCaptain : null,
    tripleCaptain: isLatest && entry.activeChip === '3xc',
    epithet: (ledgerManager && ledgerManager.epithet) || null,
    epithetTagline: (ledgerManager && ledgerManager.epithet_tagline) || null,
    bottomFinishes: (ledgerManager && ledgerManager.bottom_finishes && ledgerManager.bottom_finishes.length) || 0,
  };
}

module.exports = { buildBrag };

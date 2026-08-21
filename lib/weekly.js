// Weekly-summary data extractor. Given the live feed (fpl_data.json), the money
// ledger (data.json) and config, it distils one gameweek into the numbers the
// infographic + email render. Single source of truth for both.
//
// Everything is post-hits (points - transfer cost), matching the rest of the app.

function buildWeekly(fpl, ledger, config, gwArg) {
  const gwData = (fpl && fpl.gwData) || [];
  const GW_FINE = (config && config.gw_fine) || 100;
  const FEE = (config && config.joining_fee) || 300;

  // Latest gameweek that actually has scores.
  const maxScored = gwData.reduce((m, g) => Math.max(m, (g.gwPts || []).length), 0);
  const gw = gwArg ? Number(gwArg) : maxScored;
  if (!gw || gw < 1 || gw > maxScored) {
    return { ready: false, gw: gw || 0, season: (config && config.season) || '' };
  }
  const idx = gw - 1;

  // Per-manager score this gameweek (post-hits).
  const scores = gwData
    .map(g => ({ name: g.manager, team: g.team, entry: g.entry, s: (g.gwPts || [])[idx] }))
    .filter(x => x.s != null);

  // Top scorer.
  const top = scores.slice().sort((a, b) => b.s - a.s)[0] || null;

  // The Drop — bottom-3 by the league rule (<= 3rd-lowest unique score).
  const uniq = [...new Set(scores.map(s => s.s))].sort((a, b) => a - b);
  const threshold = uniq.length >= 3 ? uniq[2] : uniq[uniq.length - 1];
  const drop = scores
    .filter(s => s.s <= threshold)
    .sort((a, b) => a.s - b.s)
    .map(d => ({ name: d.name, team: d.team, pts: d.s }));
  const finesThisGw = drop.length * GW_FINE;

  // Biggest mover — change in cumulative rank vs the previous gameweek.
  let mover = null;
  if (gw >= 2) {
    const moves = gwData.map(g => {
      const r = g.gwRanks || [];
      const cur = r[idx], prev = r[idx - 1];
      if (cur == null || prev == null) return null;
      return { name: g.manager, team: g.team, delta: prev - cur }; // + = climbed
    }).filter(Boolean).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    if (moves[0] && moves[0].delta !== 0) mover = moves[0];
  }

  // Captain of the week — league's most-captained pick (consensus). currentPicks
  // reflect the latest gameweek only, so this is populated for that gw.
  let captain = null;
  if (gw === maxScored) {
    const caps = {};
    gwData.forEach(g => {
      const c = (g.currentPicks || []).find(p => p.is_captain);
      if (!c) return;
      caps[c.id] = caps[c.id] || { name: c.name, count: 0 };
      caps[c.id].count++;
    });
    const arr = Object.values(caps).sort((a, b) => b.count - a.count);
    if (arr[0] && arr[0].count > 0) captain = arr[0];
  }

  // Prize pool — total levied (joining fees for the field + every confirmed fine).
  const mgrs = (ledger && ledger.managers) || [];
  const totalFines = mgrs.reduce((a, m) =>
    a + (m.fines || []).filter(f => !f.reversed).reduce((s, f) => s + f.amount, 0), 0);
  const poolLevied = mgrs.length * FEE + totalFines;

  // Top of the table — by season total.
  const standings = gwData
    .map(g => ({ name: g.manager, team: g.team, pts: g.total || 0 }))
    .sort((a, b) => b.pts - a.pts)
    .slice(0, 3);

  return {
    ready: true,
    gw,
    season: (config && config.season) || (config && config.current_season) || '',
    top: top ? { name: top.name, team: top.team, pts: top.s } : null,
    drop, threshold, finesThisGw,
    mover, captain, poolLevied, standings,
  };
}

module.exports = { buildWeekly };

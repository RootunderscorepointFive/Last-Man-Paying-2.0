// Deterministic epithet generator. Re-run every sync. Produces one unique
// epithet per manager. Extend by adding a rule to RULES (one line).
//
// assignEpithets(M, overridesByName) where M is an array of per-manager stat
// objects (see computeStats). overridesByName pins specific manager->epithet
// for human-curated judgment calls a linear ruleset can't express; the rest
// are assigned algorithmically. Pure + deterministic.

function computeStats(ledger, gwByEntry, ptsByName, extraByEntry) {
  const stdev = a => { if (a.length < 2) return 0; const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); };
  const streak = a => { const s = [...a].sort((x, y) => x - y); let b = 0, r = 0, p = null; for (const g of s) { r = (p !== null && g === p + 1) ? r + 1 : 1; b = Math.max(b, r); p = g; } return b; };
  const M = ledger.managers.map(m => {
    const g = gwByEntry[m.entry] || { gwPts: [], gwHits: [], weeklyRanks: [], gwRanks: [], chips: [] };
    const af = m.fines.filter(f => !f.reversed);
    const chips = g.chips || [], ranks = g.gwRanks || [];
    const ex = extraByEntry[m.entry] || { bench: 0, transfers: 0 };
    return {
      entry: m.entry, name: m.name, team: m.team,
      bottoms: m.bottom_finishes.length, streak: streak(m.bottom_finishes),
      pts: ptsByName[m.name] || g.total || 0, bestGW: Math.max(0, ...(g.gwPts || [0])),
      weeklyWins: (g.weeklyRanks || []).filter(r => r === 1).length,
      hitCost: (g.gwHits || []).reduce((a, b) => a + b, 0),
      variance: +stdev(g.gwPts || []).toFixed(1),
      chipsUnused: 8 - chips.length,
      bestChip: chips.length ? Math.max(...chips.map(c => (g.gwPts || [])[c.event - 1] || 0)) : 0,
      rankClimb: ranks.length ? Math.max(...ranks) - ranks[ranks.length - 1] : 0,
      bench: ex.bench, transfers: ex.transfers,
      outstanding: (m.joining_fee_paid ? 0 : 250) + af.filter(f => !f.paid_date).reduce((a, f) => a + f.amount, 0),
    };
  });
  // league position (1 = top)
  [...M].sort((a, b) => b.pts - a.pts).forEach((m, i) => { M.find(x => x.entry === m.entry).pos = i + 1; });
  return M;
}

const ord = n => n + ({1:'st',2:'nd',3:'rd'}[n % 100 >> 3 === 1 ? 0 : n % 10] || 'th');

// Priority order. v() higher = more deserving. e() floors stop ill-fitting cascades.
const RULES = [
  { n:"The Chef's Special", v:m=>m.pts,        e:_=>true,             t:m=>`League leader — ${m.pts.toLocaleString()} pts` },
  { n:'The Regular',        v:m=>m.bottoms,    e:m=>m.bottoms>0,      t:m=>`Most bottom finishes — ${m.bottoms} of 38` },
  { n:'Wooden Spoon',       v:m=>-m.pts,       e:_=>true,             t:m=>`Fewest total points — ${m.pts.toLocaleString()}` },
  { n:'One-Hit Wonder',     v:m=>m.bestGW,     e:_=>true,             t:m=>`One big week — season-high ${m.bestGW}, forgettable rest` },
  { n:'Old Reliable',       v:m=>m.streak,     e:m=>m.streak>=3,      t:m=>`Bottom ${m.streak} gameweeks in a row` },
  { n:'The Banker',         v:m=>m.weeklyWins, e:m=>m.weeklyWins>0,   t:m=>`Top weekly scorer ${m.weeklyWins} times` },
  { n:'The Fugitive',       v:m=>m.outstanding,e:m=>m.outstanding>0,  t:m=>`Owes the pot the most — R${m.outstanding}` },
  { n:'Best Bench',         v:m=>m.bench,      e:_=>true,             t:m=>`Left ${m.bench} points rotting on the bench` },
  { n:'The Phoenix',        v:m=>m.rankClimb,  e:m=>m.rankClimb>=2,   t:m=>`Rose from the ashes — climbed ${m.rankClimb} places` },
  { n:'Free Hit Hero',      v:m=>m.bestChip,   e:(m,M)=>m.bestChip>0 && m.bestChip===Math.max(...M.map(x=>x.bestChip)), t:m=>`Best chip week in the league — ${m.bestChip} pts` },
  { n:'The Tinkerman',      v:m=>m.transfers,  e:_=>true,             t:m=>`Can't stop fiddling — ${m.transfers} transfers, ${m.hitCost} hit pts, ${ord(m.pos)} to show for it` },
  { n:'Trigger Happy',      v:m=>m.transfers,  e:_=>true,             t:m=>`Itchy trigger finger — ${m.transfers} transfers` },
  { n:'The Patient One',    v:m=>-m.transfers, e:_=>true,             t:m=>`Only ${m.transfers} transfers all season` },
  { n:'Glass Cannon',       v:m=>m.variance,   e:_=>true,             t:m=>`Most volatile scorer — swings of ±${m.variance}` },
  { n:'Steady Eddie',       v:m=>-m.variance,  e:_=>true,             t:m=>`Steadiest scorer — swings of only ±${m.variance}` },
  { n:'The Hoarder',        v:m=>m.chipsUnused,e:m=>m.chipsUnused>=2, t:m=>`Hoarded ${m.chipsUnused} chips, never played them` },
  { n:'Departure Lounge',   v:m=>m.bottoms,    e:m=>m.bottoms>0,      t:m=>`Stuck at the relegation gate — ${m.bottoms} bottom finishes` },
  { n:'The Dark Horse',     v:m=>m.pts,        e:_=>true,             t:m=>`Quietly finished ${ord(m.pos)} without owning a single category` },
  { n:'The Vibe',           v:m=>m.pts,        e:_=>true,             t:m=>`Quietly fine — ${m.pts.toLocaleString()} pts, no fuss` },
];

function assignEpithets(M, overridesByName = {}) {
  const ruleByName = Object.fromEntries(RULES.map(r => [r.n, r]));
  const claimed = new Set(), out = {};
  // 1) pinned overrides first
  for (const [name, epName] of Object.entries(overridesByName)) {
    const m = M.find(x => x.name === name); const r = ruleByName[epName];
    if (m && r) { out[name] = { epithet: epName, tagline: r.t(m) }; claimed.add(name); }
  }
  // 2) algorithmic cascade for the rest
  for (const r of RULES) {
    if (Object.values(out).some(o => o.epithet === r.n)) continue;     // epithet used by an override
    const cand = M.filter(m => !claimed.has(m.name) && r.e(m, M)).sort((a, b) => r.v(b) - r.v(a) || a.name.localeCompare(b.name));
    if (cand.length) { out[cand[0].name] = { epithet: r.n, tagline: r.t(cand[0]) }; claimed.add(cand[0].name); }
  }
  return out;
}

module.exports = { computeStats, assignEpithets, RULES };

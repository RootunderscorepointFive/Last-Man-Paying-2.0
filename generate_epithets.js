// Writes `epithet` + `epithet_tagline` onto every manager in data.json.
// Deterministic; runs each sync. Reads stats from fpl_data.json (incl. the
// benchTotal/transfersTotal captured by sync_fpl.js) — no API calls of its own.

const fs = require('fs');
const { computeStats, assignEpithets } = require('./epithets.js');

const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const ledger = JSON.parse(fs.readFileSync('data.json', 'utf8'));
const api = JSON.parse(fs.readFileSync('fpl_data.json', 'utf8'));

const gwByEntry = {}; api.gwData.forEach(g => { gwByEntry[g.entry] = g; });
const ptsByName = {}; api.standings.forEach(s => { ptsByName[s.manager] = s.pts; });
const extraByEntry = {};
api.gwData.forEach(g => { extraByEntry[g.entry] = { bench: g.benchTotal || 0, transfers: g.transfersTotal || 0 }; });

// overrides: drop the _note key, keep manager->epithet pins
const overrides = Object.fromEntries(
  Object.entries(config.epithet_overrides || {}).filter(([k]) => !k.startsWith('_'))
);

const M = computeStats(ledger, gwByEntry, ptsByName, extraByEntry);
const assigned = assignEpithets(M, overrides);

let n = 0;
ledger.managers.forEach(m => {
  const a = assigned[m.name];
  if (a) { m.epithet = a.epithet; m.epithet_tagline = a.tagline; n++; }
  else { m.epithet = null; m.epithet_tagline = null; }
});
ledger.generated_at = new Date().toISOString();
fs.writeFileSync('data.json', JSON.stringify(ledger, null, 2));
console.log(`Epithets written for ${n}/${ledger.managers.length} managers.`);

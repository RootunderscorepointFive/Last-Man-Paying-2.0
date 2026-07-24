// PHASE 3 — FPL API integration: weekly LMP bottom-3 fine application.
//
// Pure math, no edge cases (per league rule):
//   - post-hits score = points - event_transfers_cost (no chip exceptions)
//   - threshold = 3rd-LOWEST UNIQUE score; everyone AT OR BELOW pays
//   - each payer gets a `type:bottom, status:confirmed` fine with full audit trail
//   - idempotent: re-running a GW that's already applied does nothing
//   - roster read live from the API (new managers added at zero)
//
// Anything that isn't a weekly bottom-3 fine (losers fine, disciplinary, etc.)
// is OUT OF SCOPE here — that's manual, via the Phase 6 treasurer actions.
//
// Usage:
//   node apply_lmp_fines.js --gw=34 --dry-run   # report only, no write
//   node apply_lmp_fines.js                      # latest finished GW, writes data.json

const fs = require('fs');

const API = 'https://fantasy.premierleague.com/api';
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const LEAGUE_ID = config.fpl_league_id;
const GW_FINE = config.gw_fine;

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const gwArg = args.find(a => a.startsWith('--gw='));
let targetGW = gwArg ? parseInt(gwArg.split('=')[1], 10) : null;

async function fetchJSON(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'LMP-Terminal/1.0' } });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.json();
}

// The rule, isolated and testable.
function computeBottom3(scores) {
  const unique = [...new Set(scores.map(s => s.score))].sort((a, b) => a - b);
  const threshold = unique.length >= 3 ? unique[2] : unique[unique.length - 1];
  const payers = scores.filter(s => s.score <= threshold).sort((a, b) => a.score - b.score);
  return { threshold, payers };
}

async function main() {
  const data = JSON.parse(fs.readFileSync('data.json', 'utf8'));

  const league = await fetchJSON(`${API}/leagues-classic/${LEAGUE_ID}/standings/`);
  const entries = league.standings.results; // dynamic — absorbs roster changes
  if (config.managers && config.managers.expected_count && entries.length !== config.managers.expected_count) {
    console.warn(`⚠ roster size ${entries.length} != expected ${config.managers.expected_count} (sanity-check only, continuing)`);
  }

  const bootstrap = await fetchJSON(`${API}/bootstrap-static/`);
  const finished = bootstrap.events.filter(e => e.finished).map(e => e.id);
  const latestFinished = finished.length ? Math.max(...finished) : null;
  if (targetGW == null) targetGW = latestFinished;
  if (targetGW == null) { console.log('No finished GW yet — nothing to fine. Exiting cleanly.'); return; }

  // Reconcile roster: every live entry must have a manager record.
  const byEntry = {};
  data.managers.forEach(m => { byEntry[m.entry] = m; });
  for (const e of entries) {
    if (!byEntry[e.entry]) {
      const rec = { entry: e.entry, name: e.player_name, team: e.entry_name,
                    joining_fee_paid: false, fines: [], bottom_finishes: [] };
      data.managers.push(rec); byEntry[e.entry] = rec;
      console.log(`+ new manager added at zero: ${e.player_name} (${e.entry_name})`);
    } else {
      byEntry[e.entry].name = e.player_name;   // keep names/teams fresh
      byEntry[e.entry].team = e.entry_name;
    }
  }

  // Post-hits score for the target GW, per entry.
  const scores = [];
  for (const e of entries) {
    const hist = await fetchJSON(`${API}/entry/${e.entry}/history/`);
    const row = hist.current.find(h => h.event === targetGW);
    if (!row) { console.warn(`  no GW${targetGW} history for ${e.player_name}`); continue; }
    scores.push({ entry: e.entry, name: e.player_name, team: e.entry_name,
                  score: row.points - row.event_transfers_cost });
  }

  const { threshold, payers } = computeBottom3(scores);

  console.log(`\n=== LMP bottom-3 — GW${targetGW} ${DRY_RUN ? '(DRY RUN)' : ''} ===`);
  console.log(`Scores (post-hits): ${scores.map(s => s.score).sort((a, b) => a - b).join(', ')}`);
  console.log(`3rd-lowest unique = threshold: ${threshold}`);
  console.log(`Payers (${payers.length}):`);
  payers.forEach(p => console.log(`   R${GW_FINE}  ${p.name.padEnd(24)} ${String(p.score).padStart(3)} pts  (${p.team})`));

  // Apply (idempotent).
  const now = new Date().toISOString();
  let applied = 0, skipped = 0;
  for (const p of payers) {
    const m = byEntry[p.entry];
    const already = m.fines.some(f => f.type === 'bottom' && f.gw === targetGW && !f.reversed);
    if (already) { skipped++; continue; }
    applied++;
    if (DRY_RUN) continue;
    m.fines.push({
      id: `f_${p.entry}_gw${targetGW}_bottom`,
      gw: targetGW, amount: GW_FINE, type: 'bottom', status: 'confirmed',
      reason: `LMP bottom-3 — GW${targetGW} (post-hits ${p.score}, threshold ${threshold})`,
      paid_date: null,
      reversed: false, reversed_reason: null, reversed_by: null, reversed_date: null,
      added_by: 'fpl-api', added_date: now, edited_by: null, edited_date: null, edit_history: [],
    });
    if (!m.bottom_finishes.includes(targetGW)) m.bottom_finishes.push(targetGW);
  }

  console.log(`\n${applied} fine(s) ${DRY_RUN ? 'would be' : ''} applied, ${skipped} already present (idempotent).`);

  if (!DRY_RUN && applied > 0) {
    data.last_synced_gw = Math.max(data.last_synced_gw || 0, targetGW);
    data.generated_at = now;
    fs.writeFileSync('data.json', JSON.stringify(data, null, 2));
    console.log('data.json updated.');
  } else if (!DRY_RUN) {
    console.log('No changes to write.');
  }
}

main().catch(e => { console.error('SYNC FAILED:', e.message); process.exit(1); });

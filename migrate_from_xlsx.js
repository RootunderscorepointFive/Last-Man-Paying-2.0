// ONE-TIME MIGRATION: Excel (source of truth for money) -> data.json (new shape)
// Run: node migrate_from_xlsx.js
// Produces: data.json (proposed) + prints a full reconciliation table.
// Does NOT touch index.html, fpl_data.json, or the xlsx. Non-destructive.

const fs = require('fs');
const xlsx = require('xlsx');

const XLSX_FILE = 'FPL 2025 updated for GW34.xlsx';
const JOINING_FEE = 250;
const GW_FINE = 100;
const GENERATED_AT = new Date().toISOString();

const wb = xlsx.readFile(XLSX_FILE);

// ---- 1. Entry-ID + team map (stable key for Phase 3) from existing fpl_data.json
const fpl = JSON.parse(fs.readFileSync('fpl_data.json', 'utf8'));
const byName = {};
fpl.gwData.forEach(m => { byName[norm(m.manager)] = { entry: m.entry, team: m.team }; });

function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

// ---- 2. Budget sheet: Amount / Fines / GW20 Fines / GW21 Fines / Total / Paid / Outstanding
const budgetRows = xlsx.utils.sheet_to_json(wb.Sheets['Budget'], { header: 1, defval: '' });
const budget = {};
for (const r of budgetRows) {
  const name = norm(r[1]);
  if (!name || name === 'Loser' || name === 'Total' || name === 'Average') continue;
  budget[name] = {
    amount:      Number(r[2] || 0),   // 250 joining + bottom fines (per league convention)
    fineGeneric: Number(r[3] || 0),   // "Fines" (no GW attribution)
    fineGW20:    Number(r[4] || 0),   // "GW20 Fines" (disciplinary)
    fineGW21:    Number(r[5] || 0),   // "GW21 Fines" (disciplinary)
    total:       Number(r[6] || 0),   // Total owed
    paid:        Number(r[7] || 0),   // Amount Paid
    outstanding: Number(r[8] || 0),   // Outstanding
  };
}

// ---- 3. LMP 2.0 sheet: authoritative per-GW bottom finishers
const lmpRows = xlsx.utils.sheet_to_json(wb.Sheets['Last Man Paying 2.0'], { header: 1, defval: '' });
const bottomFinishes = {}; // name -> [gw,...]
let curGW = null;
for (let i = 25; i < lmpRows.length; i++) {
  const r = lmpRows[i];
  const m = String(r[1] || '').match(/GW\s*(\d+)/);
  if (m) curGW = parseInt(m[1]);
  const name = norm(r[3]);
  if (name && curGW != null) {
    (bottomFinishes[name] = bottomFinishes[name] || []).push(curGW);
  }
}

// ---- 4. Build manager records + reconcile
const SETTLED = 'migrated';      // sentinel: paid before the new system (exact date not in source)
const UNPAID = null;

const managers = [];
const recon = [];

for (const name of Object.keys(budget)) {
  const b = budget[name];
  const meta = byName[name] || { entry: null, team: null };
  const bf = (bottomFinishes[name] || []).slice().sort((a, b2) => a - b2);

  // Every fine — auto or manual — carries the same audit metadata. Disputes get
  // settled by showing the record. `type` extends the {gw,amount,paid_date} shape.
  let fineSeq = 0;
  const mkFine = (gw, amount, type, reason, paid_date) => ({
    id: `f_${meta.entry || name.replace(/\W+/g, '')}_${++fineSeq}`,
    gw,
    amount,
    type,
    status: 'confirmed',
    reason,
    paid_date,
    reversed: false,
    reversed_reason: null,
    reversed_by: null,
    reversed_date: null,
    added_by: 'migration',
    added_date: GENERATED_AT,
    edited_by: null,
    edited_date: null,
    edit_history: [],
  });

  const fines = [];
  bf.forEach(gw => fines.push(mkFine(gw, GW_FINE, 'bottom', `LMP bottom finish — GW${gw}`, SETTLED)));
  if (b.fineGeneric) fines.push(mkFine(null, b.fineGeneric, 'disciplinary', 'Migrated from Excel — disciplinary fine', SETTLED));
  if (b.fineGW20)    fines.push(mkFine(20, b.fineGW20, 'disciplinary', 'Migrated from Excel — GW20 disciplinary fine', SETTLED));
  if (b.fineGW21)    fines.push(mkFine(21, b.fineGW21, 'disciplinary', 'Migrated from Excel — GW21 disciplinary fine', SETTLED));

  // Relaxed reconciliation: any gap vs Budget Total is recorded as a flagged
  // adjustment so the closing season stays tidy. Not chased to root cause.
  const finesSum = fines.reduce((a, f) => a + f.amount, 0);
  const computed = JOINING_FEE + finesSum;
  const adjustment = b.total - computed;
  if (adjustment !== 0) {
    fines.push(mkFine(null, adjustment, 'adjustment',
      'Migrated balancing adjustment (historical Excel discrepancy, accepted)', SETTLED));
  }

  // Payment status from aggregate Excel data.
  // Everyone has paid >= joining, so joining_fee_paid = true.
  // If outstanding > 0, leave that amount unpaid on the latest fine(s).
  let joining_fee_paid = true;
  let outstanding = b.outstanding;
  if (outstanding > 0) {
    // Mark latest fines unpaid until we've covered the outstanding balance.
    for (let i = fines.length - 1; i >= 0 && outstanding > 0; i--) {
      if (fines[i].amount <= outstanding) {
        fines[i].paid_date = UNPAID;
        outstanding -= fines[i].amount;
      }
    }
  }

  managers.push({
    entry: meta.entry,
    name,
    team: meta.team,
    joining_fee_paid,
    fines,
    bottom_finishes: bf,
  });

  recon.push({
    name,
    bottoms: bf.length,
    excelAmount: b.amount,
    excelTotal: b.total,
    excelPaid: b.paid,
    excelOut: b.outstanding,
    migJoin: JOINING_FEE,
    migFines: finesSum,
    migTotal: computed + (adjustment !== 0 ? adjustment : 0),
    adjustment,
  });
}

// ---- 4b. Known corrections (NOT a broader reconciliation — one-off fixes for
// entries we've confirmed were mis-recorded in the Excel sheet).
const KNOWN_CORRECTIONS = [
  { name: 'Minenhle Khumalo', gw: 38, fromType: 'bottom', toType: 'losers_fine',
    reason: 'End-of-season losers fine (manual penalty recorded against GW38 in Excel, not an LMP bottom-3 result)' },
];
for (const c of KNOWN_CORRECTIONS) {
  const m = managers.find(x => x.name === c.name);
  if (!m) continue;
  const f = m.fines.find(x => x.type === c.fromType && x.gw === c.gw);
  if (f) { f.type = c.toType; f.reason = c.reason; }
  if (c.toType !== 'bottom') m.bottom_finishes = m.bottom_finishes.filter(g => g !== c.gw);
}

// ---- 5. data.json
const data = {
  generated_at: GENERATED_AT,
  source: 'one-time migration from ' + XLSX_FILE,
  last_synced_gw: fpl.MAX_GW,
  managers: managers.sort((a, b) => b.bottom_finishes.length - a.bottom_finishes.length),
};
fs.writeFileSync('data.json', JSON.stringify(data, null, 2));

// ---- 6. Reconciliation report
console.log('\n=== RECONCILIATION: migrated vs Excel (per manager) ===');
console.log('NAME'.padEnd(24), 'BTM', 'ExcelTot'.padStart(9), 'MigTot'.padStart(8), 'ADJ'.padStart(6), 'Paid'.padStart(8), 'Out'.padStart(6));
let eTot = 0, mTot = 0, ePaid = 0, eOut = 0, adjFlags = 0;
recon.sort((a, b) => b.bottoms - a.bottoms).forEach(r => {
  eTot += r.excelTotal; mTot += r.migTotal; ePaid += r.excelPaid; eOut += r.excelOut;
  if (r.adjustment !== 0) adjFlags++;
  const flag = r.adjustment !== 0 ? '  <-- ADJ ' + r.adjustment : (r.migTotal === r.excelTotal ? '' : '  <-- MISMATCH');
  console.log(
    r.name.padEnd(24),
    String(r.bottoms).padStart(3),
    String(r.excelTotal).padStart(9),
    String(r.migTotal).padStart(8),
    String(r.adjustment).padStart(6),
    String(r.excelPaid).padStart(8),
    String(r.excelOut).padStart(6),
    flag
  );
});
console.log('-'.repeat(78));
console.log('TOTALS'.padEnd(24), '   ', String(eTot).padStart(9), String(mTot).padStart(8), '      ', String(ePaid).padStart(8), String(eOut).padStart(6));
console.log('\nExcel grand total owed :', eTot);
console.log('Migrated grand total   :', mTot, mTot === eTot ? '  OK (balanced)' : '  !! MISMATCH');
console.log('Excel collected (paid) :', ePaid);
console.log('Excel outstanding      :', eOut);
console.log('Prize pool (joining+fines collected) =', ePaid);
console.log('Managers needing review (adjustments):', adjFlags);

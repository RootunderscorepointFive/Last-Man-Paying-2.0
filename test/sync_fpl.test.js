const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeGwPts } = require('../sync_fpl');

test('computeGwPts: finished GWs net the hit from row.points', () => {
  const rows = [
    { event: 1, points: 60, event_transfers_cost: 0 },
    { event: 2, points: 70, event_transfers_cost: 4 },
  ];
  const { gwPts, gwHits } = computeGwPts(rows, 3, 190);
  assert.deepEqual(gwHits, [0, 4, 0]);
  assert.equal(gwPts[0], 60);
  assert.equal(gwPts[1], 66); // 70 - 4
});

test('computeGwPts: the live GW does NOT subtract its hit a second time (regression for the double-count bug)', () => {
  // Two finished GWs (60, then 66 net-of-a-4-hit) = 126 settled so far.
  // League total is already-live and already nets this GW's own hit — the
  // bug was subtracting `hits` again here, undercounting by exactly that.
  const rows = [
    { event: 1, points: 60, event_transfers_cost: 0 },
    { event: 2, points: 70, event_transfers_cost: 4 },
  ];
  const mTotal = 185; // 126 settled + 59 this GW (GW3's own hit already netted in)
  const { gwPts, gwHits } = computeGwPts(rows, 3, mTotal);
  assert.equal(gwHits[2], 0); // no row for GW3 yet — hit not knowable from history
  assert.equal(gwPts[2], 59); // 185 - 126, NOT 185 - 126 - hits
  assert.equal(gwPts.reduce((a, b) => a + b, 0), mTotal); // sum must equal total, always
});

test('computeGwPts: live GW with a known hit (row already exists, e.g. re-synced after a late history update) still isn\'t double-subtracted', () => {
  const rows = [
    { event: 1, points: 60, event_transfers_cost: 0 },
    { event: 2, points: 70, event_transfers_cost: 4 },
    { event: 3, points: 0, event_transfers_cost: 4 }, // history hasn't settled GW3's points yet, but the hit is known
  ];
  const mTotal = 185;
  const { gwPts, gwHits } = computeGwPts(rows, 3, mTotal);
  assert.equal(gwHits[2], 4);
  assert.equal(gwPts[2], 59); // still 185 - 126 — the known hit must not be subtracted again
  assert.equal(gwPts.reduce((a, b) => a + b, 0), mTotal);
});

test('computeGwPts: no hits anywhere sums cleanly', () => {
  const rows = [
    { event: 1, points: 50, event_transfers_cost: 0 },
    { event: 2, points: 55, event_transfers_cost: 0 },
  ];
  const { gwPts, gwHits } = computeGwPts(rows, 3, 160);
  assert.deepEqual(gwHits, [0, 0, 0]);
  assert.deepEqual(gwPts, [50, 55, 55]);
  assert.equal(gwPts.reduce((a, b) => a + b, 0), 160);
});

test('computeGwPts: a missing history row (brand new manager) treats the finished GW as 0, not a crash', () => {
  const rows = [{ event: 2, points: 40, event_transfers_cost: 0 }];
  const { gwPts, gwHits } = computeGwPts(rows, 2, 40);
  assert.equal(gwPts[0], 0); // no GW1 row
  assert.equal(gwHits[0], 0);
  assert.equal(gwPts[1], 40);
});

test('computeGwPts: sum(gwPts) always equals mTotal regardless of hit pattern (the property the original bug violated)', () => {
  const scenarios = [
    { rows: [{ event: 1, points: 60, event_transfers_cost: 0 }], currentGW: 2, mTotal: 130 },
    { rows: [{ event: 1, points: 60, event_transfers_cost: 8 }], currentGW: 2, mTotal: 100 },
    { rows: [], currentGW: 1, mTotal: 45 },
  ];
  for (const { rows, currentGW, mTotal } of scenarios) {
    const { gwPts } = computeGwPts(rows, currentGW, mTotal);
    assert.equal(gwPts.reduce((a, b) => a + b, 0), mTotal, `mismatch for ${JSON.stringify({ rows, currentGW, mTotal })}`);
  }
});

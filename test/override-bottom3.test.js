const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyOverride } = require('../api/override-bottom3');

function manager(overrides) {
  return { entry: 1, name: 'Alice', team: 'Team A', fines: [], bottom_finishes: [], ...overrides };
}

test('applyOverride: adding a manager who was not already flagged creates a fine and records the GW', () => {
  const data = { managers: [manager()] };
  applyOverride(data, { gw: 5, payers: ['Alice'], reason: 'FPL API bug' }, '2026-01-01T00:00:00.000Z');
  const m = data.managers[0];
  assert.deepEqual(m.bottom_finishes, [5]);
  assert.equal(m.fines.length, 1);
  assert.equal(m.fines[0].type, 'bottom');
  assert.equal(m.fines[0].gw, 5);
  assert.equal(m.fines[0].amount, 100);
  assert.equal(m.fines[0].reversed, false);
  assert.equal(m.fines[0].added_by, 'treasurer-override');
});

test('applyOverride: removing a manager reverses their active fine for that GW and drops it from bottom_finishes', () => {
  const data = { managers: [manager({
    bottom_finishes: [5],
    fines: [{ id: 'f_1_gw5_bottom', gw: 5, type: 'bottom', reversed: false }],
  })] };
  applyOverride(data, { gw: 5, payers: [], reason: 'FPL API bug' }, '2026-01-01T00:00:00.000Z');
  const m = data.managers[0];
  assert.deepEqual(m.bottom_finishes, []);
  assert.equal(m.fines[0].reversed, true);
  assert.equal(m.fines[0].reversed_by, 'treasurer');
  assert.match(m.fines[0].reversed_reason, /FPL API bug/);
});

test('applyOverride: a manager already correctly flagged is left untouched (idempotent)', () => {
  const existingFine = { id: 'f_1_gw5_bottom', gw: 5, type: 'bottom', reversed: false };
  const data = { managers: [manager({ bottom_finishes: [5], fines: [existingFine] })] };
  applyOverride(data, { gw: 5, payers: ['Alice'], reason: 'confirm' }, '2026-01-01T00:00:00.000Z');
  const m = data.managers[0];
  assert.deepEqual(m.bottom_finishes, [5]);
  assert.equal(m.fines.length, 1);
  assert.equal(m.fines[0], existingFine);
  assert.equal(m.fines[0].reversed, false);
});

test('applyOverride: a manager already correctly NOT flagged is left untouched', () => {
  const data = { managers: [manager()] };
  applyOverride(data, { gw: 5, payers: [], reason: 'confirm' }, '2026-01-01T00:00:00.000Z');
  const m = data.managers[0];
  assert.deepEqual(m.bottom_finishes, []);
  assert.equal(m.fines.length, 0);
});

test('applyOverride: removing a manager whose fine was already reversed does not throw, and still clears bottom_finishes', () => {
  const data = { managers: [manager({
    bottom_finishes: [5],
    fines: [{ id: 'f_1_gw5_bottom', gw: 5, type: 'bottom', reversed: true }],
  })] };
  assert.doesNotThrow(() => {
    applyOverride(data, { gw: 5, payers: [], reason: 'already handled' }, '2026-01-01T00:00:00.000Z');
  });
  assert.deepEqual(data.managers[0].bottom_finishes, []);
});

test('applyOverride: only touches the named GW, leaving fines/flags for other GWs alone', () => {
  const data = { managers: [manager({
    bottom_finishes: [3, 5],
    fines: [
      { id: 'f_1_gw3_bottom', gw: 3, type: 'bottom', reversed: false },
      { id: 'f_1_gw5_bottom', gw: 5, type: 'bottom', reversed: false },
    ],
  })] };
  applyOverride(data, { gw: 5, payers: [], reason: 'GW5 only' }, '2026-01-01T00:00:00.000Z');
  const m = data.managers[0];
  assert.deepEqual(m.bottom_finishes, [3]);
  assert.equal(m.fines.find(f => f.gw === 3).reversed, false);
  assert.equal(m.fines.find(f => f.gw === 5).reversed, true);
});

test('applyOverride: multiple managers reconciled independently in one call', () => {
  const data = { managers: [
    manager({ entry: 1, name: 'Alice' }), // not flagged, should become flagged
    manager({ entry: 2, name: 'Bob', bottom_finishes: [5], fines: [{ id: 'f_2_gw5_bottom', gw: 5, type: 'bottom', reversed: false }] }), // flagged, should be un-flagged
    manager({ entry: 3, name: 'Carol', bottom_finishes: [5], fines: [{ id: 'f_3_gw5_bottom', gw: 5, type: 'bottom', reversed: false }] }), // flagged, stays flagged
  ] };
  applyOverride(data, { gw: 5, payers: ['Alice', 'Carol'], reason: 'dispute' }, '2026-01-01T00:00:00.000Z');
  const [alice, bob, carol] = data.managers;
  assert.deepEqual(alice.bottom_finishes, [5]);
  assert.equal(alice.fines.length, 1);
  assert.deepEqual(bob.bottom_finishes, []);
  assert.equal(bob.fines[0].reversed, true);
  assert.deepEqual(carol.bottom_finishes, [5]);
  assert.equal(carol.fines[0].reversed, false);
});

test('applyOverride: logs an entry to data.overrides with the payer list and reason', () => {
  const data = { managers: [manager()] };
  applyOverride(data, { gw: 5, payers: ['Alice'], reason: 'FPL API bug' }, '2026-01-01T00:00:00.000Z');
  assert.equal(data.overrides.length, 1);
  assert.deepEqual(data.overrides[0].payers, ['Alice']);
  assert.equal(data.overrides[0].gw, 5);
  assert.equal(data.overrides[0].reason, 'FPL API bug');
  assert.equal(data.overrides[0].by, 'treasurer');
});

test('applyOverride: sets data.generated_at to the passed-in timestamp', () => {
  const data = { managers: [manager()] };
  applyOverride(data, { gw: 5, payers: [], reason: 'x' }, '2026-03-03T00:00:00.000Z');
  assert.equal(data.generated_at, '2026-03-03T00:00:00.000Z');
});

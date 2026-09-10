const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeBottom3, rosterOf } = require('../apply_lmp_fines');

test('computeBottom3: normal case — threshold is the 3rd-lowest unique score, payers are everyone at or below it', () => {
  const scores = [
    { entry: 1, name: 'A', score: 80 },
    { entry: 2, name: 'B', score: 70 },
    { entry: 3, name: 'C', score: 60 },
    { entry: 4, name: 'D', score: 50 },
    { entry: 5, name: 'E', score: 40 },
  ];
  const { threshold, payers } = computeBottom3(scores);
  assert.equal(threshold, 60);
  assert.deepEqual(payers.map(p => p.name), ['E', 'D', 'C']);
});

test('computeBottom3: a tie AT the threshold means more than 3 people pay', () => {
  const scores = [
    { entry: 1, name: 'A', score: 80 },
    { entry: 2, name: 'B', score: 60 },
    { entry: 3, name: 'C', score: 60 },
    { entry: 4, name: 'D', score: 50 },
    { entry: 5, name: 'E', score: 40 },
  ];
  // unique scores: 40,50,60,80 -> 3rd lowest unique = 60 -> everyone <= 60 pays
  const { threshold, payers } = computeBottom3(scores);
  assert.equal(threshold, 60);
  assert.deepEqual(payers.map(p => p.name).sort(), ['B', 'C', 'D', 'E']);
});

test('computeBottom3: a tie BELOW the threshold does not change who else pays', () => {
  const scores = [
    { entry: 1, name: 'A', score: 80 },
    { entry: 2, name: 'B', score: 70 },
    { entry: 3, name: 'C', score: 60 },
    { entry: 4, name: 'D', score: 40 },
    { entry: 5, name: 'E', score: 40 },
  ];
  // unique scores: 40,60,70,80 -> 3rd lowest unique = 70 -> everyone <= 70 pays
  const { threshold, payers } = computeBottom3(scores);
  assert.equal(threshold, 70);
  assert.deepEqual(payers.map(p => p.name).sort(), ['B', 'C', 'D', 'E']);
});

test('computeBottom3: fewer than 3 unique scores in the league falls back to everyone paying', () => {
  const scores = [
    { entry: 1, name: 'A', score: 50 },
    { entry: 2, name: 'B', score: 50 },
    { entry: 3, name: 'C', score: 40 },
  ];
  // unique scores: 40,50 (only 2) -> threshold = highest unique value -> everyone <= it pays
  const { threshold, payers } = computeBottom3(scores);
  assert.equal(threshold, 50);
  assert.deepEqual(payers.map(p => p.name).sort(), ['A', 'B', 'C']);
});

test('computeBottom3: everyone tied on the same score means everyone pays', () => {
  const scores = [
    { entry: 1, name: 'A', score: 55 },
    { entry: 2, name: 'B', score: 55 },
    { entry: 3, name: 'C', score: 55 },
    { entry: 4, name: 'D', score: 55 },
  ];
  const { threshold, payers } = computeBottom3(scores);
  assert.equal(threshold, 55);
  assert.equal(payers.length, 4);
});

test('computeBottom3: payers come back sorted lowest score first', () => {
  const scores = [
    { entry: 1, name: 'A', score: 30 },
    { entry: 2, name: 'B', score: 10 },
    { entry: 3, name: 'C', score: 20 },
    { entry: 4, name: 'D', score: 90 },
  ];
  const { payers } = computeBottom3(scores);
  assert.deepEqual(payers.map(p => p.score), [10, 20, 30]);
});

test('rosterOf: unions standings and new_entries, de-duped by entry (standings wins)', () => {
  const league = {
    standings: { results: [
      { entry: 1, entry_name: 'Team A', player_name: 'Alice' },
    ] },
    new_entries: { results: [
      { entry: 1, entry_name: 'Team A (stale)', player_name: 'Alice (stale)' },
      { entry: 2, entry_name: 'Team B', player_name: 'Bob' },
    ] },
  };
  const roster = rosterOf(league);
  assert.equal(roster.length, 2);
  assert.deepEqual(roster.find(r => r.entry === 1), { entry: 1, entry_name: 'Team A', player_name: 'Alice' });
  assert.deepEqual(roster.find(r => r.entry === 2), { entry: 2, entry_name: 'Team B', player_name: 'Bob' });
});

test('rosterOf: falls back to first+last name when player_name is absent', () => {
  const league = {
    standings: { results: [
      { entry: 3, entry_name: 'Team C', player_first_name: 'Carol', player_last_name: 'Jones' },
    ] },
    new_entries: { results: [] },
  };
  const roster = rosterOf(league);
  assert.equal(roster[0].player_name, 'Carol Jones');
});

test('rosterOf: missing both name sources falls back to "Unknown" rather than throwing', () => {
  const league = { standings: { results: [{ entry: 4, entry_name: 'Team D' }] }, new_entries: { results: [] } };
  const roster = rosterOf(league);
  assert.equal(roster[0].player_name, 'Unknown');
});

test('rosterOf: no standings yet (pre-season) reads entirely from new_entries', () => {
  const league = { standings: { results: [] }, new_entries: { results: [
    { entry: 5, entry_name: 'Team E', player_name: 'Eve' },
  ] } };
  const roster = rosterOf(league);
  assert.deepEqual(roster.map(r => r.player_name), ['Eve']);
});

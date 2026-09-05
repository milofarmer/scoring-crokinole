import test from 'node:test';
import assert from 'node:assert/strict';
import { pairTeams, previousOpponents, shuffled } from '../src/core/draw.ts';

test('everyone is drawn exactly once', () => {
  const pairs = pairTeams([1, 2, 3, 4, 5, 6], new Map());
  const drawn = pairs.flatMap(([a, b]) => (b === null ? [a] : [a, b]));
  assert.equal(pairs.length, 3);
  assert.deepEqual([...drawn].sort((x, y) => x - y), [1, 2, 3, 4, 5, 6]);
});

test('an odd field leaves exactly one bye', () => {
  const pairs = pairTeams([1, 2, 3, 4, 5], new Map());
  const byes = pairs.filter(([, b]) => b === null);
  assert.equal(byes.length, 1);
  assert.equal(byes[0]?.[0], 5, 'the last team down the order sits out');
});

test('Swiss pairing avoids a rematch when it can', () => {
  // 1 has already played 2, so the top pairing must slide to the next team.
  const played = new Map([
    [1, new Set([2])],
    [2, new Set([1])],
  ]);
  const pairs = pairTeams([1, 2, 3, 4], played);
  assert.deepEqual(pairs[0], [1, 3]);
  assert.deepEqual(pairs[1], [2, 4]);
});

test('when every opponent is a repeat it still produces a draw', () => {
  // Two teams that have already met, and nobody else: a rematch beats no match.
  const played = new Map([
    [1, new Set([2])],
    [2, new Set([1])],
  ]);
  const pairs = pairTeams([1, 2], played);
  assert.deepEqual(pairs, [[1, 2]]);
});

test('previous opponents are read from earlier rounds only', () => {
  const matches = [
    { round: 1, teamAId: 1, teamBId: 2 },
    { round: 2, teamAId: 1, teamBId: 3 },
    { round: 3, teamAId: 1, teamBId: 4 }, // not yet played when drawing round 3
  ];
  const before3 = previousOpponents(matches, 3);
  assert.deepEqual([...(before3.get(1) ?? [])].sort((a, b) => a - b), [2, 3]);
  assert.equal(before3.get(4), undefined);
});

test('byes are ignored when remembering opponents', () => {
  const seen = previousOpponents([{ round: 1, teamAId: 1, teamBId: null }], 2);
  assert.equal(seen.get(1), undefined);
});

test('shuffling keeps every team, and is deterministic with a fixed source', () => {
  const input = [1, 2, 3, 4, 5];
  const out = shuffled(input, () => 0.5);
  assert.deepEqual([...out].sort((a, b) => a - b), input);
  assert.deepEqual(out, shuffled(input, () => 0.5), 'same source, same draw');
  assert.deepEqual(input, [1, 2, 3, 4, 5], 'the caller’s array is untouched');
});

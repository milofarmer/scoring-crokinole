import test from 'node:test';
import assert from 'node:assert/strict';
import {
  byesNeeded,
  entryNoun,
  finalistCount,
  planPoules,
  poulePlan,
  pouleName,
  playersPerEntry,
} from '../src/core/setup.ts';

test('a singles entry is one player, a doubles entry is two', () => {
  assert.equal(playersPerEntry('singles'), 1);
  assert.equal(playersPerEntry('doubles'), 2);
  assert.equal(entryNoun('singles'), 'player');
  assert.equal(entryNoun('doubles', true), 'teams');
});

test('44 entrants split into eleven poules of four', () => {
  assert.deepEqual(planPoules(44, 4), Array.from({ length: 11 }, () => 4));
});

test('poules stay as even as possible when the field does not divide cleanly', () => {
  const sizes = planPoules(44, 8);
  assert.equal(sizes.reduce((a, b) => a + b, 0), 44, 'everyone is placed');
  const smallest = Math.min(...sizes);
  const largest = Math.max(...sizes);
  assert.ok(largest - smallest <= 1, `sizes differ by more than one: ${sizes.join(',')}`);
});

test('every entrant is placed, for any field size', () => {
  for (let entrants = 2; entrants <= 120; entrants += 1) {
    for (const target of [4, 5, 6, 8]) {
      const sizes = planPoules(entrants, target);
      assert.equal(sizes.reduce((a, b) => a + b, 0), entrants, `lost someone at ${entrants}/${target}`);
      assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `uneven at ${entrants}/${target}`);
    }
  }
});

test('an empty or tiny field does not produce nonsense', () => {
  assert.deepEqual(planPoules(0, 4), []);
  assert.deepEqual(planPoules(3, 4), [3], 'too few for two poules, so one poule');
});

test('poules are named A, B, C and keep going past Z', () => {
  assert.equal(pouleName(0), 'A');
  assert.equal(pouleName(10), 'K');
  assert.equal(pouleName(25), 'Z');
  assert.equal(pouleName(26), 'AA');
});

test('a plan pairs each poule name with its size', () => {
  const plan = poulePlan(12, 4);
  assert.deepEqual(plan, [
    { name: 'A', size: 4 },
    { name: 'B', size: 4 },
    { name: 'C', size: 4 },
  ]);
});

test('the organiser can see the bracket size before drawing it', () => {
  // Eleven poule winners plus the best five runners-up is a clean sixteen.
  assert.equal(finalistCount(11, 1, 5), 16);
  assert.equal(byesNeeded(16), 0);
  // Twelve would need four byes to fill a sixteen-team bracket.
  assert.equal(finalistCount(11, 1, 1), 12);
  assert.equal(byesNeeded(12), 4);
});

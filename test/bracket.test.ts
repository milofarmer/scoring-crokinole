import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceTarget,
  bracketOrder,
  bracketSize,
  firstRoundPairs,
  koLabel,
  selectQualifiers,
} from '../src/core/bracket.ts';
import type { RankedTeam } from '../src/types/index.ts';

function ranked(teamId: number, points: number, twenties: number, pouleId = 1): RankedTeam {
  return {
    teamId,
    played: 4,
    wins: 0,
    ties: 0,
    losses: 0,
    points,
    twenties,
    pointsFor: 0,
    pointsAgainst: 0,
    name: `Team ${teamId}`,
    number: teamId,
    pouleId,
    player1: '',
    player2: '',
  };
}

test('bracket order keeps the top seeds apart until the end', () => {
  assert.deepEqual(bracketOrder(2), [1, 2]);
  assert.deepEqual(bracketOrder(4), [1, 4, 2, 3]);
  assert.deepEqual(bracketOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
  // Seeds 1 and 2 sit in opposite halves, so they can only meet in the final.
  const order = bracketOrder(16);
  assert.equal(order.indexOf(1) < 8, true);
  assert.equal(order.indexOf(2) >= 8, true);
});

test('the draw is rounded up to a power of two', () => {
  assert.equal(bracketSize(2), 2);
  assert.equal(bracketSize(9), 16);
  assert.equal(bracketSize(16), 16);
});

test('rounds are named by how many matches they hold', () => {
  assert.equal(koLabel(1), 'Final');
  assert.equal(koLabel(2), 'Semi-finals');
  assert.equal(koLabel(4), 'Quarter-finals');
  assert.equal(koLabel(8), 'Round of 16');
});

test('all poule winners plus the best runners-up qualify', () => {
  // Eleven poules; every winner goes through, plus the best five No.2's.
  const poules = Array.from({ length: 11 }, (_, i) => [
    ranked(100 + i, 6, 20, i + 1), // winner
    ranked(200 + i, 4, 30 - i, i + 1), // runner-up, descending 20's
  ]);
  const seeds = selectQualifiers(poules, 1, 5);

  assert.equal(seeds.length, 16, '11 winners + 5 wildcards');
  assert.equal(seeds.filter((s) => s.pos === 1).length, 11);
  assert.equal(seeds.filter((s) => s.pos === 2).length, 5);
  // Winners are seeded ahead of every wildcard.
  assert.ok(seeds.slice(0, 11).every((s) => s.pos === 1));
});

test("runners-up are compared on points then 20's, so the best five get in", () => {
  const poules = [
    [ranked(1, 6, 0), ranked(11, 4, 22)],
    [ranked(2, 6, 0), ranked(12, 4, 19)],
    [ranked(3, 6, 0), ranked(13, 4, 18)], // misses out on 20's
    [ranked(4, 6, 0), ranked(14, 5, 1)], // more points, gets in regardless of 20's
  ];
  const seeds = selectQualifiers(poules, 1, 3);
  const wildcards = seeds.filter((s) => s.pos === 2).map((s) => s.teamId);
  assert.deepEqual(wildcards, [14, 11, 12], 'points first, then 20s');
  assert.ok(!wildcards.includes(13), 'the 18-twenties runner-up misses the cut');
});

test('an exact power-of-two field produces no byes', () => {
  const poules = Array.from({ length: 8 }, (_, i) => [ranked(i + 1, 6, 10, i + 1)]);
  const pairs = firstRoundPairs(selectQualifiers(poules, 1, 0));
  assert.equal(pairs.length, 4);
  assert.ok(pairs.every((p) => p.a !== null && p.b !== null));
});

test('an odd field gives the top seeds byes, with the real team on side A', () => {
  const poules = Array.from({ length: 5 }, (_, i) => [ranked(i + 1, 10 - i, 0, i + 1)]);
  const pairs = firstRoundPairs(selectQualifiers(poules, 1, 0));
  assert.equal(pairs.length, 4, '5 teams round up to an 8 draw');
  const byes = pairs.filter((p) => p.b === null);
  assert.equal(byes.length, 3);
  assert.ok(byes.every((p) => p.a !== null), 'a bye never leaves the empty slot on side A');
  assert.equal(pairs[0]?.a, 1, 'the top seed is first out');
});

test('winners advance into the right slot of the next round', () => {
  assert.deepEqual(advanceTarget(0), { match: 0, side: 'a' });
  assert.deepEqual(advanceTarget(1), { match: 0, side: 'b' });
  assert.deepEqual(advanceTarget(2), { match: 1, side: 'a' });
  assert.deepEqual(advanceTarget(7), { match: 3, side: 'b' });
});

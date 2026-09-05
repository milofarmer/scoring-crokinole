import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countsTowardStandings,
  matchLoser,
  matchPoints,
  matchWinner,
  shootoutWinnerFromShots,
  totalsFromSets,
} from '../src/core/scoring.ts';
import { makeMatch, played } from './helpers.ts';

test('totals add up the per-set points and 20s', () => {
  const totals = totalsFromSets([
    { pa: 30, pb: 24, ta: 1, tb: 0 },
    { pa: 22, pb: 28, ta: 0, tb: 2 },
    { pa: 35, pb: 20, ta: 2, tb: 0 },
    { pa: 18, pb: 26, ta: 0, tb: 1 },
  ]);
  assert.equal(totals.pointsA, 105);
  assert.equal(totals.pointsB, 98);
  assert.equal(totals.twentiesA, 3);
  assert.equal(totals.twentiesB, 3);
  assert.equal(totals.setsFilled, 4);
});

test('a set only counts as filled when both teams have points', () => {
  const totals = totalsFromSets([
    { pa: 30, pb: 24, ta: 0, tb: 0 },
    { pa: 22, pb: null, ta: 0, tb: 0 },
    { pa: null, pb: null, ta: 0, tb: 0 },
    { pa: null, pb: null, ta: 0, tb: 0 },
  ]);
  assert.equal(totals.setsFilled, 1);
  assert.equal(totals.pointsA, 52, 'points entered so far still count toward the running total');
});

test('the match is won on total points, not sets won', () => {
  // A wins three sets narrowly, B wins one set hugely and takes the match.
  const totals = totalsFromSets([
    { pa: 21, pb: 20, ta: 0, tb: 0 },
    { pa: 21, pb: 20, ta: 0, tb: 0 },
    { pa: 21, pb: 20, ta: 0, tb: 0 },
    { pa: 5, pb: 80, ta: 0, tb: 0 },
  ]);
  assert.ok(totals.pointsB > totals.pointsA);
});

test('winner, loser and match points follow the totals', () => {
  const match = played(1, 10, 20, 120, 96);
  assert.equal(matchWinner(match), 10);
  assert.equal(matchLoser(match), 20);
  assert.deepEqual(matchPoints(match, 2, 1), { a: 2, b: 0 });
});

test('level totals are a tie worth one point each, and undecided until a shoot-out', () => {
  const level = played(2, 10, 20, 100, 100);
  assert.deepEqual(matchPoints(level, 2, 1), { a: 1, b: 1 });
  assert.equal(matchWinner(level), null, 'a level match has no winner without a shoot-out');

  const decided = { ...level, shootoutWinner: 20 };
  assert.equal(matchWinner(decided), 20);
  assert.equal(matchLoser(decided), 10);
});

test('a bye is a win for the team that is there', () => {
  const bye = makeMatch({ id: 3, teamAId: 7, teamBId: null });
  assert.equal(matchWinner(bye), 7);
  assert.equal(matchLoser(bye), null);
  assert.deepEqual(matchPoints(bye, 2, 1), { a: 2, b: 0 });
  assert.equal(countsTowardStandings(bye), true, 'a bye counts even though it was never played');
});

test('a part-entered match does not count until it is confirmed', () => {
  const partial = makeMatch({ id: 4, teamAId: 1, teamBId: 2, pointsA: 30, pointsB: 20, status: 'progress' });
  assert.equal(countsTowardStandings(partial), false);
  assert.equal(countsTowardStandings({ ...partial, status: 'entered' }), true);
  assert.equal(countsTowardStandings({ ...partial, status: 'confirmed' }), true);
});

test('the knockout shoot-out is best of three', () => {
  assert.equal(shootoutWinnerFromShots(['a', 'a', null], 1, 2), 1);
  assert.equal(shootoutWinnerFromShots(['b', 'a', 'b'], 1, 2), 2);
  assert.equal(shootoutWinnerFromShots(['a', 'b', null], 1, 2), null, 'one each is not decided yet');
  assert.equal(shootoutWinnerFromShots([null, null, null], 1, 2), null);
});

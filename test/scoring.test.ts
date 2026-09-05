import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countsTowardStandings,
  matchLoser,
  matchPoints,
  matchWinner,
  setWinner,
  shootoutWinnerFromShots,
  totalsFromSets,
} from '../src/core/scoring.ts';
import { makeMatch, played } from './helpers.ts';

test('each set is settled on its own: two for a win, one each when level', () => {
  const totals = totalsFromSets([
    { pa: 30, pb: 24, ta: 1, tb: 0 },   // A
    { pa: 22, pb: 28, ta: 0, tb: 2 },   // B
    { pa: 35, pb: 35, ta: 2, tb: 0 },   // level
    { pa: 18, pb: 26, ta: 0, tb: 1 },   // B
  ]);
  assert.equal(totals.pointsA, 3, 'one set won and one level');
  assert.equal(totals.pointsB, 5, 'two sets won and one level');
  assert.equal(totals.pointsA + totals.pointsB, 8, 'a finished match always hands out eight');
  assert.equal(totals.twentiesA, 3);
  assert.equal(totals.twentiesB, 3);
  assert.equal(totals.setsFilled, 4);
});

test('a set goes to whoever scored more in that set', () => {
  assert.equal(setWinner({ pa: 30, pb: 24, ta: 0, tb: 0 }), 'a');
  assert.equal(setWinner({ pa: 24, pb: 30, ta: 0, tb: 0 }), 'b');
  assert.equal(setWinner({ pa: 30, pb: 30, ta: 0, tb: 0 }), null, 'level is level');
  assert.equal(setWinner({ pa: 30, pb: 30, ta: 5, tb: 0 }), null, "20's never decide a set");
  assert.equal(setWinner({ pa: 30, pb: null, ta: 0, tb: 0 }), null, 'not filled in yet');
});

test('the match is won on sets, NOT on the points scored across them', () => {
  // A takes three sets by a single point; B wins the fourth by a mile.
  const totals = totalsFromSets([
    { pa: 21, pb: 20, ta: 0, tb: 0 },
    { pa: 21, pb: 20, ta: 0, tb: 0 },
    { pa: 21, pb: 20, ta: 0, tb: 0 },
    { pa: 5, pb: 80, ta: 0, tb: 0 },
  ]);
  assert.equal(totals.pointsA, 6, 'three sets won');
  assert.equal(totals.pointsB, 2, 'one set won');
  assert.ok(totals.scoredB > totals.scoredA, 'B scored far more points overall');
  assert.ok(totals.pointsA > totals.pointsB, 'and still loses the match, because sets are what count');
});

test('points scored are kept for the record but rank nobody', () => {
  const totals = totalsFromSets([
    { pa: 30, pb: 24, ta: 0, tb: 0 },
    { pa: 22, pb: 28, ta: 0, tb: 0 },
    { pa: 35, pb: 20, ta: 0, tb: 0 },
    { pa: 18, pb: 26, ta: 0, tb: 0 },
  ]);
  assert.equal(totals.scoredA, 105);
  assert.equal(totals.scoredB, 98);
  assert.equal(totals.pointsA, 4, 'two sets each, so four points each');
  assert.equal(totals.pointsB, 4);
});

test('a set only counts as filled when both teams have points', () => {
  const totals = totalsFromSets([
    { pa: 30, pb: 24, ta: 0, tb: 0 },
    { pa: 22, pb: null, ta: 0, tb: 0 },
    { pa: null, pb: null, ta: 0, tb: 0 },
    { pa: null, pb: null, ta: 0, tb: 0 },
  ]);
  assert.equal(totals.setsFilled, 1);
  assert.equal(totals.pointsA, 2, 'only the completed set has paid out');
  assert.equal(totals.pointsB, 0);
});

test('winner, loser and match points follow the match points', () => {
  const match = played(1, 10, 20, 6, 2);
  assert.equal(matchWinner(match), 10);
  assert.equal(matchLoser(match), 20);
  assert.deepEqual(matchPoints(match), { a: 6, b: 2 }, 'both sides keep what they won');
});

test('four all is a draw, and stays undecided until a shoot-out', () => {
  const level = played(2, 10, 20, 4, 4);
  assert.deepEqual(matchPoints(level), { a: 4, b: 4 });
  assert.equal(matchWinner(level), null, 'a level match has no winner without a shoot-out');

  const decided = { ...level, shootoutWinner: 20 };
  assert.equal(matchWinner(decided), 20);
  assert.equal(matchLoser(decided), 10);
});

test('a bye is a clean sweep for the team that is there', () => {
  const bye = makeMatch({ id: 3, teamAId: 7, teamBId: null });
  assert.equal(matchWinner(bye), 7);
  assert.equal(matchLoser(bye), null);
  assert.deepEqual(matchPoints(bye), { a: 8, b: 0 }, 'all four sets');
  assert.equal(countsTowardStandings(bye), true, 'a bye counts even though it was never played');
});

test('a part-entered match does not count until it is confirmed', () => {
  const partial = makeMatch({ id: 4, teamAId: 1, teamBId: 2, pointsA: 4, pointsB: 2, status: 'progress' });
  assert.equal(countsTowardStandings(partial), false);
  assert.equal(countsTowardStandings({ ...partial, status: 'entered' }), true);
  assert.equal(countsTowardStandings({ ...partial, status: 'confirmed' }), true);
});

test('the shoot-out is first to two, then sudden death', () => {
  assert.equal(shootoutWinnerFromShots(['a', 'a', null], 1, 2), 1);
  assert.equal(shootoutWinnerFromShots(['b', 'a', 'b'], 1, 2), 2);
  assert.equal(shootoutWinnerFromShots(['a', 'b', null], 1, 2), null, 'one each is not decided yet');
  assert.equal(shootoutWinnerFromShots([null, null, null], 1, 2), null);

  // Halved shots can leave it level after three, and then it runs on.
  assert.equal(shootoutWinnerFromShots(['a', 'b', null, null], 1, 2), null, 'still level');
  assert.equal(shootoutWinnerFromShots(['a', 'b', null, 'a'], 1, 2), 1, 'sudden death: one clear shot ends it');
  assert.equal(shootoutWinnerFromShots(['a', 'b', null, 'b'], 1, 2), 2);
  assert.equal(shootoutWinnerFromShots([null, null, null, 'b', 'b'], 1, 2), 2, 'three halved shots run on');
  assert.equal(shootoutWinnerFromShots(['a', 'b', 'a', 'b'], 1, 2), 1, 'already over at the third shot');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStandings, rankPoule } from '../src/core/standings.ts';
import { makeMatch, makeTeam, played } from './helpers.ts';
import type { Match, Team } from '../src/types/index.ts';


/**
 * A four-team round robin engineered so that two pairs finish level on points
 * and 20's: teams 1 and 2 lead on 14, teams 3 and 4 trail on 10.
 * Head-to-head: 2 beat 1 (top pair) and 4 beat 3 (bottom pair).
 *
 * Every match here is won three sets to one, so the winner takes 6 and the
 * loser 2 of the eight on offer.
 */
const TEAMS: readonly Team[] = [makeTeam(1, 1), makeTeam(2, 1), makeTeam(3, 1), makeTeam(4, 1)];
const ROUND_ROBIN: readonly Match[] = [
  played(1, 1, 2, 2, 6), // 2 beats 1
  played(2, 3, 4, 2, 6), // 4 beats 3
  played(3, 1, 3, 6, 2), // 1 beats 3
  played(4, 2, 4, 6, 2), // 2 beats 4
  played(5, 1, 4, 6, 2), // 1 beats 4
  played(6, 2, 3, 2, 6), // 3 beats 2
];

test('aggregates wins, ties, losses and points', () => {
  const table = computeStandings(TEAMS, ROUND_ROBIN);
  const one = table.get(1);
  assert.ok(one);
  assert.equal(one.played, 3);
  assert.equal(one.wins, 2);
  assert.equal(one.losses, 1);
  assert.equal(one.points, 14, 'two wins at 6 plus a loss at 2');
  assert.equal(table.get(2)?.points, 14);
  assert.equal(table.get(3)?.points, 10);
  assert.equal(table.get(4)?.points, 10);
});

test('head-to-head decides FIRST place, but is not applied further down', () => {
  const ranked = rankPoule(TEAMS, ROUND_ROBIN, 1);
  const order = ranked.map((row) => row.teamId);

  // Top pair level on points and 20's: 2 beat 1, so 2 takes the poule.
  assert.deepEqual(order.slice(0, 2), [2, 1]);
  // Bottom pair equally level, and 4 beat 3 — but lower placings ignore
  // head-to-head, so they stay in team-number order.
  assert.deepEqual(order.slice(2), [3, 4]);
});

test("20's outrank head-to-head: more 20's takes first even after losing the meeting", () => {
  // Same table, but team 1 collected more 20's than team 2.
  const withTwenties = ROUND_ROBIN.map((match) =>
    match.id === 3 ? { ...match, twentiesA: 9 } : match,
  );
  const ranked = rankPoule(TEAMS, withTwenties, 1);
  assert.equal(ranked[0]?.teamId, 1, 'team 1 leads on 20s before head-to-head is consulted');
});

test('a bye counts as a win, and knockout matches never touch the poule table', () => {
  const teams = [makeTeam(1, 1), makeTeam(2, 1)];
  const matches: Match[] = [
    makeMatch({ id: 1, teamAId: 1, teamBId: null }), // bye for team 1
    makeMatch({
      id: 2,
      teamAId: 2,
      teamBId: 1,
      pointsA: 200,
      pointsB: 0,
      status: 'entered',
      phase: 'ko',
    }),
  ];
  const table = computeStandings(teams, matches);
  assert.equal(table.get(1)?.points, 8, 'a bye is credited as all four sets');
  assert.equal(table.get(2)?.points, 0, 'the knockout win is not in the poule standings');
  assert.equal(table.get(2)?.played, 0);
});

test('teams with no results yet still appear, on zero', () => {
  const ranked = rankPoule([makeTeam(9, 3)], [], 3);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.points, 0);
  assert.equal(ranked[0]?.played, 0);
});

test('only the requested poule is ranked', () => {
  const teams = [makeTeam(1, 1), makeTeam(2, 1), makeTeam(3, 2)];
  const ranked = rankPoule(teams, [], 2);
  assert.deepEqual(ranked.map((row) => row.teamId), [3]);
});

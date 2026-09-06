/**
 * The simulator exists so an organiser can see a full tournament before running
 * one. That is only useful if what it produces behaves like a real tournament,
 * so these tests check the shape of the result rather than that it ran.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateTournament } from '../src/api/simulate.ts';
import { createTournamentStore } from '../src/services/tournament-store.ts';
import { openDatabase } from '../src/services/db.ts';
import { loadConfig } from '../src/config/index.ts';
import { countsTowardStandings, totalsFromSets } from '../src/core/scoring.ts';

/** A predictable sequence, so a failure can be looked at twice. */
function seeded(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

function context() {
  const db = openDatabase(':memory:');
  return { config: loadConfig({}), store: createTournamentStore(db) };
}

test('a simulated tournament has the shape the settings asked for', () => {
  const ctx = context();
  const result = simulateTournament(ctx, {
    name: 'Test', entrants: 24, discipline: 'doubles', roundsPlayed: 99,
    knockout: true, adminPin: '1234', playCode: '', random: seeded(7),
  });

  assert.equal(result.teams, 24);
  assert.equal(result.poules, 6, '24 teams make six poules of four');
  assert.equal(result.rounds, 3, 'a poule of four plays three rounds');
  assert.ok(result.knockoutDrawn);

  const teams = ctx.store.teams(result.eventId);
  assert.equal(teams.length, 24);
  assert.ok(teams.every((t) => t.name !== '' && t.player1 !== ''), 'every team is named');
  assert.ok(teams.every((t) => t.player2 !== ''), 'doubles teams have two players');
  assert.ok(teams.every((t) => t.pouleId !== 0), 'nobody is left out of a poule');

  const perPoule = new Map<number, number>();
  for (const team of teams) perPoule.set(team.pouleId, (perPoule.get(team.pouleId) ?? 0) + 1);
  assert.deepEqual([...new Set(perPoule.values())], [4], 'the poules come out even');
});

test('singles teams carry one player, not an empty second', () => {
  const ctx = context();
  const result = simulateTournament(ctx, {
    name: 'Singles', entrants: 12, discipline: 'singles', roundsPlayed: 1,
    knockout: false, adminPin: '1234', playCode: '', random: seeded(11),
  });
  const teams = ctx.store.teams(result.eventId);
  assert.ok(teams.every((t) => t.player1 !== ''));
  assert.ok(teams.every((t) => t.player2 === ''));
});

test('the scores it writes obey the rules, and match what the rules recompute', () => {
  const ctx = context();
  const result = simulateTournament(ctx, {
    name: 'Rules', entrants: 16, discipline: 'doubles', roundsPlayed: 99,
    knockout: true, adminPin: '1234', playCode: '', random: seeded(3),
  });

  const played = ctx.store.matches(result.eventId).filter(countsTowardStandings);
  assert.ok(played.length > 0);

  for (const match of played) {
    assert.ok(match.sets !== null, 'a scored match keeps its per-set breakdown');
    const totals = totalsFromSets(match.sets);
    assert.equal(match.pointsA, totals.pointsA, 'stored points match what the sets give');
    assert.equal(match.pointsB, totals.pointsB);
    assert.ok((match.pointsA ?? 0) + (match.pointsB ?? 0) <= 8, 'a match shares out at most eight');
  }
});

test('running it again replaces the tournament rather than piling up another', () => {
  const ctx = context();
  simulateTournament(ctx, {
    name: 'First', entrants: 24, discipline: 'doubles', roundsPlayed: 1,
    knockout: false, adminPin: '1234', playCode: '', random: seeded(1),
  });
  const second = simulateTournament(ctx, {
    name: 'Second', entrants: 12, discipline: 'singles', roundsPlayed: 1,
    knockout: false, adminPin: '1234', playCode: '', random: seeded(2),
  });

  const active = ctx.store.activeEvent();
  assert.ok(active !== null);
  assert.equal(active.id, second.eventId, 'the newest one is the live tournament');
  assert.equal(ctx.store.teams(second.eventId).length, 12);
  assert.equal(ctx.store.poules(second.eventId).length, 3, 'no poules left over from the first');
});

test('a field that does not divide evenly still works', () => {
  const ctx = context();
  const result = simulateTournament(ctx, {
    name: 'Awkward', entrants: 10, discipline: 'doubles', roundsPlayed: 99,
    knockout: false, adminPin: '1234', playCode: '', random: seeded(5),
  });
  const sizes = ctx.store.poules(result.eventId).map(
    (p) => ctx.store.teams(result.eventId).filter((t) => t.pouleId === p.id).length,
  );
  assert.equal(sizes.reduce((a, b) => a + b, 0), 10);
  assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, 'poules differ by at most one');
});

/**
 * Round-trips the store against a real (in-memory) SQLite database, so the
 * schema, the row mapping and the writes are checked together.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/services/db.ts';
import { createTournamentStore, makeCode } from '../src/services/tournament-store.ts';

function freshStore() {
  const db = openDatabase(':memory:');
  db.exec(`INSERT INTO crok_event (id, name, play_code, admin_pin, api_key, num_rounds,
             points_win, points_tie, current_round, advance_per_poule, wildcards, status)
           VALUES (1, 'NK', 'NK2026', '1234', 'key', 4, 2, 1, 1, 1, 5, 'running')`);
  db.exec("INSERT INTO crok_poule (id, event_id, name, tables, sort) VALUES (1, 1, 'A', 2, 0)");
  db.exec(`INSERT INTO crok_team (id, event_id, poule_id, number, name, player1, player2, login_code)
           VALUES (1, 1, 1, 1, 'Sterren', 'Anne', 'Bram', 'AB12'),
                  (2, 1, 1, 2, 'Rakkers', 'Cor', 'Dana', 'CD34')`);
  db.exec(`INSERT INTO crok_match (id, event_id, poule_id, round, table_no, team_a_id, team_b_id, phase)
           VALUES (1, 1, 1, 1, 1, 1, 2, 'poule')`);
  return { db, store: createTournamentStore(db) };
}

test('reads the running event with its codes', () => {
  const { store } = freshStore();
  const event = store.activeEvent();
  assert.ok(event);
  assert.equal(event.name, 'NK');
  assert.equal(event.pointsWin, 2);
  assert.equal(event.wildcards, 5);
  assert.equal(event.adminPin, '1234');
});

test('maps poules, teams and matches into domain objects', () => {
  const { store } = freshStore();
  assert.deepEqual(store.poules(1).map((p) => p.name), ['A']);

  const teams = store.teams(1);
  assert.equal(teams.length, 2);
  assert.equal(teams[0]?.name, 'Sterren');
  assert.equal(teams[0]?.player1, 'Anne');
  assert.equal(teams[0]?.pouleId, 1);

  const match = store.matchById(1, 1);
  assert.ok(match);
  assert.equal(match.teamAId, 1);
  assert.equal(match.teamBId, 2);
  assert.equal(match.status, 'pending');
  assert.equal(match.pointsA, null, 'an unplayed match has no score, not a zero');
  assert.equal(match.sets, null);
});

test('a saved score comes back with its per-set breakdown', () => {
  const { store } = freshStore();
  store.saveScore({
    matchId: 1,
    pointsA: 105,
    pointsB: 98,
    twentiesA: 3,
    twentiesB: 3,
    sets: [
      { pa: 30, pb: 24, ta: 1, tb: 0 },
      { pa: 22, pb: 28, ta: 0, tb: 2 },
      { pa: 35, pb: 20, ta: 2, tb: 0 },
      { pa: 18, pb: 26, ta: 0, tb: 1 },
    ],
    shootoutWinner: null,
    complete: true,
    enteredBy: 'ai-table-1',
  });

  const match = store.matchById(1, 1);
  assert.ok(match);
  assert.equal(match.pointsA, 105);
  assert.equal(match.pointsB, 98);
  assert.equal(match.status, 'entered');
  assert.equal(match.sets?.length, 4);
  assert.equal(match.sets?.[1]?.pb, 28);
});

test('an incomplete save stays in progress and does not count yet', () => {
  const { store } = freshStore();
  store.saveScore({
    matchId: 1,
    pointsA: 30,
    pointsB: 24,
    twentiesA: 0,
    twentiesB: 0,
    sets: [{ pa: 30, pb: 24, ta: 0, tb: 0 }],
    shootoutWinner: null,
    complete: false,
    enteredBy: 'phone',
  });
  assert.equal(store.matchById(1, 1)?.status, 'progress');
});

test('match codes are assigned once, are unique, and are found case-insensitively', () => {
  const { db, store } = freshStore();
  db.exec(`INSERT INTO crok_match (id, event_id, poule_id, round, table_no, team_a_id, team_b_id, phase)
           VALUES (2, 1, 1, 1, 2, 2, 1, 'poule')`);

  store.ensureMatchCodes(1);
  const first = store.matchCode(1);
  const second = store.matchCode(2);
  assert.ok(first && second);
  assert.notEqual(first, second);

  store.ensureMatchCodes(1);
  assert.equal(store.matchCode(1), first, 'existing codes are left alone');

  const found = store.matchByCode(1, first.toLowerCase());
  assert.equal(found?.id, 1);
});

test('team login codes resolve, and a bad one resolves to nothing', () => {
  const { store } = freshStore();
  assert.equal(store.teamByLoginCode(1, 'ab12')?.id, 1);
  assert.equal(store.teamByLoginCode(1, 'nope'), null);
});

test('knockout slots can be filled as winners come through', () => {
  const { db, store } = freshStore();
  db.exec(`INSERT INTO crok_match (id, event_id, poule_id, round, table_no, phase, bracket)
           VALUES (9, 1, 0, 5, 1, 'ko', 'Final')`);
  store.setMatchTeam(9, 'a', 1);
  store.setMatchTeam(9, 'b', 2);
  const final = store.matchById(1, 9);
  assert.equal(final?.teamAId, 1);
  assert.equal(final?.teamBId, 2);
  assert.equal(final?.phase, 'ko');
  assert.equal(final?.bracket, 'Final');
});

test('generated codes avoid characters that read wrong on a screen', () => {
  for (let i = 0; i < 200; i += 1) {
    assert.match(makeCode(4), /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
  }
});

/**
 * Season ranking: the Field-Weighted Points maths, the best-five standings, and
 * the organiser write path over a real HTTP server and a real (in-memory)
 * database, so the JSON contract the existing pages depend on is checked end to
 * end rather than only in the store.
 *
 * The expected point values are taken from the PHP endpoint this port replaces,
 * so a drift in the curve or in the rounding fails here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { openDatabase, type Db } from '../src/services/db.ts';
import { createTournamentStore } from '../src/services/tournament-store.ts';
import { createSeasonStore, ensureSeasonSchema, fieldWeightedPoints } from '../src/services/season-store.ts';
import { createSeasonRouter } from '../src/api/season-routes.ts';
import { asRow, isRecord, num, str } from '../src/services/rows.ts';
import { loadConfig } from '../src/config/index.ts';

const ADMIN_PIN = '1234';

/** A database with one event to carry the organiser PIN, plus the season tables. */
function freshDatabase(): Db {
  const db = openDatabase(':memory:');
  // The season tables are not part of the shared schema, so a caller that only
  // wants the ranking has to bring them along.
  ensureSeasonSchema(db);
  db.exec(`INSERT INTO crok_event (id, name, play_code, admin_pin, api_key, status)
           VALUES (1, 'NK', 'NK2026', '${ADMIN_PIN}', 'key', 'running')`);
  return db;
}

/** The three nights the published ranking was checked against. */
function seedNights(db: Db): void {
  db.exec(`INSERT INTO crok_snight (id, season, name, "date", host, type, field_size, fsi, fdi, created_at)
           VALUES (1, 'S17', 'Elmira 2026',          '2026-01-10', 'croki.nl', 'singles', 42, 1.34, 1.0,  10),
                  (2, 'S17', 'Ontario Singles 2026', '2026-02-14', 'croki.nl', 'singles', 36, 1.29, 0.9,  10),
                  (3, 'S17', 'NY State 2026',        '2026-03-07', 'croki.nl', 'doubles', 32, 0.90, 0.54, 10)`);
}

interface JsonResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

function rowsOf(value: unknown): Record<string, unknown>[] {
  assert.ok(Array.isArray(value), 'expected an array in the payload');
  return value.map(asRow);
}

test('field-weighted points match the published curve', () => {
  // Elmira 2026: 42 players, FSI 1.34, FDI 1.0.
  assert.equal(fieldWeightedPoints(1, 42, 1.34, 1.0), 67);
  assert.equal(fieldWeightedPoints(2, 42, 1.34, 1.0), 65.2);
  assert.equal(fieldWeightedPoints(7, 42, 1.34, 1.0), 56.9);
  assert.equal(fieldWeightedPoints(12, 42, 1.34, 1.0), 49.5);

  // Ontario Singles 2026: 36 players, FSI 1.29, FDI 0.9.
  assert.equal(fieldWeightedPoints(1, 36, 1.29, 0.9), 64.5);
  assert.equal(fieldWeightedPoints(5, 36, 1.29, 0.9), 56.3);
  assert.equal(fieldWeightedPoints(12, 36, 1.29, 0.9), 43.9);

  // NY State 2026: 32 players, FSI 0.90, FDI 0.54.
  assert.equal(fieldWeightedPoints(1, 32, 0.9, 0.54), 45);
  assert.equal(fieldWeightedPoints(9, 32, 0.9, 0.54), 30.2);
  assert.equal(fieldWeightedPoints(12, 32, 0.9, 0.54), 25.5);
});

test('the top prize is the full field-strength share and last place is the floor', () => {
  // First place drops the decay term entirely, so it is simply TOP times FSI.
  assert.equal(fieldWeightedPoints(1, 20, 1.2, 0.7), 60);
  // Last place keeps only the floor, which is 40 per cent of the top scaled by FDI.
  assert.equal(fieldWeightedPoints(20, 20, 1.2, 0.7), 16.8);
});

test('a field of one pays the top prize, and positions outside the field are clamped', () => {
  assert.equal(fieldWeightedPoints(1, 1, 1.34, 1.0), 67);
  assert.equal(fieldWeightedPoints(9, 1, 1.34, 1.0), 67, 'a one-player field ignores the position');
  assert.equal(fieldWeightedPoints(0, 42, 1.34, 1.0), fieldWeightedPoints(1, 42, 1.34, 1.0));
  assert.equal(fieldWeightedPoints(99, 42, 1.34, 1.0), fieldWeightedPoints(42, 42, 1.34, 1.0));
});

test('standings count the best five results and split them by night type', () => {
  const db = freshDatabase();
  db.exec(`INSERT INTO crok_snight (id, season, name, "date", type, field_size, fsi, fdi)
           VALUES (1, 'S17', 'One',   '2026-01-01', 'singles', 2, 1.0, 1.0),
                  (2, 'S17', 'Two',   '2026-01-02', 'singles', 2, 1.0, 1.0),
                  (3, 'S17', 'Three', '2026-01-03', 'doubles', 2, 1.0, 1.0),
                  (4, 'S17', 'Four',  '2026-01-04', 'singles', 2, 1.0, 1.0),
                  (5, 'S17', 'Five',  '2026-01-05', 'doubles', 2, 1.0, 1.0),
                  (6, 'S17', 'Six',   '2026-01-06', 'singles', 2, 1.0, 1.0)`);
  // A two-player field pays 50 for first and 20 for second, which keeps the
  // arithmetic below readable while still going through the real curve.
  db.exec(`INSERT INTO crok_player (id, name) VALUES (1, 'Anne'), (2, 'Bram')`);
  db.exec(`INSERT INTO crok_sresult (id, snight_id, player_id, position, fwp)
           VALUES (1, 1, 1, 1, 50), (2, 2, 1, 1, 50), (3, 3, 1, 1, 50),
                  (4, 4, 1, 1, 50), (5, 5, 1, 1, 50), (6, 6, 1, 2, 20),
                  (7, 1, 2, 2, 20)`);

  const seasons = createSeasonStore(db);
  const table = seasons.standings(null);
  assert.equal(table.length, 2);

  const anne = table[0];
  assert.ok(anne);
  assert.equal(anne.name, 'Anne');
  assert.equal(anne.played, 6, 'every result is counted as played');
  assert.equal(anne.counting, 5, 'only five of them count');
  assert.equal(anne.total, 250, 'the 20 is dropped as the sixth-best result');
  assert.equal(anne.singles, 150, 'three of the counting five were singles nights');
  assert.equal(anne.doubles, 100);

  const bram = table[1];
  assert.ok(bram);
  assert.equal(bram.total, 20);
  assert.equal(bram.counting, 1);
});

test('standings can be limited to one season and keep entry order when level', () => {
  const db = freshDatabase();
  db.exec(`INSERT INTO crok_snight (id, season, name, "date", type, field_size, fsi, fdi)
           VALUES (1, 'S16', 'Old', '2025-01-01', 'singles', 2, 1.0, 1.0),
                  (2, 'S17', 'New', '2026-01-01', 'singles', 2, 1.0, 1.0)`);
  db.exec(`INSERT INTO crok_player (id, name) VALUES (1, 'Anne'), (2, 'Bram')`);
  db.exec(`INSERT INTO crok_sresult (id, snight_id, player_id, position, fwp)
           VALUES (1, 1, 1, 1, 50), (2, 2, 2, 1, 50), (3, 2, 1, 1, 50)`);

  const seasons = createSeasonStore(db);
  assert.deepEqual(seasons.seasons(), ['S17', 'S16'], 'newest season label first');

  const older = seasons.standings('S16');
  assert.deepEqual(older.map((row) => row.name), ['Anne']);

  // Both players have 50 in S17, and Bram's result was entered first.
  const current = seasons.standings('S17');
  assert.deepEqual(current.map((row) => row.name), ['Bram', 'Anne']);
  assert.deepEqual(current.map((row) => row.total), [50, 50]);
});

test('re-pricing a night follows a corrected field size', () => {
  const db = freshDatabase();
  seedNights(db);
  db.exec("INSERT INTO crok_player (id, name) VALUES (1, 'Anne')");
  const seasons = createSeasonStore(db);
  seasons.addResult(1, 1, 12);

  const before = seasons.results()[0];
  assert.ok(before);
  assert.equal(before.fwp, 49.5);

  seasons.saveNight({
    id: 1,
    season: 'S17',
    name: 'Elmira 2026',
    date: '2026-01-10',
    host: 'croki.nl',
    type: 'singles',
    fieldSize: 12,
    fsi: 1.34,
    fdi: 1.0,
  });
  seasons.recomputeNight(1);

  const after = seasons.results()[0];
  assert.ok(after);
  assert.equal(after.fwp, fieldWeightedPoints(12, 12, 1.34, 1.0));
  assert.equal(after.fwp, 26.8, 'last of twelve is now the floor, not mid-table');
});

test('deleting a night takes its results with it', () => {
  const db = freshDatabase();
  seedNights(db);
  db.exec("INSERT INTO crok_player (id, name) VALUES (1, 'Anne')");
  const seasons = createSeasonStore(db);
  seasons.addResult(1, 1, 1);
  seasons.addResult(2, 1, 1);
  assert.equal(seasons.results().length, 2);

  seasons.deleteNight(1);
  assert.equal(seasons.nights().length, 2);
  assert.deepEqual(seasons.results().map((row) => row.snight_id), [2]);
});

/** An app with only the season router mounted, on a port the OS picks. */
async function serve(db: Db): Promise<{
  readonly get: (path: string) => Promise<JsonResponse>;
  readonly post: (action: string, payload: Record<string, unknown>) => Promise<JsonResponse>;
  readonly close: () => Promise<void>;
}> {
  const app = express();
  app.use(express.json({ limit: '256kb' }));
  app.use('/api', createSeasonRouter({ config: loadConfig(), store: createTournamentStore(db) }, createSeasonStore(db)));

  const server: Server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const address: AddressInfo | string | null = server.address();
  if (address === null || typeof address === 'string') throw new Error('The test server did not get a port');
  const base = `http://127.0.0.1:${address.port}`;

  async function read(response: Response): Promise<JsonResponse> {
    const parsed: unknown = await response.json();
    return { status: response.status, body: isRecord(parsed) ? parsed : {} };
  }

  return {
    get: async (path) => read(await fetch(`${base}${path}`)),
    post: async (action, payload) =>
      read(
        await fetch(`${base}/api/${action}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ admin_pin: ADMIN_PIN, ...payload }),
        }),
      ),
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}

test('the public leaderboard is readable without a PIN', async () => {
  const db = freshDatabase();
  seedNights(db);
  const api = await serve(db);
  try {
    const { status, body } = await api.get('/api/season_state');
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.deepEqual(body.seasons, ['S17']);
    assert.deepEqual(body.standings, [], 'no results have been entered yet');

    const nights = rowsOf(body.nights);
    assert.deepEqual(nights.map((night) => str(night.name, 'name')), [
      'NY State 2026',
      'Ontario Singles 2026',
      'Elmira 2026',
    ]);
    const newest = nights[0];
    assert.ok(newest);
    assert.equal(newest.field_size, 32, 'snake_case field names are part of the contract');
    assert.equal(newest.players, 0);
    assert.equal(newest.type, 'doubles');
  } finally {
    await api.close();
  }
});

test('an organiser adds a player, a night and a result, and the leaderboard follows', async () => {
  const api = await serve(freshDatabase());
  try {
    const player = await api.post('season_add_player', { name: 'Anne de Vries' });
    assert.equal(player.status, 200);
    assert.equal(player.body.ok, true);
    const playerId = num(player.body.id, 'id');

    const night = await api.post('season_save_night', {
      season: 'S17',
      name: 'Elmira 2026',
      date: '2026-01-10',
      host: 'croki.nl',
      type: 'singles',
      field_size: 42,
      fsi: 1.34,
      fdi: 1.0,
    });
    assert.equal(night.body.ok, true);
    const nightId = num(night.body.id, 'id');

    const result = await api.post('season_add_result', {
      snight_id: nightId,
      player_id: playerId,
      position: 2,
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.fwp, 65.2, 'the endpoint returns the points it stored');

    const state = await api.get('/api/season_state');
    const standings = rowsOf(state.body.standings);
    assert.equal(standings.length, 1);
    const row = standings[0];
    assert.ok(row);
    assert.equal(row.player_id, playerId);
    assert.equal(row.name, 'Anne de Vries');
    assert.equal(row.total, 65.2);
    assert.equal(row.singles, 65.2);
    assert.equal(row.doubles, 0);
    assert.equal(row.played, 1);
    assert.equal(row.counting, 1);

    const data = await api.post('season_data', {});
    assert.equal(data.body.ok, true);
    const results = rowsOf(data.body.results);
    const only = results[0];
    assert.ok(only);
    assert.equal(only.player_name, 'Anne de Vries', 'the organiser view joins the player name');
    assert.equal(only.position, 2);
    assert.equal(only.snight_id, nightId);

    const removed = await api.post('season_delete_result', { id: num(only.id, 'id') });
    assert.equal(removed.body.ok, true);
    const afterDelete = await api.get('/api/season_state');
    assert.deepEqual(afterDelete.body.standings, []);
  } finally {
    await api.close();
  }
});

test('organiser writes are refused without the right PIN', async () => {
  const api = await serve(freshDatabase());
  try {
    const wrong = await api.post('season_add_player', { admin_pin: '9999', name: 'Anne' });
    assert.equal(wrong.status, 403);
    assert.equal(wrong.body.ok, false);
    assert.equal(wrong.body.error, 'Wrong organizer PIN.');

    const missing = await api.post('season_data', { admin_pin: '' });
    assert.equal(missing.status, 403);

    // The refusal must actually have stopped the write.
    const data = await api.post('season_data', {});
    assert.deepEqual(data.body.players, []);
  } finally {
    await api.close();
  }
});

test('a player needs a name and a result needs a night that exists', async () => {
  const api = await serve(freshDatabase());
  try {
    const unnamed = await api.post('season_add_player', { name: '   ' });
    assert.equal(unnamed.status, 400);
    assert.equal(unnamed.body.error, 'Player name?');

    const orphan = await api.post('season_add_result', { snight_id: 99, player_id: 1, position: 1 });
    assert.equal(orphan.status, 400);
    assert.equal(orphan.body.error, 'Pick a night and a player.');
  } finally {
    await api.close();
  }
});

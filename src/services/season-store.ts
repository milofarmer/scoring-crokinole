/**
 * Season ranking: NCA Field-Weighted Points (FWP).
 *
 * This lives apart from the tournament store because a season is independent of
 * any single event. Nights are entered by hand, so nothing here reads or writes
 * the crok_event/crok_match tables.
 *
 * Row types below are snake_case on purpose: they are serialised straight to
 * JSON and the existing pages already read those names. Inputs, which never
 * leave the process, use the camelCase the rest of the code uses.
 */
import type { Db } from './db.ts';
import { asRow, num, numOrNull, str } from './rows.ts';

/** Singles and doubles nights both count, but they are reported separately. */
export type SeasonNightType = 'singles' | 'doubles';

export interface SeasonPlayerRow {
  readonly id: number;
  readonly name: string | null;
  readonly created_at: number | null;
}

export interface SeasonNightRow {
  readonly id: number;
  readonly season: string | null;
  readonly name: string | null;
  readonly date: string | null;
  readonly host: string | null;
  readonly type: SeasonNightType;
  readonly field_size: number | null;
  readonly fsi: number | null;
  readonly fdi: number | null;
  readonly created_at: number | null;
}

/** A night as the public leaderboard shows it, with its result count. */
export interface SeasonNightSummary {
  readonly id: number;
  readonly season: string | null;
  readonly name: string | null;
  readonly date: string | null;
  readonly host: string | null;
  readonly type: SeasonNightType;
  readonly field_size: number;
  readonly fsi: number;
  readonly fdi: number;
  readonly players: number;
}

export interface SeasonResultRow {
  readonly id: number;
  readonly snight_id: number;
  readonly player_id: number;
  readonly position: number | null;
  readonly fwp: number | null;
  readonly created_at: number | null;
  readonly player_name: string | null;
}

export interface SeasonStandingRow {
  readonly player_id: number;
  readonly name: string | null;
  readonly total: number;
  readonly singles: number;
  readonly doubles: number;
  readonly played: number;
  readonly counting: number;
}

export interface SeasonNightInput {
  /** Zero (or absent) inserts a new night; anything else updates that night. */
  readonly id: number;
  readonly season: string;
  readonly name: string;
  readonly date: string;
  readonly host: string;
  readonly type: SeasonNightType;
  readonly fieldSize: number;
  readonly fsi: number;
  readonly fdi: number;
}

/**
 * The shape of the FWP curve. These are calibration constants rather than rules
 * of the game, which is why they are named and overridable instead of inlined.
 */
export const FWP_TOP = 50;
export const FWP_FLOOR = 0.4;
export const FWP_DECAY = 1.83;

/** How many results count towards a player's season total. */
export const COUNTING_RESULTS = 5;

/**
 * Round half away from zero at one decimal, the way the ranking has always been
 * published. Scaling by ten first can land a value a hair below the midpoint
 * (1.005 * 10 is 10.0499...), so the scaled value is snapped back to the
 * precision a double can actually carry before the rounding decision is made.
 */
function roundToTenth(value: number): number {
  const scaled = Number((value * 10).toPrecision(15));
  return (scaled < 0 ? -Math.round(-scaled) : Math.round(scaled)) / 10;
}

/**
 * Field-Weighted Points for a finishing position.
 *
 *   FWP = TOP * FSI * [ f + (1 - f) * (1 - x)^K ],  f = FLOOR * FDI,  x = (pos - 1) / (N - 1)
 *
 * FSI (field strength) sets the top prize, FDI (field depth) lifts the floor so
 * a deep field still pays out down the order, and the decay spreads the rest.
 */
export function fieldWeightedPoints(
  position: number,
  fieldSize: number,
  fsi: number,
  fdi: number,
  top: number = FWP_TOP,
  floor: number = FWP_FLOOR,
  decay: number = FWP_DECAY,
): number {
  if (fieldSize <= 1) return roundToTenth(top * fsi);
  const placed = Math.max(1, Math.min(fieldSize, position));
  const share = (placed - 1) / (fieldSize - 1);
  const f = floor * fdi;
  return roundToTenth(top * fsi * (f + (1 - f) * Math.pow(1 - share, decay)));
}

/** Null stays null, but an empty string stays an empty string. */
function textOrNull(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return str(value, field);
}

function toNightType(value: unknown): SeasonNightType {
  return value === 'doubles' ? 'doubles' : 'singles';
}

function toPlayer(value: unknown): SeasonPlayerRow {
  const row = asRow(value);
  return {
    id: num(row.id, 'player.id'),
    name: textOrNull(row.name, 'player.name'),
    created_at: numOrNull(row.created_at, 'player.created_at'),
  };
}

function toNight(value: unknown): SeasonNightRow {
  const row = asRow(value);
  return {
    id: num(row.id, 'night.id'),
    season: textOrNull(row.season, 'night.season'),
    name: textOrNull(row.name, 'night.name'),
    date: textOrNull(row.date, 'night.date'),
    host: textOrNull(row.host, 'night.host'),
    type: toNightType(row.type),
    field_size: numOrNull(row.field_size, 'night.field_size'),
    fsi: numOrNull(row.fsi, 'night.fsi'),
    fdi: numOrNull(row.fdi, 'night.fdi'),
    created_at: numOrNull(row.created_at, 'night.created_at'),
  };
}

function toNightSummary(value: unknown): SeasonNightSummary {
  const row = asRow(value);
  const night = toNight(row);
  return {
    id: night.id,
    season: night.season,
    name: night.name,
    date: night.date,
    host: night.host,
    type: night.type,
    // A night with no field or indices recorded reads as zero rather than null,
    // because the pages format these numbers without a null check.
    field_size: night.field_size ?? 0,
    fsi: night.fsi ?? 0,
    fdi: night.fdi ?? 0,
    players: numOrNull(row.players, 'night.players') ?? 0,
  };
}

function toResult(value: unknown): SeasonResultRow {
  const row = asRow(value);
  return {
    id: num(row.id, 'result.id'),
    snight_id: num(row.snight_id, 'result.snight_id'),
    player_id: num(row.player_id, 'result.player_id'),
    position: numOrNull(row.position, 'result.position'),
    fwp: numOrNull(row.fwp, 'result.fwp'),
    created_at: numOrNull(row.created_at, 'result.created_at'),
    player_name: textOrNull(row.player_name, 'result.player_name'),
  };
}

/**
 * The season tables. They are created here rather than in the shared schema so
 * mounting the season API on an existing tournament file is enough to make it
 * work: the columns match what the PHP version wrote, so old data still opens.
 */
export function ensureSeasonSchema(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS crok_player (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT,
     created_at INTEGER
   )`);
  db.exec(`CREATE TABLE IF NOT EXISTS crok_snight (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     season TEXT, name TEXT, "date" TEXT, host TEXT,
     type TEXT DEFAULT 'singles',
     field_size INTEGER, fsi REAL, fdi REAL,
     created_at INTEGER
   )`);
  db.exec(`CREATE TABLE IF NOT EXISTS crok_sresult (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     snight_id INTEGER, player_id INTEGER, position INTEGER, fwp REAL,
     created_at INTEGER
   )`);
  db.exec('CREATE INDEX IF NOT EXISTS crok_sresult_night ON crok_sresult (snight_id)');
}

/** One counting result, kept minimal because only these two fields decide a total. */
interface CountedResult {
  readonly fwp: number;
  readonly type: SeasonNightType;
}

function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function createSeasonStore(db: Db) {
  ensureSeasonSchema(db);

  const store = {
    /** Seasons that have at least one night, newest label first. */
    seasons(): string[] {
      const rows = db
        .prepare("SELECT DISTINCT season FROM crok_snight WHERE season IS NOT NULL AND season <> '' ORDER BY season DESC")
        .all();
      const labels: string[] = [];
      for (const row of rows) {
        const label = textOrNull(asRow(row).season, 'night.season');
        if (label !== null) labels.push(label);
      }
      return labels;
    },

    players(): SeasonPlayerRow[] {
      return db.prepare('SELECT * FROM crok_player ORDER BY name').all().map(toPlayer);
    },

    nights(): SeasonNightRow[] {
      return db.prepare('SELECT * FROM crok_snight ORDER BY "date" DESC, id DESC').all().map(toNight);
    },

    /** Every night with how many results it holds, for the public list. */
    nightSummaries(): SeasonNightSummary[] {
      return db
        .prepare(
          `SELECT n.*, (SELECT COUNT(*) FROM crok_sresult r WHERE r.snight_id = n.id) players
             FROM crok_snight n
            ORDER BY n."date" DESC, n.id DESC`,
        )
        .all()
        .map(toNightSummary);
    },

    nightById(nightId: number): SeasonNightRow | null {
      const row = db.prepare('SELECT * FROM crok_snight WHERE id = ?').get(nightId);
      return row === undefined ? null : toNight(row);
    },

    results(): SeasonResultRow[] {
      return db
        .prepare(
          `SELECT r.*, p.name player_name
             FROM crok_sresult r
             JOIN crok_player p ON p.id = r.player_id
            ORDER BY r.snight_id, r.position`,
        )
        .all()
        .map(toResult);
    },

    /**
     * Each player's best five results, with the singles and doubles share of
     * exactly those five. Ties keep the order results were entered in, which is
     * what the published table has always done.
     */
    standings(season: string | null): SeasonStandingRow[] {
      const base = `SELECT r.player_id, r.fwp, n.type, p.name
                      FROM crok_sresult r
                      JOIN crok_snight n ON n.id = r.snight_id
                      JOIN crok_player p ON p.id = r.player_id`;
      const rows =
        season === null || season === ''
          ? db.prepare(`${base} ORDER BY r.id`).all()
          : db.prepare(`${base} WHERE n.season = ? ORDER BY r.id`).all(season);

      const byPlayer = new Map<number, { name: string | null; results: CountedResult[] }>();
      for (const value of rows) {
        const row = asRow(value);
        const playerId = num(row.player_id, 'result.player_id');
        let entry = byPlayer.get(playerId);
        if (entry === undefined) {
          entry = { name: textOrNull(row.name, 'player.name'), results: [] };
          byPlayer.set(playerId, entry);
        }
        entry.results.push({
          fwp: numOrNull(row.fwp, 'result.fwp') ?? 0,
          type: toNightType(row.type),
        });
      }

      const table: SeasonStandingRow[] = [];
      for (const [playerId, entry] of byPlayer) {
        const ranked = entry.results.slice().sort((a, b) => b.fwp - a.fwp);
        const counting = ranked.slice(0, COUNTING_RESULTS);
        let total = 0;
        let singles = 0;
        let doubles = 0;
        for (const result of counting) {
          total += result.fwp;
          if (result.type === 'doubles') doubles += result.fwp;
          else singles += result.fwp;
        }
        table.push({
          player_id: playerId,
          name: entry.name,
          total: roundToTenth(total),
          singles: roundToTenth(singles),
          doubles: roundToTenth(doubles),
          played: entry.results.length,
          counting: counting.length,
        });
      }
      // Sort is stable, so players level on points stay in the order they first
      // appear in the results, exactly as the leaderboard has always shown them.
      table.sort((a, b) => b.total - a.total);
      return table;
    },

    addPlayer(name: string): number {
      const result = db.prepare('INSERT INTO crok_player (name, created_at) VALUES (?, ?)').run(name, nowInSeconds());
      return Number(result.lastInsertRowid);
    },

    /** Insert or update a night, and return the id either way. */
    saveNight(input: SeasonNightInput): number {
      if (input.id !== 0) {
        db.prepare(
          `UPDATE crok_snight
              SET season = ?, name = ?, "date" = ?, host = ?, type = ?, field_size = ?, fsi = ?, fdi = ?
            WHERE id = ?`,
        ).run(
          input.season,
          input.name,
          input.date,
          input.host,
          input.type,
          input.fieldSize,
          input.fsi,
          input.fdi,
          input.id,
        );
        return input.id;
      }
      const inserted = db
        .prepare(
          `INSERT INTO crok_snight (season, name, "date", host, type, field_size, fsi, fdi, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.season,
          input.name,
          input.date,
          input.host,
          input.type,
          input.fieldSize,
          input.fsi,
          input.fdi,
          nowInSeconds(),
        );
      return Number(inserted.lastInsertRowid);
    },

    /**
     * Re-price every result of a night. Stored points would otherwise drift once
     * the organiser corrects a field size or an index after entering results.
     */
    recomputeNight(nightId: number): void {
      const night = store.nightById(nightId);
      if (night === null) return;
      const rows = db.prepare('SELECT id, position FROM crok_sresult WHERE snight_id = ?').all(nightId);
      const update = db.prepare('UPDATE crok_sresult SET fwp = ? WHERE id = ?');
      for (const value of rows) {
        const row = asRow(value);
        const points = fieldWeightedPoints(
          numOrNull(row.position, 'result.position') ?? 0,
          night.field_size ?? 0,
          night.fsi ?? 0,
          night.fdi ?? 0,
        );
        update.run(points, num(row.id, 'result.id'));
      }
    },

    /** Record a finishing position and store the points it is worth. */
    addResult(nightId: number, playerId: number, position: number): number | null {
      const night = store.nightById(nightId);
      if (night === null) return null;
      const points = fieldWeightedPoints(position, night.field_size ?? 0, night.fsi ?? 0, night.fdi ?? 0);
      db.prepare(
        'INSERT INTO crok_sresult (snight_id, player_id, position, fwp, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(nightId, playerId, position, points, nowInSeconds());
      return points;
    },

    deleteResult(resultId: number): void {
      db.prepare('DELETE FROM crok_sresult WHERE id = ?').run(resultId);
    },

    /** A night takes its results with it, so no orphan can keep scoring points. */
    deleteNight(nightId: number): void {
      db.prepare('DELETE FROM crok_sresult WHERE snight_id = ?').run(nightId);
      db.prepare('DELETE FROM crok_snight WHERE id = ?').run(nightId);
    },
  };
  return store;
}

export type SeasonStore = ReturnType<typeof createSeasonStore>;

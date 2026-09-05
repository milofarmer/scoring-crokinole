/**
 * Typed data access for a tournament. Everything above this layer works with
 * domain objects; SQL and column names stop here.
 */
import type { Db } from './db.ts';
import { asRow, num, str, strOrNull, toMatch, toPoule, toTeam } from './rows.ts';
import type { EventConfig, Match, Poule, SetScore, Team } from '../types/index.ts';

/** An event as stored, including the codes that must never reach a public page. */
export interface StoredEvent extends EventConfig {
  readonly playCode: string;
  readonly adminPin: string;
  readonly apiKey: string;
  readonly status: string;
}

function toStoredEvent(value: unknown): StoredEvent {
  const row = asRow(value);
  return {
    id: num(row.id, 'event.id'),
    name: str(row.name, 'event.name'),
    numRounds: num(row.num_rounds, 'event.num_rounds'),
    pointsWin: num(row.points_win, 'event.points_win'),
    pointsTie: num(row.points_tie, 'event.points_tie'),
    currentRound: num(row.current_round, 'event.current_round'),
    advancePerPoule: num(row.advance_per_poule, 'event.advance_per_poule'),
    wildcards: num(row.wildcards, 'event.wildcards'),
    playCode: str(row.play_code, 'event.play_code'),
    adminPin: str(row.admin_pin, 'event.admin_pin'),
    apiKey: str(row.api_key, 'event.api_key'),
    status: str(row.status, 'event.status'),
  };
}

/** Short, unambiguous codes: no I, L, O, 0 or 1 to read wrong off a screen. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function makeCode(length: number, random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    const index = Math.floor(random() * CODE_ALPHABET.length);
    code += CODE_ALPHABET.charAt(index);
  }
  return code;
}

export function createTournamentStore(db: Db) {
  const store = {
    /** The running event, else the most recent one. */
    activeEvent(): StoredEvent | null {
      const running = db
        .prepare("SELECT * FROM crok_event WHERE status = 'running' ORDER BY id DESC LIMIT 1")
        .get();
      if (running !== undefined) return toStoredEvent(running);
      const latest = db.prepare('SELECT * FROM crok_event ORDER BY id DESC LIMIT 1').get();
      return latest === undefined ? null : toStoredEvent(latest);
    },

    poules(eventId: number): Poule[] {
      return db
        .prepare('SELECT * FROM crok_poule WHERE event_id = ? ORDER BY sort, id')
        .all(eventId)
        .map(toPoule);
    },

    teams(eventId: number): Team[] {
      return db
        .prepare('SELECT * FROM crok_team WHERE event_id = ? ORDER BY number, id')
        .all(eventId)
        .map(toTeam);
    },

    matches(eventId: number, round?: number): Match[] {
      const rows =
        round === undefined
          ? db.prepare('SELECT * FROM crok_match WHERE event_id = ? ORDER BY round, poule_id, table_no').all(eventId)
          : db
              .prepare('SELECT * FROM crok_match WHERE event_id = ? AND round = ? ORDER BY poule_id, table_no')
              .all(eventId, round);
      return rows.map(toMatch);
    },

    matchById(eventId: number, matchId: number): Match | null {
      const row = db.prepare('SELECT * FROM crok_match WHERE id = ? AND event_id = ?').get(matchId, eventId);
      return row === undefined ? null : toMatch(row);
    },

    matchByCode(eventId: number, code: string): Match | null {
      const row = db
        .prepare('SELECT * FROM crok_match WHERE event_id = ? AND UPPER(match_code) = UPPER(?)')
        .get(eventId, code);
      return row === undefined ? null : toMatch(row);
    },

    /** The code shown on the big board, so a table can be scored without an account. */
    matchCode(matchId: number): string | null {
      const row = db.prepare('SELECT match_code FROM crok_match WHERE id = ?').get(matchId);
      return row === undefined ? null : strOrNull(asRow(row).match_code, 'match_code');
    },

    teamByLoginCode(eventId: number, code: string): Team | null {
      const row = db
        .prepare('SELECT * FROM crok_team WHERE event_id = ? AND UPPER(login_code) = UPPER(?)')
        .get(eventId, code);
      return row === undefined ? null : toTeam(row);
    },

    /** Give every match a code, so a board can always be joined. Safe to re-run. */
    ensureMatchCodes(eventId: number): void {
      const missing = db
        .prepare("SELECT id FROM crok_match WHERE event_id = ? AND (match_code IS NULL OR match_code = '')")
        .all(eventId);
      if (missing.length === 0) return;

      const taken = new Set<string>();
      for (const row of db.prepare('SELECT match_code FROM crok_match WHERE event_id = ?').all(eventId)) {
        const code = strOrNull(asRow(row).match_code, 'match_code');
        if (code !== null) taken.add(code.toUpperCase());
      }
      const update = db.prepare('UPDATE crok_match SET match_code = ? WHERE id = ?');
      for (const row of missing) {
        let code = makeCode(4);
        while (taken.has(code)) code = makeCode(4);
        taken.add(code);
        update.run(code, num(asRow(row).id, 'match.id'));
      }
    },

    /** Record a result. `sets` is the per-set breakdown; totals are derived by the caller. */
    saveScore(input: {
      readonly matchId: number;
      readonly pointsA: number;
      readonly pointsB: number;
      readonly twentiesA: number;
      readonly twentiesB: number;
      readonly sets: readonly SetScore[] | null;
      readonly shootoutWinner: number | null;
      readonly complete: boolean;
      readonly enteredBy: string;
    }): void {
      db.prepare(
        `UPDATE crok_match
            SET points_a = ?, points_b = ?, twenties_a = ?, twenties_b = ?,
                sets_json = COALESCE(?, sets_json),
                shootout_winner = ?, status = ?, entered_at = ?, entered_by = ?
          WHERE id = ?`,
      ).run(
        input.pointsA,
        input.pointsB,
        input.twentiesA,
        input.twentiesB,
        input.sets === null ? null : JSON.stringify(input.sets),
        input.shootoutWinner,
        input.complete ? 'entered' : 'progress',
        Math.floor(Date.now() / 1000),
        input.enteredBy,
        input.matchId,
      );
    },

    /** Fill a knockout slot once the feeding match has a winner. */
    setMatchTeam(matchId: number, side: 'a' | 'b', teamId: number | null): void {
      const column = side === 'a' ? 'team_a_id' : 'team_b_id';
      db.prepare(`UPDATE crok_match SET ${column} = ? WHERE id = ?`).run(teamId, matchId);
    },

    eventApiKey(eventId: number): string | null {
      const row = db.prepare('SELECT api_key FROM crok_event WHERE id = ?').get(eventId);
      return row === undefined ? null : strOrNull(asRow(row).api_key, 'api_key');
    },

    setEventApiKey(eventId: number, key: string): void {
      db.prepare('UPDATE crok_event SET api_key = ? WHERE id = ?').run(key, eventId);
    },

    /** Used by the round draw. */
    insertMatch(input: {
      readonly eventId: number;
      readonly pouleId: number;
      readonly round: number;
      readonly tableNo: number;
      readonly teamAId: number | null;
      readonly teamBId: number | null;
      readonly phase: 'poule' | 'ko';
      readonly bracket: string | null;
    }): number {
      const result = db
        .prepare(
          `INSERT INTO crok_match (event_id, poule_id, round, table_no, team_a_id, team_b_id, phase, bracket, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        )
        .run(
          input.eventId,
          input.pouleId,
          input.round,
          input.tableNo,
          input.teamAId,
          input.teamBId,
          input.phase,
          input.bracket,
        );
      return Number(result.lastInsertRowid);
    },

    deleteMatches(eventId: number, where: { readonly round?: number; readonly phase?: 'poule' | 'ko' }): void {
      if (where.round !== undefined) {
        db.prepare('DELETE FROM crok_match WHERE event_id = ? AND round = ?').run(eventId, where.round);
        return;
      }
      if (where.phase !== undefined) {
        db.prepare('DELETE FROM crok_match WHERE event_id = ? AND phase = ?').run(eventId, where.phase);
      }
    },
  };
  return store;
}

export type TournamentStore = ReturnType<typeof createTournamentStore>;

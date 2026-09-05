/**
 * Typed data access for a tournament. Everything above this layer works with
 * domain objects; SQL and column names stop here.
 */
import type { Db } from './db.ts';
import { asRow, num, numOrNull, str, strOrNull, toMatch, toPoule, toTeam } from './rows.ts';
import type { EventConfig, Match, Poule, SetScore, Team } from '../types/index.ts';

/** An event as stored, including the codes that must never reach a public page. */
export interface StoredEvent extends EventConfig {
  readonly playCode: string;
  readonly adminPin: string;
  readonly apiKey: string;
  readonly status: string;
  readonly board: BoardCommand;
}

/**
 * What the big screen has last been told to do from the jury desk.
 *
 * `seq` is the whole mechanism: the board remembers the number it last obeyed,
 * so a command applies once and the board then carries on cycling by itself. A
 * reload does not replay an old instruction, and a Stream Deck pressed twice
 * does the obvious thing.
 */
export interface BoardCommand {
  readonly view: string | null;
  readonly page: number | null;
  readonly autocycle: boolean | null;
  readonly seq: number;
}

function toStoredEvent(value: unknown): StoredEvent {
  const row = asRow(value);
  return {
    id: num(row.id, 'event.id'),
    name: str(row.name, 'event.name'),
    discipline: str(row.discipline, 'event.discipline') === 'singles' ? 'singles' : 'doubles',
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
    board: {
      view: strOrNull(row.board_view, 'event.board_view'),
      page: numOrNull(row.board_page, 'event.board_page'),
      autocycle: row.board_autocycle === null || row.board_autocycle === undefined
        ? null
        : num(row.board_autocycle, 'event.board_autocycle') === 1,
      seq: numOrNull(row.board_seq, 'event.board_seq') ?? 0,
    },
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

    teamById(eventId: number, teamId: number): Team | null {
      const row = db.prepare('SELECT * FROM crok_team WHERE id = ? AND event_id = ?').get(teamId, eventId);
      return row === undefined ? null : toTeam(row);
    },

    /** The one match on that table in the hall this round, if it has been numbered. */
    matchByPhysicalTable(eventId: number, round: number, table: number): Match[] {
      return db
        .prepare('SELECT * FROM crok_match WHERE event_id = ? AND round = ? AND phys_table = ?')
        .all(eventId, round, table)
        .map(toMatch);
    },

    /* ---- setting a tournament up ---- */

    createEvent(input: {
      readonly name: string;
      readonly adminPin: string;
      readonly playCode: string;
      readonly discipline: 'singles' | 'doubles';
      readonly numRounds: number;
    }): number {
      db.prepare(
        `INSERT INTO crok_event (name, play_code, admin_pin, discipline, num_rounds,
                                 current_round, status, created_at)
         VALUES (?, ?, ?, ?, ?, 1, 'setup', ?)`,
      ).run(
        input.name,
        input.playCode,
        input.adminPin,
        input.discipline,
        input.numRounds,
        Math.floor(Date.now() / 1000),
      );
      const row = db.prepare('SELECT last_insert_rowid() AS id').get();
      return num(asRow(row).id, 'event.id');
    },

    /**
     * Change only the settings that were sent. Anything absent keeps its value,
     * so a screen that edits one field cannot blank the rest.
     */
    updateEvent(eventId: number, changes: {
      readonly name?: string;
      readonly playCode?: string;
      readonly numRounds?: number;
      readonly currentRound?: number;
      readonly advancePerPoule?: number;
      readonly wildcards?: number;
      readonly bronzeFinal?: boolean;
      readonly discipline?: 'singles' | 'doubles';
      readonly status?: string;
    }): void {
      const columns: Record<string, string> = {
        name: 'name',
        playCode: 'play_code',
        numRounds: 'num_rounds',
        currentRound: 'current_round',
        advancePerPoule: 'advance_per_poule',
        wildcards: 'wildcards',
        discipline: 'discipline',
        status: 'status',
      };
      const sets: string[] = [];
      const values: (string | number)[] = [];

      for (const [key, column] of Object.entries(columns)) {
        const value = Reflect.get(changes, key);
        if (typeof value === 'string' || typeof value === 'number') {
          sets.push(`${column} = ?`);
          values.push(value);
        }
      }
      if (changes.bronzeFinal !== undefined) {
        sets.push('bronze_final = ?');
        values.push(changes.bronzeFinal ? 1 : 0);
      }
      if (sets.length === 0) return;

      values.push(eventId);
      db.prepare(`UPDATE crok_event SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    },

    /** Replace the poules wholesale. Teams keep their place where the poule survives. */
    setPoules(eventId: number, poules: readonly { readonly name: string; readonly tables: number }[]): void {
      db.prepare('DELETE FROM crok_poule WHERE event_id = ?').run(eventId);
      const insert = db.prepare('INSERT INTO crok_poule (event_id, name, tables, sort) VALUES (?, ?, ?, ?)');
      poules.forEach((poule, index) => insert.run(eventId, poule.name, poule.tables, index));
    },

    /** Next free team number, so numbering stays stable as teams come and go. */
    nextTeamNumber(eventId: number): number {
      const row = db.prepare('SELECT COALESCE(MAX(number), 0) AS highest FROM crok_team WHERE event_id = ?').get(eventId);
      return num(asRow(row).highest, 'team.number') + 1;
    },

    addTeam(input: {
      readonly eventId: number;
      readonly name: string;
      readonly player1: string;
      readonly player2: string;
      readonly pouleId: number;
      readonly number: number;
      readonly loginCode: string;
    }): number {
      db.prepare(
        `INSERT INTO crok_team (event_id, poule_id, number, name, player1, player2, login_code, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        input.eventId,
        input.pouleId,
        input.number,
        input.name,
        input.player1,
        input.player2,
        input.loginCode,
        Math.floor(Date.now() / 1000),
      );
      const row = db.prepare('SELECT last_insert_rowid() AS id').get();
      return num(asRow(row).id, 'team.id');
    },

    updateTeam(eventId: number, teamId: number, changes: {
      readonly name?: string;
      readonly player1?: string;
      readonly player2?: string;
      readonly pouleId?: number;
    }): void {
      const columns: Record<string, string> = {
        name: 'name',
        player1: 'player1',
        player2: 'player2',
        pouleId: 'poule_id',
      };
      const sets: string[] = [];
      const values: (string | number)[] = [];
      for (const [key, column] of Object.entries(columns)) {
        const value = Reflect.get(changes, key);
        if (typeof value === 'string' || typeof value === 'number') {
          sets.push(`${column} = ?`);
          values.push(value);
        }
      }
      if (sets.length === 0) return;
      values.push(teamId, eventId);
      db.prepare(`UPDATE crok_team SET ${sets.join(', ')} WHERE id = ? AND event_id = ?`).run(...values);
    },

    /** Remove a team and any match it was drawn into, so no match points at nobody. */
    deleteTeam(eventId: number, teamId: number): void {
      db.prepare('DELETE FROM crok_match WHERE event_id = ? AND (team_a_id = ? OR team_b_id = ?)')
        .run(eventId, teamId, teamId);
      db.prepare('DELETE FROM crok_team WHERE id = ? AND event_id = ?').run(teamId, eventId);
    },

    /** Login codes are what a team signs in with, so they must not collide. */
    takenLoginCodes(eventId: number): Set<string> {
      const taken = new Set<string>();
      for (const row of db.prepare('SELECT login_code FROM crok_team WHERE event_id = ?').all(eventId)) {
        const code = strOrNull(asRow(row).login_code, 'team.login_code');
        if (code !== null) taken.add(code.toUpperCase());
      }
      return taken;
    },

    /**
     * Number the tables in the hall for one round: straight through, one match
     * per table. A bye gets none, because nobody sits at a table for one.
     */
    assignPhysicalTables(eventId: number, round: number): void {
      const rows = db
        .prepare('SELECT id, team_b_id FROM crok_match WHERE event_id = ? AND round = ? ORDER BY poule_id, table_no, id')
        .all(eventId, round);
      const update = db.prepare('UPDATE crok_match SET phys_table = ? WHERE id = ?');
      let table = 1;
      for (const row of rows) {
        const record = asRow(row);
        const teamB = numOrNull(record.team_b_id, 'match.team_b_id');
        const isBye = teamB === null || teamB === 0;
        update.run(isBye ? null : table++, num(record.id, 'match.id'));
      }
    },

    /** Number any round that has none, the way match codes are backfilled. */
    ensurePhysicalTables(eventId: number): void {
      const rows = db
        .prepare(
          `SELECT DISTINCT round FROM crok_match
            WHERE event_id = ? AND phys_table IS NULL AND team_b_id IS NOT NULL AND team_b_id <> 0`,
        )
        .all(eventId);
      for (const row of rows) store.assignPhysicalTables(eventId, num(asRow(row).round, 'match.round'));
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

    /**
     * Tell the big screen what to show. Only what was sent changes; the sequence
     * number always moves on, which is how the board knows there is something
     * new to obey.
     */
    setBoardCommand(eventId: number, command: {
      readonly view?: string;
      readonly page?: number;
      readonly autocycle?: boolean;
    }): number {
      const sets: string[] = [];
      const values: (string | number)[] = [];
      if (command.view !== undefined) { sets.push('board_view = ?'); values.push(command.view); }
      if (command.page !== undefined) { sets.push('board_page = ?'); values.push(command.page); }
      if (command.autocycle !== undefined) { sets.push('board_autocycle = ?'); values.push(command.autocycle ? 1 : 0); }

      sets.push('board_seq = COALESCE(board_seq, 0) + 1');
      values.push(eventId);
      db.prepare(`UPDATE crok_event SET ${sets.join(', ')} WHERE id = ?`).run(...values);

      const row = db.prepare('SELECT board_seq FROM crok_event WHERE id = ?').get(eventId);
      return row === undefined ? 0 : numOrNull(asRow(row).board_seq, 'event.board_seq') ?? 0;
    },

    /** Lock or unlock a result. Confirmed means a phone can no longer change it. */
    setMatchStatus(matchId: number, status: string): void {
      db.prepare('UPDATE crok_match SET status = ? WHERE id = ?').run(status, matchId);
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

/**
 * SQLite storage. Node 24 ships a built-in driver, so there is no database
 * dependency to install or a server to run alongside the app.
 *
 * The schema matches the tables the PHP version wrote, so an existing
 * tournament file keeps working while the rewrite lands folder by folder.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export type Db = DatabaseSync;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS crok_event (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT, play_code TEXT, admin_pin TEXT, api_key TEXT,
     discipline TEXT DEFAULT 'doubles',
     num_rounds INTEGER DEFAULT 4,
     points_win INTEGER DEFAULT 2,
     points_tie INTEGER DEFAULT 1,
     current_round INTEGER DEFAULT 1,
     advance_per_poule INTEGER DEFAULT 1,
     wildcards INTEGER DEFAULT 0,
     bronze_final INTEGER DEFAULT 1,
     status TEXT DEFAULT 'setup',
     created_at INTEGER
   )`,
  `CREATE TABLE IF NOT EXISTS crok_poule (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     event_id INTEGER, name TEXT, tables INTEGER DEFAULT 11, sort INTEGER DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS crok_team (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     event_id INTEGER, poule_id INTEGER, number INTEGER,
     name TEXT, player1 TEXT, player2 TEXT, login_code TEXT, created_at INTEGER
   )`,
  `CREATE TABLE IF NOT EXISTS crok_match (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     event_id INTEGER, poule_id INTEGER, round INTEGER,
     table_no INTEGER, phys_table INTEGER,
     team_a_id INTEGER, team_b_id INTEGER,
     points_a INTEGER, points_b INTEGER,
     twenties_a INTEGER DEFAULT 0, twenties_b INTEGER DEFAULT 0,
     phase TEXT DEFAULT 'poule', shootout_winner INTEGER, bracket TEXT,
     match_code TEXT, sets_json TEXT,
     status TEXT DEFAULT 'pending', entered_at INTEGER, entered_by TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS crok_match_event_round ON crok_match (event_id, round)`,
  `CREATE INDEX IF NOT EXISTS crok_team_event ON crok_team (event_id)`,
];

/**
 * Columns added after the first release. A tournament file written by an older
 * version has to keep opening, so each is added if missing and the error when it
 * already exists is the expected case, not a problem.
 */
const ADDED_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ['crok_event', 'bronze_final INTEGER DEFAULT 1'],
  ['crok_match', 'phys_table INTEGER'],
  // What the big screen has been told to show from the jury desk. The sequence
  // number is what the board watches: it obeys a command once, then goes back to
  // running itself, so a reload does not replay an old instruction.
  ['crok_event', 'board_view TEXT'],
  ['crok_event', 'board_page INTEGER'],
  ['crok_event', 'board_autocycle INTEGER'],
  ['crok_event', 'board_seq INTEGER DEFAULT 0'],
];

/** Open (creating if needed) the tournament database and apply the schema. */
export function openDatabase(databasePath: string): Db {
  if (databasePath !== ':memory:') {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  for (const statement of SCHEMA) db.exec(statement);
  for (const [table, column] of ADDED_COLUMNS) {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column}`);
    } catch {
      // Already there, which is the usual case.
    }
  }
  return db;
}

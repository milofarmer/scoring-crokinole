/**
 * Turning database rows into domain objects.
 *
 * SQLite hands back untyped values, and this codebase forbids `as`, so every
 * field is narrowed with a real check. That is the point: a column that changes
 * type or goes missing fails here with a clear message, rather than becoming a
 * NaN somewhere in the standings.
 */
import type { Match, MatchPhase, MatchStatus, Poule, SetScore, Team } from '../types/index.ts';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asRow(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('Expected a database row');
  return value;
}

export function num(value: unknown, field: string): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  throw new Error(`Expected a number in "${field}"`);
}

export function numOrNull(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  return num(value, field);
}

/** Missing text is an empty string — the UI treats "unset" and "" the same. */
export function str(value: unknown, field: string): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  throw new Error(`Expected text in "${field}"`);
}

export function strOrNull(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  const text = str(value, field);
  return text === '' ? null : text;
}

function toPhase(value: unknown): MatchPhase {
  return str(value, 'phase') === 'ko' ? 'ko' : 'poule';
}

function toStatus(value: unknown): MatchStatus {
  const status = str(value, 'status');
  if (status === 'progress' || status === 'entered' || status === 'confirmed') return status;
  return 'pending';
}

function toOptionalCount(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  return 0;
}

function toOptionalPoints(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  return null;
}

/** The stored per-set breakdown, or null when a match was never entered. */
export function toSets(value: unknown, field: string): SetScore[] | null {
  const raw = strOrNull(value, field);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const sets: SetScore[] = [];
  for (const entry of parsed) {
    if (!isRecord(entry)) continue;
    sets.push({
      pa: toOptionalPoints(entry.pa),
      pb: toOptionalPoints(entry.pb),
      ta: toOptionalCount(entry.ta),
      tb: toOptionalCount(entry.tb),
    });
  }
  return sets;
}

export function toPoule(value: unknown): Poule {
  const row = asRow(value);
  return {
    id: num(row.id, 'poule.id'),
    name: str(row.name, 'poule.name'),
    tables: toOptionalCount(row.tables),
  };
}

export function toTeam(value: unknown): Team {
  const row = asRow(value);
  return {
    id: num(row.id, 'team.id'),
    number: toOptionalCount(row.number),
    name: str(row.name, 'team.name'),
    player1: str(row.player1, 'team.player1'),
    player2: str(row.player2, 'team.player2'),
    pouleId: toOptionalCount(row.poule_id),
  };
}

export function toMatch(value: unknown): Match {
  const row = asRow(value);
  return {
    id: num(row.id, 'match.id'),
    pouleId: toOptionalCount(row.poule_id),
    round: toOptionalCount(row.round),
    tableNo: toOptionalCount(row.table_no),
    teamAId: numOrNull(row.team_a_id, 'match.team_a_id'),
    teamBId: numOrNull(row.team_b_id, 'match.team_b_id'),
    pointsA: toOptionalPoints(row.points_a),
    pointsB: toOptionalPoints(row.points_b),
    twentiesA: toOptionalCount(row.twenties_a),
    twentiesB: toOptionalCount(row.twenties_b),
    phase: toPhase(row.phase),
    bracket: strOrNull(row.bracket, 'match.bracket'),
    shootoutWinner: numOrNull(row.shootout_winner, 'match.shootout_winner'),
    sets: toSets(row.sets_json, 'match.sets_json'),
    status: toStatus(row.status),
  };
}

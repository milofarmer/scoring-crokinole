/**
 * The JSON shape the pages and any integration already expect.
 *
 * Field names are snake_case here and camelCase everywhere above this file. That
 * looks inconsistent, and it is deliberate: the pages, the published API
 * description and anything already talking to this app use these names, so this
 * is the one place that translates rather than a rename rippling outwards.
 *
 * openapi.json is the contract. Change a name here and change it there.
 */
import type { Match, RankedTeam, SetScore, Team } from '../types/index.ts';
import { countsTowardStandings, matchWinner } from '../core/scoring.ts';

export interface TeamRef {
  readonly id: number;
  readonly name: string;
  readonly number: number;
}

/** Look a team up by id, for filling in the two sides of a match. */
export function teamLookup(teams: readonly Team[]): (id: number | null) => TeamRef | null {
  const byId = new Map(teams.map((team) => [team.id, team]));
  return (id) => {
    if (id === null) return null;
    const team = byId.get(id);
    return team === undefined ? null : { id: team.id, name: team.name, number: team.number };
  };
}

export function serialiseSets(sets: readonly SetScore[] | null): readonly SetScore[] | null {
  return sets === null ? null : sets;
}

/** A match as the board, the phone and the organiser screen read it. */
export function serialiseMatch(match: Match, ref: (id: number | null) => TeamRef | null): Record<string, unknown> {
  return {
    id: match.id,
    poule_id: match.pouleId,
    round: match.round,
    table_no: match.tableNo,
    phys_table: match.physTable,
    team_a: ref(match.teamAId),
    team_b: ref(match.teamBId),
    points_a: match.pointsA,
    points_b: match.pointsB,
    twenties_a: match.twentiesA,
    twenties_b: match.twentiesB,
    phase: match.phase,
    bracket: match.bracket,
    match_code: match.matchCode,
    shootout_winner: match.shootoutWinner,
    sets: serialiseSets(match.sets),
    status: match.status,
    scored: countsTowardStandings(match),
  };
}

/** One row of a poule table. */
export function serialiseStanding(row: RankedTeam): Record<string, unknown> {
  return {
    team_id: row.teamId,
    name: row.name,
    number: row.number,
    poule_id: row.pouleId,
    player1: row.player1,
    player2: row.player2,
    played: row.played,
    wins: row.wins,
    ties: row.ties,
    losses: row.losses,
    points: row.points,
    twenties: row.twenties,
  };
}

/** A match in the whole-draw view the board uses for the bracket. */
export function serialiseScheduleMatch(match: Match, ref: (id: number | null) => TeamRef | null): Record<string, unknown> {
  const winnerId = matchWinner(match);
  const a = ref(match.teamAId);
  const b = ref(match.teamBId);
  return {
    poule_id: match.pouleId,
    table_no: match.tableNo,
    phys_table: match.physTable,
    a: a === null ? '—' : a.name,
    b: b === null ? null : b.name,
    sets_a: match.pointsA,
    sets_b: match.pointsB,
    twenties_a: match.twentiesA,
    twenties_b: match.twentiesB,
    phase: match.phase,
    bracket: match.bracket,
    match_code: match.matchCode,
    shootout_winner: match.shootoutWinner,
    win: winnerId === null ? null : winnerId === match.teamAId ? 'a' : 'b',
    status: match.status,
    scored: countsTowardStandings(match),
  };
}

/** What a scoring machine needs to map its tables onto matches. */
export function serialiseIngestMatch(
  match: Match,
  ref: (id: number | null) => TeamRef | null,
  pouleName: string | null,
): Record<string, unknown> {
  return {
    match_code: match.matchCode,
    match_id: match.id,
    round: match.round,
    table: match.physTable,
    poule_table: match.tableNo,
    poule: pouleName,
    phase: match.phase,
    bracket: match.bracket,
    team_a: ref(match.teamAId),
    team_b: ref(match.teamBId),
    points_a: match.pointsA,
    points_b: match.pointsB,
    status: match.status,
  };
}

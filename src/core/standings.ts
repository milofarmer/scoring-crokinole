/**
 * Poule standings and ranking.
 *
 * Ranking rule (as set by the organiser):
 *   - every placing: match points, then total 20's;
 *   - the NUMBER ONE spot only: a tie on points+20's is broken by the head-to-head
 *     result (onderling resultaat). Lower placings never use head-to-head.
 * Team number is the final, stable fallback.
 */
import type { EventConfig, Match, RankedTeam, StandingRow, Team } from '../types/index.ts';
import { countsTowardStandings, isBye, matchPoints } from './scoring.ts';

function emptyRow(teamId: number): StandingRow {
  return {
    teamId,
    played: 0,
    wins: 0,
    ties: 0,
    losses: 0,
    points: 0,
    twenties: 0,
    pointsFor: 0,
    pointsAgainst: 0,
  };
}

function addSide(
  row: StandingRow,
  gained: number,
  pointsFor: number,
  pointsAgainst: number,
  twenties: number,
  outcome: 'win' | 'tie' | 'loss',
): StandingRow {
  return {
    teamId: row.teamId,
    played: row.played + 1,
    wins: row.wins + (outcome === 'win' ? 1 : 0),
    ties: row.ties + (outcome === 'tie' ? 1 : 0),
    losses: row.losses + (outcome === 'loss' ? 1 : 0),
    points: row.points + gained,
    twenties: row.twenties + twenties,
    pointsFor: row.pointsFor + pointsFor,
    pointsAgainst: row.pointsAgainst + pointsAgainst,
  };
}

/**
 * Aggregate every counting POULE match into a record per team.
 * Knockout matches never affect the poule standings.
 */
export function computeStandings(
  teams: readonly Team[],
  matches: readonly Match[],
  config: Pick<EventConfig, 'pointsWin' | 'pointsTie'>,
): Map<number, StandingRow> {
  const table = new Map<number, StandingRow>();
  for (const team of teams) table.set(team.id, emptyRow(team.id));

  for (const match of matches) {
    if (match.phase !== 'poule') continue;
    if (!countsTowardStandings(match)) continue;

    if (isBye(match)) {
      const id = match.teamAId;
      const row = id === null ? undefined : table.get(id);
      if (row) table.set(row.teamId, addSide(row, config.pointsWin, 0, 0, 0, 'win'));
      continue;
    }
    if (match.teamAId === null || match.teamBId === null) continue;
    if (match.pointsA === null || match.pointsB === null) continue;

    const gained = matchPoints(match, config.pointsWin, config.pointsTie);
    const rowA = table.get(match.teamAId);
    const rowB = table.get(match.teamBId);
    const outcomeA = match.pointsA > match.pointsB ? 'win' : match.pointsA === match.pointsB ? 'tie' : 'loss';
    const outcomeB = match.pointsB > match.pointsA ? 'win' : match.pointsA === match.pointsB ? 'tie' : 'loss';

    if (rowA) {
      table.set(rowA.teamId, addSide(rowA, gained.a, match.pointsA, match.pointsB, match.twentiesA, outcomeA));
    }
    if (rowB) {
      table.set(rowB.teamId, addSide(rowB, gained.b, match.pointsB, match.pointsA, match.twentiesB, outcomeB));
    }
  }
  return table;
}

/** Match points won strictly among a set of tied teams. */
export function headToHeadPoints(
  group: readonly RankedTeam[],
  matches: readonly Match[],
  config: Pick<EventConfig, 'pointsWin' | 'pointsTie'>,
): Map<number, number> {
  const ids = new Set(group.map((row) => row.teamId));
  const points = new Map<number, number>();
  for (const row of group) points.set(row.teamId, 0);

  for (const match of matches) {
    if (match.phase !== 'poule' || !countsTowardStandings(match)) continue;
    const { teamAId, teamBId } = match;
    if (teamAId === null || teamBId === null) continue;
    if (!ids.has(teamAId) || !ids.has(teamBId)) continue;

    const gained = matchPoints(match, config.pointsWin, config.pointsTie);
    points.set(teamAId, (points.get(teamAId) ?? 0) + gained.a);
    points.set(teamBId, (points.get(teamBId) ?? 0) + gained.b);
  }
  return points;
}

/** points desc, then 20's desc, then team number asc. */
function byPointsThenTwenties(a: RankedTeam, b: RankedTeam): number {
  if (a.points !== b.points) return b.points - a.points;
  if (a.twenties !== b.twenties) return b.twenties - a.twenties;
  return a.number - b.number;
}

/**
 * Rank one poule. Head-to-head is applied ONLY to the group tied for first,
 * to decide the poule winner.
 */
export function rankPoule(
  teams: readonly Team[],
  matches: readonly Match[],
  config: Pick<EventConfig, 'pointsWin' | 'pointsTie'>,
  pouleId: number,
): RankedTeam[] {
  const standings = computeStandings(teams, matches, config);
  const rows: RankedTeam[] = [];
  for (const team of teams) {
    if (team.pouleId !== pouleId) continue;
    const row = standings.get(team.id) ?? emptyRow(team.id);
    rows.push({
      ...row,
      name: team.name,
      number: team.number,
      pouleId: team.pouleId,
      player1: team.player1,
      player2: team.player2,
    });
  }
  rows.sort(byPointsThenTwenties);

  const leader = rows[0];
  if (leader === undefined) return rows;

  const tiedForFirst = rows.filter(
    (row) => row.points === leader.points && row.twenties === leader.twenties,
  );
  if (tiedForFirst.length < 2) return rows;

  const h2h = headToHeadPoints(tiedForFirst, matches, config);
  tiedForFirst.sort((a, b) => {
    const diff = (h2h.get(b.teamId) ?? 0) - (h2h.get(a.teamId) ?? 0);
    return diff !== 0 ? diff : a.number - b.number;
  });
  return [...tiedForFirst, ...rows.slice(tiedForFirst.length)];
}

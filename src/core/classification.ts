/**
 * The final order of a tournament: who came 1st, 2nd, 3rd and so on.
 *
 * This is what a season ranking needs — croki.nl turns finishing positions into
 * Field-Weighted Points, so the tournament only has to say who finished where.
 *
 * Order: how far a team got in the knockout comes first, and teams knocked out in
 * the same round are separated by their poule record. Teams that never reached the
 * knockout follow, also on their poule record.
 */
import type { Match, StandingRow, Team } from '../types/index.ts';
import { computeStandings } from './standings.ts';
import { matchLoser, matchWinner } from './scoring.ts';

export interface FinalPlace {
  readonly position: number;
  readonly teamId: number;
  /** The furthest round reached, e.g. 'Final' or 'Quarter-finals'; null if the team never left the poules. */
  readonly reached: string | null;
}

const BRONZE = 'Bronze final';

/** Poule record decides ties within a tier: points, then 20's, then team number. */
function pouleOrder(
  standings: Map<number, StandingRow>,
  numberOf: Map<number, number>,
): (a: number, b: number) => number {
  return (a, b) => {
    const rowA = standings.get(a);
    const rowB = standings.get(b);
    const pointsA = rowA?.points ?? 0;
    const pointsB = rowB?.points ?? 0;
    if (pointsA !== pointsB) return pointsB - pointsA;
    const twentiesA = rowA?.twenties ?? 0;
    const twentiesB = rowB?.twenties ?? 0;
    if (twentiesA !== twentiesB) return twentiesB - twentiesA;
    return (numberOf.get(a) ?? 0) - (numberOf.get(b) ?? 0);
  };
}

export function finalClassification(
  teams: readonly Team[],
  matches: readonly Match[],
): FinalPlace[] {
  const standings = computeStandings(teams, matches);
  const numberOf = new Map(teams.map((team) => [team.id, team.number]));
  const compare = pouleOrder(standings, numberOf);

  const knockout = matches.filter((match) => match.phase === 'ko');
  const placed = new Set<number>();
  const tiers: { readonly reached: string | null; readonly teamIds: number[] }[] = [];

  const addTier = (reached: string | null, teamIds: readonly number[]): void => {
    const fresh = teamIds.filter((id) => !placed.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) placed.add(id);
    tiers.push({ reached, teamIds: [...fresh].sort(compare) });
  };

  if (knockout.length > 0) {
    const rounds = [...new Set(knockout.map((match) => match.round))].sort((a, b) => b - a);
    const lastRound = rounds[0];

    const mainOf = (round: number): Match[] =>
      knockout
        .filter((match) => match.round === round && match.bracket !== BRONZE)
        .sort((a, b) => a.tableNo - b.tableNo);

    const final = lastRound === undefined ? undefined : mainOf(lastRound)[0];
    const bronze = knockout.find((match) => match.bracket === BRONZE);

    if (final !== undefined) {
      const champion = matchWinner(final);
      const runnerUp = matchLoser(final);
      if (champion !== null) addTier('Winner', [champion]);
      if (runnerUp !== null) addTier('Final', [runnerUp]);
    }
    if (bronze !== undefined) {
      const third = matchWinner(bronze);
      const fourth = matchLoser(bronze);
      if (third !== null) addTier('Bronze final', [third]);
      if (fourth !== null) addTier('Bronze final', [fourth]);
    }

    // Everyone else, by how deep they got: losers of each round, latest first.
    for (const round of rounds) {
      const losers = mainOf(round)
        .map(matchLoser)
        .filter((id): id is number => id !== null);
      const label = mainOf(round)[0]?.bracket ?? `Round ${round}`;
      addTier(label, losers);
    }
  }

  // Teams that never reached the knockout, on their poule record.
  const rest = teams.map((team) => team.id).filter((id) => !placed.has(id));
  addTier(null, rest);

  const places: FinalPlace[] = [];
  let position = 1;
  for (const tier of tiers) {
    for (const teamId of tier.teamIds) {
      places.push({ position, teamId, reached: tier.reached });
      position += 1;
    }
  }
  return places;
}

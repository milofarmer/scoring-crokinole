/**
 * Match scoring.
 *
 * A match is four sets. Each set is won by whoever scored more points IN THAT
 * SET, and is worth 2 to the winner, or 1 each if the set is level. So a match
 * hands out eight points between the two teams and a side can score anywhere
 * from 0 to 8.
 *
 * This is worth being clear about, because the obvious reading is wrong: the
 * match is NOT decided by adding up all the points scored. A team that loses a
 * set 20-60 and wins the other three narrowly has scored fewer points overall
 * and still takes the match 6-2. Points scored are only ever compared within a
 * single set.
 *
 * 20's are recorded per set but never decide a set. In the poule table they
 * separate teams level on points; head-to-head then settles first place. In the
 * knockout a level match goes to a shoot-out, and to sudden death if that is
 * still level.
 */
import type { Match, SetScore } from '../types/index.ts';

export const SETS_PER_MATCH = 4;

export const POINTS_PER_SET_WON = 2;
export const POINTS_PER_SET_TIED = 1;

export interface MatchTotals {
  /** Match points: 2 per set won, 1 per level set. Out of 8 once all four are in. */
  readonly pointsA: number;
  readonly pointsB: number;
  readonly twentiesA: number;
  readonly twentiesB: number;
  /** Points scored across the sets. Kept for the record; decides nothing. */
  readonly scoredA: number;
  readonly scoredB: number;
  /** Sets with points entered for BOTH teams. */
  readonly setsFilled: number;
}

/** Who took a single set, or null if it is level or not filled in yet. */
export function setWinner(set: SetScore): 'a' | 'b' | null {
  if (set.pa === null || set.pb === null) return null;
  if (set.pa > set.pb) return 'a';
  if (set.pb > set.pa) return 'b';
  return null;
}

/**
 * Turn a per-set breakdown into what the match is worth.
 * Each completed set is settled on its own and pays out 2, or 1 each when level.
 */
export function totalsFromSets(sets: readonly SetScore[]): MatchTotals {
  let pointsA = 0;
  let pointsB = 0;
  let twentiesA = 0;
  let twentiesB = 0;
  let scoredA = 0;
  let scoredB = 0;
  let setsFilled = 0;

  for (const set of sets.slice(0, SETS_PER_MATCH)) {
    twentiesA += set.ta;
    twentiesB += set.tb;
    if (set.pa !== null) scoredA += set.pa;
    if (set.pb !== null) scoredB += set.pb;
    if (set.pa === null || set.pb === null) continue;

    setsFilled += 1;
    const winner = setWinner(set);
    if (winner === 'a') pointsA += POINTS_PER_SET_WON;
    else if (winner === 'b') pointsB += POINTS_PER_SET_WON;
    else { pointsA += POINTS_PER_SET_TIED; pointsB += POINTS_PER_SET_TIED; }
  }
  return { pointsA, pointsB, twentiesA, twentiesB, scoredA, scoredB, setsFilled };
}

/** A match with no opponent: team A advances without playing. */
export function isBye(match: Match): boolean {
  return match.teamAId !== null && match.teamBId === null;
}

/**
 * Does this match count toward the standings?
 * A bye counts; otherwise the result must have been confirmed, not merely
 * auto-saved mid-entry.
 */
export function countsTowardStandings(match: Match): boolean {
  if (isBye(match)) return true;
  return match.status === 'entered' || match.status === 'confirmed';
}

/**
 * Winner of a match, or null while undecided.
 * More match points wins; level falls to the shoot-out winner.
 */
export function matchWinner(match: Match): number | null {
  if (isBye(match)) return match.teamAId;
  if (match.teamAId === null || match.teamBId === null) return null;
  if (match.pointsA === null || match.pointsB === null) return null;
  if (match.pointsA > match.pointsB) return match.teamAId;
  if (match.pointsB > match.pointsA) return match.teamBId;
  return match.shootoutWinner;
}

/** The beaten team, or null for a bye or an undecided match. */
export function matchLoser(match: Match): number | null {
  if (isBye(match)) return null;
  const winner = matchWinner(match);
  if (winner === null || match.teamAId === null || match.teamBId === null) return null;
  return winner === match.teamAId ? match.teamBId : match.teamAId;
}

/** Everything a team can take from one match: four sets at 2 apiece. */
export const MAX_MATCH_POINTS = SETS_PER_MATCH * POINTS_PER_SET_WON;

/**
 * What each side takes from this match into the table.
 *
 * The stored points are already the match points, so they go straight through:
 * there is no separate win/tie/loss award on top. A team sitting out is credited
 * with a clean sweep, which is how a bye has always been treated.
 */
export function matchPoints(match: Match): { readonly a: number; readonly b: number } {
  if (isBye(match)) return { a: MAX_MATCH_POINTS, b: 0 };
  return { a: match.pointsA ?? 0, b: match.pointsB ?? 0 };
}

/**
 * The shoot-out that settles a level knockout match: first to two shots.
 * Shots can be halved, so three may not separate them — then it goes to sudden
 * death and every further shot can decide it.
 */
export function shootoutWinnerFromShots(
  shots: readonly ('a' | 'b' | null)[],
  teamAId: number,
  teamBId: number,
): number | null {
  let a = 0;
  let b = 0;
  for (const shot of shots) {
    if (shot === 'a') a += 1;
    else if (shot === 'b') b += 1;
    // Past the first three, one clear shot ends it: sudden death.
    if (a >= 2 && a > b) return teamAId;
    if (b >= 2 && b > a) return teamBId;
  }
  return null;
}

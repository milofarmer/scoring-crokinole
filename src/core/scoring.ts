/**
 * Match scoring: a match is 4 sets of points + 20's, and is won on TOTAL points.
 * A knockout match level on totals is decided by a best-of-3 shoot-out.
 */
import type { Match, SetScore } from '../types/index.ts';

export const SETS_PER_MATCH = 4;

export interface MatchTotals {
  readonly pointsA: number;
  readonly pointsB: number;
  readonly twentiesA: number;
  readonly twentiesB: number;
  /** Sets with points entered for BOTH teams. */
  readonly setsFilled: number;
}

/** Sum a per-set breakdown into match totals. Missing points count as not entered. */
export function totalsFromSets(sets: readonly SetScore[]): MatchTotals {
  let pointsA = 0;
  let pointsB = 0;
  let twentiesA = 0;
  let twentiesB = 0;
  let setsFilled = 0;

  for (const set of sets.slice(0, SETS_PER_MATCH)) {
    if (set.pa !== null) pointsA += set.pa;
    if (set.pb !== null) pointsB += set.pb;
    twentiesA += set.ta;
    twentiesB += set.tb;
    if (set.pa !== null && set.pb !== null) setsFilled += 1;
  }
  return { pointsA, pointsB, twentiesA, twentiesB, setsFilled };
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
 * Higher total points wins; level totals fall to the shoot-out winner.
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

/**
 * Match points earned by each side: win / tie / loss.
 * Only meaningful once the match counts.
 */
export function matchPoints(
  match: Match,
  pointsWin: number,
  pointsTie: number,
): { readonly a: number; readonly b: number } {
  if (isBye(match)) return { a: pointsWin, b: 0 };
  if (match.pointsA === null || match.pointsB === null) return { a: 0, b: 0 };
  if (match.pointsA > match.pointsB) return { a: pointsWin, b: 0 };
  if (match.pointsB > match.pointsA) return { a: 0, b: pointsWin };
  return { a: pointsTie, b: pointsTie };
}

/** Best-of-3 shoot-out: whoever takes two shots wins. */
export function shootoutWinnerFromShots(
  shots: readonly ('a' | 'b' | null)[],
  teamAId: number,
  teamBId: number,
): number | null {
  const a = shots.filter((s) => s === 'a').length;
  const b = shots.filter((s) => s === 'b').length;
  if (a >= 2) return teamAId;
  if (b >= 2) return teamBId;
  return null;
}

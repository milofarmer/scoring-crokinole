/**
 * Recording a result. One code path serves the phone, the organiser and an
 * automated scoring system, so a machine-entered match behaves exactly like a
 * hand-entered one.
 */
import type { ApiContext, Result } from './context.ts';
import { fail, machineKey, secretMatches, succeed } from './context.ts';
import type { StoredEvent } from '../services/tournament-store.ts';
import { advanceTarget } from '../core/bracket.ts';
import { matchLoser, matchWinner, totalsFromSets } from '../core/scoring.ts';
import type { Match, SetScore } from '../types/index.ts';

export interface ScoreInput {
  /** Per-set breakdown. When absent, totals must be supplied instead. */
  readonly sets?: readonly SetScore[];
  readonly pointsA?: number;
  readonly pointsB?: number;
  readonly twentiesA?: number;
  readonly twentiesB?: number;
  readonly shootoutWinner?: number | null;
  readonly complete?: boolean;
  readonly enteredBy?: string;
}

/** Who is allowed to score this match. */
export function authoriseScore(
  context: ApiContext,
  event: StoredEvent,
  match: Match,
  credential: string,
): Result<string> {
  if (credential === '') return fail('unauthorised', 'A code is required to record a score.');

  if (secretMatches(event.adminPin, credential)) return succeed('organiser');
  if (secretMatches(machineKey(context, event), credential)) return succeed('machine');
  if (secretMatches(event.playCode, credential)) return succeed('table');

  const ownCode = context.store.matchCode(match.id);
  if (ownCode !== null && ownCode.toUpperCase() === credential.toUpperCase()) return succeed('match');

  const team = context.store.teamByLoginCode(event.id, credential);
  if (team !== null && (team.id === match.teamAId || team.id === match.teamBId)) {
    return succeed('team');
  }
  return fail('unauthorised', 'That code cannot score this match.');
}

function clampCount(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

/** Record the score and, for a knockout match, move the winner along. */
export function applyScore(
  context: ApiContext,
  event: StoredEvent,
  match: Match,
  input: ScoreInput,
): Match {
  const sets = input.sets ?? null;
  const totals = sets === null ? null : totalsFromSets(sets);

  const pointsA = totals?.pointsA ?? clampCount(input.pointsA);
  const pointsB = totals?.pointsB ?? clampCount(input.pointsB);
  const twentiesA = totals?.twentiesA ?? clampCount(input.twentiesA);
  const twentiesB = totals?.twentiesB ?? clampCount(input.twentiesB);

  const proposed = input.shootoutWinner ?? null;
  const shootoutWinner =
    proposed !== null && (proposed === match.teamAId || proposed === match.teamBId) ? proposed : null;

  context.store.saveScore({
    matchId: match.id,
    pointsA,
    pointsB,
    twentiesA,
    twentiesB,
    sets,
    shootoutWinner,
    complete: input.complete === true,
    enteredBy: input.enteredBy ?? '',
  });

  if (match.phase === 'ko') advanceBracket(context, event);

  const saved = context.store.matchById(event.id, match.id);
  if (saved === null) throw new Error(`Match ${match.id} vanished while saving`);
  return saved;
}

/**
 * Push decided knockout results into the round above: winners forward, and the
 * two semi-final losers into the bronze final. Safe to run repeatedly.
 */
export function advanceBracket(context: ApiContext, event: StoredEvent): void {
  const knockout = context.store.matches(event.id).filter((match) => match.phase === 'ko');
  if (knockout.length === 0) return;

  const rounds = [...new Set(knockout.map((match) => match.round))].sort((a, b) => a - b);
  const finalRound = rounds[rounds.length - 1];
  if (finalRound === undefined) return;

  const mainOf = (round: number): Match[] =>
    knockout
      .filter((match) => match.round === round && match.bracket !== 'Bronze final')
      .sort((a, b) => a.tableNo - b.tableNo);

  for (const round of rounds) {
    if (round >= finalRound) break;
    const current = mainOf(round);
    const next = mainOf(round + 1);
    current.forEach((match, index) => {
      const winner = matchWinner(match);
      if (winner === null) return;
      const target = advanceTarget(index);
      const destination = next[target.match];
      if (destination !== undefined) {
        context.store.setMatchTeam(destination.id, target.side, winner);
      }
    });
  }

  const bronze = knockout.find((match) => match.round === finalRound && match.bracket === 'Bronze final');
  if (bronze !== undefined) {
    mainOf(finalRound - 1).forEach((match, index) => {
      const loser = matchLoser(match);
      if (loser === null) return;
      context.store.setMatchTeam(bronze.id, index === 0 ? 'a' : 'b', loser);
    });
  }
}

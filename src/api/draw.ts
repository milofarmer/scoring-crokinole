/**
 * Drawing rounds and the knockout.
 *
 * The pairing rules live in core; this puts the results into the database and
 * numbers the tables. Kept apart from the routes so the interesting part can be
 * tested without an HTTP request.
 */
import type { ApiContext } from './context.ts';
import { fail, succeed, type Result } from './context.ts';
import type { StoredEvent } from '../services/tournament-store.ts';
import { pairTeams, previousOpponents, shuffled } from '../core/draw.ts';
import { bracketSize, firstRoundPairs, koLabel, selectQualifiers } from '../core/bracket.ts';
import { rankPoule } from '../core/standings.ts';
import { advanceBracket } from './score.ts';
import type { RankedTeam } from '../types/index.ts';

/**
 * Draw one poule round.
 *
 * Round one is random, because there is nothing to seed on yet. After that
 * teams are paired by their standing, avoiding anyone they have already played
 * where the poule still allows it. An odd team out gets a bye, which counts as
 * a clean sweep.
 */
export function drawRound(
  context: ApiContext,
  event: StoredEvent,
  round: number,
  force: boolean,
): Result<{ readonly created: number }> {
  const existing = context.store.matches(event.id, round);
  if (existing.length > 0) {
    if (!force) return fail('conflict', `Round ${round} has already been drawn.`);
    context.store.deleteMatches(event.id, { round });
  }

  const played = context.store.matches(event.id).filter((match) => match.phase === 'poule');
  const history = previousOpponents(played, round);
  const teams = context.store.teams(event.id);
  let created = 0;

  for (const poule of context.store.poules(event.id)) {
    const inPoule = teams.filter((team) => team.pouleId === poule.id);
    if (inPoule.length === 0) continue;

    const order =
      round <= 1
        ? shuffled(inPoule).map((team) => team.id)
        : rankPoule(teams, played, poule.id).map((row) => row.teamId);

    let table = 1;
    for (const [a, b] of pairTeams(order, history)) {
      context.store.insertMatch({
        eventId: event.id,
        pouleId: poule.id,
        round,
        tableNo: table,
        teamAId: a,
        teamBId: b,
        phase: 'poule',
        bracket: null,
      });
      table += 1;
      created += 1;
    }
  }

  context.store.assignPhysicalTables(event.id, round);
  context.store.ensureMatchCodes(event.id);
  return succeed({ created });
}

export interface KnockoutDrawn {
  readonly created: number;
  readonly round: number;
  readonly label: string;
  readonly bracketSize: number;
}

/**
 * Draw the whole knockout at once: the first round from the qualifiers, then
 * empty matches for every round above it, which fill in as winners come
 * through. Drawing it all up front means the board can show the shape of the
 * finals before any of it has been played.
 */
export function drawKnockout(
  context: ApiContext,
  event: StoredEvent,
  options: { readonly size?: number; readonly bronze: boolean },
): Result<KnockoutDrawn> {
  const teams = context.store.teams(event.id);
  const poules = context.store.poules(event.id);
  const played = context.store.matches(event.id);

  const ranked: RankedTeam[][] = poules.map((poule) => rankPoule(teams, played, poule.id));
  const qualifiers = selectQualifiers(ranked, event.advancePerPoule, event.wildcards);
  if (qualifiers.length < 2) return fail('conflict', 'Not enough teams have qualified to draw a knockout.');

  const size = options.size !== undefined && options.size >= 2 ? bracketSize(options.size) : bracketSize(qualifiers.length);
  const rounds = Math.round(Math.log2(size));
  const firstRound = event.numRounds + 1;

  context.store.deleteMatches(event.id, { phase: 'ko' });

  const pairs = firstRoundPairs(qualifiers);
  let table = 1;
  for (const { a, b } of pairs) {
    context.store.insertMatch({
      eventId: event.id,
      pouleId: 0,
      round: firstRound,
      tableNo: table,
      teamAId: a,
      teamBId: b,
      phase: 'ko',
      bracket: koLabel(size / 2),
    });
    table += 1;
  }

  // The rounds above, still empty. Winners are pushed into them as they happen.
  for (let step = 2; step <= rounds; step += 1) {
    const count = size / 2 ** step;
    for (let slot = 1; slot <= count; slot += 1) {
      context.store.insertMatch({
        eventId: event.id,
        pouleId: 0,
        round: event.numRounds + step,
        tableNo: slot,
        teamAId: null,
        teamBId: null,
        phase: 'ko',
        bracket: koLabel(count),
      });
    }
  }

  // A third-place match only makes sense once there are semi-finals to lose.
  if (options.bronze && rounds >= 2) {
    context.store.insertMatch({
      eventId: event.id,
      pouleId: 0,
      round: event.numRounds + rounds,
      tableNo: 2,
      teamAId: null,
      teamBId: null,
      phase: 'ko',
      bracket: 'Bronze final',
    });
  }

  context.store.ensureMatchCodes(event.id);
  advanceBracket(context, event);   // a first-round bye is already decided
  for (let step = 1; step <= rounds; step += 1) {
    context.store.assignPhysicalTables(event.id, event.numRounds + step);
  }

  return succeed({
    created: pairs.length,
    round: firstRound,
    label: koLabel(size / 2),
    bracketSize: size,
  });
}

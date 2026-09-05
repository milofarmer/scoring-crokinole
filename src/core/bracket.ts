/**
 * Finals: who qualifies, how they are seeded, and how winners advance.
 *
 * Qualification: the top N of every poule (guaranteed) plus the best M teams from
 * the next placing across all poules — e.g. all poule winners plus the best five
 * runners-up. Runners-up are compared on points then 20's only, never head-to-head.
 */
import type { Qualifier, RankedTeam } from '../types/index.ts';

/** points desc, then 20's desc, then team number asc. */
function byPointsThenTwenties(a: RankedTeam, b: RankedTeam): number {
  if (a.points !== b.points) return b.points - a.points;
  if (a.twenties !== b.twenties) return b.twenties - a.twenties;
  return a.number - b.number;
}

/**
 * Standard bracket seed order for a power-of-two draw: consecutive pairs are the
 * first-round matches, and the top seeds meet as late as possible.
 * For 8: [1,8,4,5,2,7,3,6].
 */
export function bracketOrder(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) {
    const boundary = order.length * 2 + 1;
    const next: number[] = [];
    for (const seed of order) {
      next.push(seed, boundary - seed);
    }
    order = next;
  }
  return order;
}

/** Smallest power of two that holds `count` teams (minimum 2). */
export function bracketSize(count: number): number {
  let size = 2;
  while (size < count) size *= 2;
  return size;
}

/**
 * Pick the finalists. `rankedByPoule` is each poule already in finishing order.
 * Seed order: guaranteed qualifiers first (by poule position), then wildcards,
 * each group sorted on points then 20's.
 */
export function selectQualifiers(
  rankedByPoule: readonly (readonly RankedTeam[])[],
  perPoule: number,
  wildcards: number,
): Qualifier[] {
  const guaranteed: Qualifier[] = [];
  const wildcardPool: Qualifier[] = [];

  for (const poule of rankedByPoule) {
    for (let i = 0; i < perPoule; i += 1) {
      const row = poule[i];
      if (row !== undefined) guaranteed.push({ ...row, pos: i + 1 });
    }
    const next = poule[perPoule];
    if (next !== undefined) wildcardPool.push({ ...next, pos: perPoule + 1 });
  }

  wildcardPool.sort(byPointsThenTwenties);
  const chosen = wildcardPool.slice(0, Math.max(0, wildcards));

  return [...guaranteed, ...chosen].sort((a, b) =>
    a.pos !== b.pos ? a.pos - b.pos : byPointsThenTwenties(a, b),
  );
}

/**
 * First-round pairings for a seeded field. Seeds are taken in bracket order;
 * empty slots become byes, always keeping the real team on side A.
 */
export function firstRoundPairs(
  seeds: readonly Qualifier[],
): { readonly a: number | null; readonly b: number | null }[] {
  const size = bracketSize(seeds.length);
  const order = bracketOrder(size);
  const pairs: { a: number | null; b: number | null }[] = [];

  for (let i = 0; i < size; i += 2) {
    const seedA = order[i];
    const seedB = order[i + 1];
    let a = seedA === undefined ? null : (seeds[seedA - 1]?.teamId ?? null);
    let b = seedB === undefined ? null : (seeds[seedB - 1]?.teamId ?? null);
    if (a === null && b !== null) {
      a = b;
      b = null;
    }
    pairs.push({ a, b });
  }
  return pairs;
}

/** Label a knockout round by how many matches it holds. */
export function koLabel(matches: number): string {
  if (matches === 1) return 'Final';
  if (matches === 2) return 'Semi-finals';
  if (matches === 4) return 'Quarter-finals';
  if (matches === 8) return 'Round of 16';
  if (matches === 16) return 'Round of 32';
  return `Round of ${matches * 2}`;
}

/**
 * Where the winner of match `index` lands in the next round: match `index / 2`,
 * on side A for even indexes and side B for odd ones.
 */
export function advanceTarget(index: number): { readonly match: number; readonly side: 'a' | 'b' } {
  return { match: Math.floor(index / 2), side: index % 2 === 0 ? 'a' : 'b' };
}

/**
 * Setting up a tournament. Two things vary between events: how many entrants
 * there are, and whether it is singles or doubles. Everything else (poules, a
 * Swiss draw, then a knockout) stays the same.
 */
import type { Discipline } from '../types/index.ts';

/** How many people make up one entry. */
export function playersPerEntry(discipline: Discipline): number {
  return discipline === 'singles' ? 1 : 2;
}

/** What one entry is called, for labels and headings. */
export function entryNoun(discipline: Discipline, plural = false): string {
  const word = discipline === 'singles' ? 'player' : 'team';
  return plural ? `${word}s` : word;
}

/**
 * Split `entrants` into poules of roughly `targetSize`, as evenly as possible.
 * Returns the size of each poule, largest first, e.g. 44 entrants at a target of
 * 4 gives eleven poules of 4; at a target of 8 it gives 8,8,7,7,7,7.
 *
 * Even poules matter: a team in a small poule would otherwise play fewer matches
 * than one in a large poule and reach the same standings on less evidence.
 */
export function planPoules(entrants: number, targetSize: number): number[] {
  if (entrants <= 0) return [];
  const size = Math.max(2, Math.trunc(targetSize));
  const count = Math.max(1, Math.round(entrants / size));
  const base = Math.floor(entrants / count);
  const remainder = entrants % count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

/** Poule names A, B, C ... and beyond Z, AA, AB ... so any field size works. */
export function pouleName(index: number): string {
  let name = '';
  let n = index;
  do {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return name;
}

export interface PoulePlan {
  readonly name: string;
  readonly size: number;
}

/** The poules to create for a field, ready to hand to the organiser. */
export function poulePlan(entrants: number, targetSize: number): PoulePlan[] {
  return planPoules(entrants, targetSize).map((size, index) => ({
    name: pouleName(index),
    size,
  }));
}

/**
 * How many entries reach the knockout, given the poules and the qualification
 * rule. Kept here so the organiser can be shown the bracket size before drawing.
 */
export function finalistCount(pouleCount: number, perPoule: number, wildcards: number): number {
  return Math.max(0, pouleCount * Math.max(0, perPoule) + Math.max(0, wildcards));
}

/** Byes needed to round a field of finalists up to a full bracket. */
export function byesNeeded(finalists: number): number {
  if (finalists < 2) return 0;
  let size = 2;
  while (size < finalists) size *= 2;
  return size - finalists;
}

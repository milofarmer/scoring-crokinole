/**
 * The typed context every route is handed: config plus the store. Routes never
 * reach for a global, so a test can build a context over an in-memory database.
 */
import type { AppConfig } from '../config/index.ts';
import type { StoredEvent, TournamentStore } from '../services/tournament-store.ts';
import { makeCode } from '../services/tournament-store.ts';

export interface ApiContext {
  readonly config: AppConfig;
  readonly store: TournamentStore;
}

/** Why a request was refused, mapped to a status code by the route layer. */
export type FailureReason = 'not_found' | 'unauthorised' | 'conflict' | 'bad_request';

export interface Failure {
  readonly ok: false;
  readonly reason: FailureReason;
  readonly error: string;
}

export type Result<T> = { readonly ok: true; readonly value: T } | Failure;

export function fail(reason: FailureReason, error: string): Failure {
  return { ok: false, reason, error };
}

export function succeed<T>(value: T): Result<T> {
  return { ok: true, value };
}

export const STATUS_BY_REASON: Readonly<Record<FailureReason, number>> = {
  bad_request: 400,
  unauthorised: 401,
  not_found: 404,
  conflict: 409,
};

/** The event everything else hangs off, or a clear failure. */
export function requireEvent(context: ApiContext): Result<StoredEvent> {
  const event = context.store.activeEvent();
  if (event === null) return fail('not_found', 'No tournament has been created yet.');
  return succeed(event);
}

/**
 * The machine key used by an automated scoring system. Generated on first use so
 * an event created before this feature existed still gets one.
 */
export function machineKey(context: ApiContext, event: StoredEvent): string {
  if (event.apiKey !== '') return event.apiKey;
  const key = `crok_${makeCode(24)}`;
  context.store.setEventApiKey(event.id, key);
  return key;
}

/** Constant-time-ish comparison, so a wrong key does not leak its length by timing. */
export function secretMatches(expected: string, given: string): boolean {
  if (expected === '' || given === '') return false;
  if (expected.length !== given.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  }
  return diff === 0;
}

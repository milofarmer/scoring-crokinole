/**
 * HTTP surface. Routes stay thin: read the request, call into core/services,
 * map a Result to a status code.
 */
import express from 'express';
import type { Request, Response, Router } from 'express';
import type { ApiContext, Failure, Result } from './context.ts';
import { STATUS_BY_REASON, machineKey, requireEvent, secretMatches } from './context.ts';
import { buildState } from './state.ts';
import { applyScore, authoriseScore, type ScoreInput } from './score.ts';
import { isRecord } from '../services/rows.ts';
import type { SetScore } from '../types/index.ts';

function sendFailure(res: Response, failure: Failure): void {
  res.status(STATUS_BY_REASON[failure.reason]).json({ ok: false, error: failure.error });
}

/** Narrow an untrusted body field to a number, or undefined. */
function optionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function optionalText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Per-set scores arrive from a phone or a machine, so validate rather than trust. */
function readSets(value: unknown): SetScore[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const sets: SetScore[] = [];
  for (const entry of value.slice(0, 4)) {
    if (!isRecord(entry)) continue;
    sets.push({
      pa: optionalNumber(entry.pa) ?? null,
      pb: optionalNumber(entry.pb) ?? null,
      ta: optionalNumber(entry.ta) ?? 0,
      tb: optionalNumber(entry.tb) ?? 0,
    });
  }
  return sets;
}

function readScoreInput(fields: Record<string, unknown>): ScoreInput {
  const input: {
    sets?: readonly SetScore[];
    pointsA?: number;
    pointsB?: number;
    twentiesA?: number;
    twentiesB?: number;
    shootoutWinner?: number | null;
    complete?: boolean;
    enteredBy?: string;
  } = {};

  const sets = readSets(fields.sets);
  if (sets !== undefined) input.sets = sets;

  const pointsA = optionalNumber(fields.pointsA);
  const pointsB = optionalNumber(fields.pointsB);
  if (pointsA !== undefined) input.pointsA = pointsA;
  if (pointsB !== undefined) input.pointsB = pointsB;

  const twentiesA = optionalNumber(fields.twentiesA);
  const twentiesB = optionalNumber(fields.twentiesB);
  if (twentiesA !== undefined) input.twentiesA = twentiesA;
  if (twentiesB !== undefined) input.twentiesB = twentiesB;

  input.shootoutWinner = optionalNumber(fields.shootoutWinner) ?? null;
  input.complete = fields.complete === true;
  input.enteredBy = optionalText(fields.enteredBy);
  return input;
}

function body(req: Request): Record<string, unknown> {
  return isRecord(req.body) ? req.body : {};
}

export function createRouter(context: ApiContext): Router {
  const router = express.Router();

  /** Everything a phone or board needs, with no secrets in it. */
  router.get('/state', (_req, res) => {
    const event = requireEvent(context);
    if (!event.ok) return sendFailure(res, event);
    return res.json({ ok: true, ...buildState(context, event.value) });
  });

  /** A team signs in with the code on their card and sees their own matches. */
  router.post('/team-login', (req, res) => {
    const event = requireEvent(context);
    if (!event.ok) return sendFailure(res, event);

    const code = optionalText(body(req).code);
    const team = code === '' ? null : context.store.teamByLoginCode(event.value.id, code);
    if (team === null) return sendFailure(res, { ok: false, reason: 'unauthorised', error: 'Unknown team code.' });
    return res.json({ ok: true, team: { id: team.id, name: team.name, number: team.number, pouleId: team.pouleId } });
  });

  /** Score a match. The credential decides whether this is allowed, not the caller. */
  router.post('/score', (req, res) => {
    const event = requireEvent(context);
    if (!event.ok) return sendFailure(res, event);
    const fields = body(req);

    const matchCode = optionalText(fields.matchCode);
    const matchId = optionalNumber(fields.matchId);
    const match =
      matchCode !== ''
        ? context.store.matchByCode(event.value.id, matchCode)
        : matchId === undefined
          ? null
          : context.store.matchById(event.value.id, matchId);

    if (match === null) {
      return sendFailure(res, { ok: false, reason: 'not_found', error: 'No match with that code or id.' });
    }
    if (match.teamBId === null) {
      return sendFailure(res, { ok: false, reason: 'conflict', error: 'That match is a bye, so there is nothing to score.' });
    }

    const allowed = authoriseScore(context, event.value, match, optionalText(fields.code));
    if (!allowed.ok) return sendFailure(res, allowed);

    const saved = applyScore(context, event.value, match, readScoreInput(fields));
    return res.json({
      ok: true,
      by: allowed.value,
      match: {
        id: saved.id,
        pointsA: saved.pointsA,
        pointsB: saved.pointsB,
        twentiesA: saved.twentiesA,
        twentiesB: saved.twentiesB,
        status: saved.status,
      },
    });
  });

  /** What is on each table now, for an automated scoring system to map to. */
  router.get('/ingest/tables', (req, res) => {
    const event = requireEvent(context);
    if (!event.ok) return sendFailure(res, event);

    const given = optionalText(req.header('x-api-key'));
    if (!secretMatches(machineKey(context, event.value), given)) {
      return sendFailure(res, { ok: false, reason: 'unauthorised', error: 'Invalid API key.' });
    }
    const state = buildState(context, event.value);
    return res.json({ ok: true, round: state.event.currentRound, matches: state.roundMatches });
  });

  return router;
}

/** Kept exported so a route test can assert the mapping without a live server. */
export function statusFor(result: Result<unknown>): number {
  return result.ok ? 200 : STATUS_BY_REASON[result.reason];
}

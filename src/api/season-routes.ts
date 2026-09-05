/**
 * HTTP surface for the season ranking.
 *
 * The pages that call this already exist, so the contract is fixed: snake_case
 * fields, the same action names, and the same status codes the PHP version
 * returned. Routes stay thin and hand the work to the season store.
 */
import express from 'express';
import type { Request, Response, Router } from 'express';
import type { ApiContext, Failure, FailureReason } from './context.ts';
import { fail, secretMatches } from './context.ts';
import type { SeasonNightType, SeasonStore } from '../services/season-store.ts';
import { isRecord } from '../services/rows.ts';

export type SeasonHandler = (req: Request, res: Response) => void;

/**
 * Refusing an organiser write is a 403 here rather than the 401 the tournament
 * routes use. The PIN is not a login, and the pages were written against the
 * status the PHP endpoint returns, so changing it would be a silent break.
 */
const SEASON_STATUS: Readonly<Record<FailureReason, number>> = {
  bad_request: 400,
  unauthorised: 403,
  not_found: 404,
  conflict: 409,
};

function sendFailure(res: Response, failure: Failure): void {
  res.status(SEASON_STATUS[failure.reason]).json({ ok: false, error: failure.error });
}

/**
 * Query string and JSON body together, body winning. Some calls arrive as a GET
 * with `?action=`, others as a JSON POST, and both must read the same.
 */
function fields(req: Request): Record<string, unknown> {
  const query = isRecord(req.query) ? req.query : {};
  const body = isRecord(req.body) ? req.body : {};
  return { ...query, ...body };
}

/** A trimmed string, treating anything that is not text as absent. */
function readText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

/**
 * A number from a form field. The fallback applies only when the caller left the
 * field out entirely; an empty or unparseable value reads as zero, which is what
 * the pages have always sent and relied on.
 */
function readNumber(value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value !== 'string') return 0;
  const leading = /^\s*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/.exec(value);
  if (leading === null) return 0;
  const parsed = Number(leading[0]);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readInteger(value: unknown, fallback: number): number {
  return Math.trunc(readNumber(value, fallback));
}

function nightType(value: unknown): SeasonNightType {
  return value === 'doubles' ? 'doubles' : 'singles';
}

/**
 * Organiser writes are guarded by the event's admin PIN. The season tables are
 * not tied to an event, but the PIN on the current event is the only credential
 * the organiser has, so it is what gates these writes.
 */
function requireOrganiser(context: ApiContext, given: Record<string, unknown>): Failure | null {
  const event = context.store.activeEvent();
  if (event === null) return fail('not_found', 'No event exists yet.');
  if (event.adminPin === '') return fail('unauthorised', 'Event has no admin PIN set.');
  if (!secretMatches(event.adminPin, readText(given.admin_pin))) return fail('unauthorised', 'Wrong organizer PIN.');
  return null;
}

/**
 * Every action, keyed by the name the legacy `?action=` dispatch uses. The
 * router below is built from this map, so there is one definition per action
 * however it is reached.
 */
export function seasonActionHandlers(
  context: ApiContext,
  seasons: SeasonStore,
): Readonly<Record<string, SeasonHandler>> {
  /** Run a handler only once the organiser PIN checks out. */
  function guarded(handler: (given: Record<string, unknown>, res: Response) => void): SeasonHandler {
    return (req, res) => {
      const given = fields(req);
      const refusal = requireOrganiser(context, given);
      if (refusal !== null) return sendFailure(res, refusal);
      return handler(given, res);
    };
  }

  return {
    /** Public leaderboard plus every night, with no secrets in it. */
    season_state: (req, res) => {
      const season = readText(fields(req).season);
      res.json({
        ok: true,
        seasons: seasons.seasons(),
        standings: seasons.standings(season === '' ? null : season),
        nights: seasons.nightSummaries(),
      });
    },

    /** Everything the organiser view edits, including per-result rows. */
    season_data: guarded((_given, res) => {
      res.json({
        ok: true,
        players: seasons.players(),
        nights: seasons.nights(),
        results: seasons.results(),
      });
    }),

    season_add_player: guarded((given, res) => {
      const name = readText(given.name);
      if (name === '') return sendFailure(res, fail('bad_request', 'Player name?'));
      return res.json({ ok: true, id: seasons.addPlayer(name) });
    }),

    season_save_night: guarded((given, res) => {
      const id = seasons.saveNight({
        id: readInteger(given.id, 0),
        season: readText(given.season ?? 'S17'),
        name: readText(given.name),
        date: readText(given.date),
        host: readText(given.host),
        type: nightType(given.type),
        fieldSize: Math.max(1, readInteger(given.field_size, 1)),
        fsi: readNumber(given.fsi, 1),
        fdi: readNumber(given.fdi, 1),
      });
      // Editing a field size or an index re-prices results already entered.
      seasons.recomputeNight(id);
      res.json({ ok: true, id });
    }),

    season_add_result: guarded((given, res) => {
      const nightId = readInteger(given.snight_id, 0);
      const playerId = readInteger(given.player_id, 0);
      const position = Math.max(1, readInteger(given.position, 1));
      if (playerId === 0) return sendFailure(res, fail('bad_request', 'Pick a night and a player.'));
      const points = seasons.addResult(nightId, playerId, position);
      if (points === null) return sendFailure(res, fail('bad_request', 'Pick a night and a player.'));
      return res.json({ ok: true, fwp: points });
    }),

    season_delete_result: guarded((given, res) => {
      seasons.deleteResult(readInteger(given.id, 0));
      res.json({ ok: true });
    }),

    season_delete_night: guarded((given, res) => {
      seasons.deleteNight(readInteger(given.id, 0));
      res.json({ ok: true });
    }),
  };
}

/**
 * Mount under `/api` so `/api/season_state` reaches the same handler the legacy
 * `api.php?action=season_state` dispatch does. Both verbs are accepted because
 * the public page reads with GET while the organiser page posts JSON.
 */
export function createSeasonRouter(context: ApiContext, seasons: SeasonStore): Router {
  const router = express.Router();
  for (const [action, handler] of Object.entries(seasonActionHandlers(context, seasons))) {
    router.get(`/${action}`, handler);
    router.post(`/${action}`, handler);
  }
  return router;
}

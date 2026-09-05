/**
 * The HTTP surface, as described in public/openapi.json.
 *
 * Every call is one action, reachable two ways: /api/state is the same request
 * as api.php?action=state. The path form is the one to use; the query form is
 * older and kept working so nothing that already integrates has to change.
 *
 * Routes stay thin. They read the request, check the credential, call into core
 * or services, and map a Result onto a status code. Anything worth testing lives
 * below this file.
 */
import express from 'express';
import type { Request, Response, Router } from 'express';
import type { ApiContext, Failure, Result } from './context.ts';
import { STATUS_BY_REASON, fail, machineKey, requireEvent, secretMatches, succeed } from './context.ts';
import { applyScore, authoriseScore, type ScoreInput } from './score.ts';
import { drawKnockout, drawRound } from './draw.ts';
import { serialiseIngestMatch, serialiseMatch, serialiseScheduleMatch, serialiseStanding, teamLookup } from './serialise.ts';
import { isRecord } from '../services/rows.ts';
import { makeCode, type StoredEvent } from '../services/tournament-store.ts';
import { rankPoule } from '../core/standings.ts';
import { koLabel } from '../core/bracket.ts';
import type { Match, SetScore } from '../types/index.ts';

function sendFailure(res: Response, failure: Failure): void {
  res.status(STATUS_BY_REASON[failure.reason]).json({ ok: false, error: failure.error });
}

/* ---- reading an untrusted request ---- */

function body(req: Request): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(req.query)) merged[key] = value;
  if (isRecord(req.body)) Object.assign(merged, req.body);
  return merged;
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return undefined;
}

function count(value: unknown): number {
  return optionalNumber(value) ?? 0;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Per-set scores come from a phone or a machine, so check rather than trust. */
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

function readScoreInput(fields: Record<string, unknown>, enteredBy: string): ScoreInput {
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

  const pointsA = optionalNumber(fields.points_a);
  const pointsB = optionalNumber(fields.points_b);
  if (pointsA !== undefined) input.pointsA = pointsA;
  if (pointsB !== undefined) input.pointsB = pointsB;

  const twentiesA = optionalNumber(fields.twenties_a);
  const twentiesB = optionalNumber(fields.twenties_b);
  if (twentiesA !== undefined) input.twentiesA = twentiesA;
  if (twentiesB !== undefined) input.twentiesB = twentiesB;

  input.shootoutWinner = optionalNumber(fields.shootout_winner) ?? null;
  input.complete = fields.complete === true || fields.complete === 'true';
  input.enteredBy = enteredBy;
  return input;
}

export function createRouter(context: ApiContext): Router {
  const router = express.Router();

  const eventOr = (res: Response): StoredEvent | null => {
    const found = requireEvent(context);
    if (found.ok) return found.value;
    sendFailure(res, found);
    return null;
  };

  /** The organiser PIN guards everything that changes the tournament's shape. */
  const asOrganiser = (req: Request, res: Response): StoredEvent | null => {
    const event = eventOr(res);
    if (event === null) return null;
    if (event.adminPin === '') {
      sendFailure(res, fail('unauthorised', 'This tournament has no organiser PIN set.'));
      return null;
    }
    if (!secretMatches(event.adminPin, text(body(req).admin_pin))) {
      sendFailure(res, fail('unauthorised', 'Wrong organizer PIN.'));
      return null;
    }
    return event;
  };

  /** An automated scoring system proves itself with the event's API key. */
  const asMachine = (req: Request, res: Response): StoredEvent | null => {
    const event = eventOr(res);
    if (event === null) return null;
    const given = text(req.header('x-api-key')) || text(body(req).api_key);
    if (!secretMatches(machineKey(context, event), given)) {
      sendFailure(res, fail('unauthorised', 'Invalid API key.'));
      return null;
    }
    return event;
  };

  const publicState = (event: StoredEvent): Record<string, unknown> => {
    const teams = context.store.teams(event.id);
    const poules = context.store.poules(event.id);
    const all = context.store.matches(event.id);
    const ref = teamLookup(teams);

    const standings: Record<string, unknown> = {};
    for (const poule of poules) {
      standings[String(poule.id)] = rankPoule(teams, all, poule.id).map(serialiseStanding);
    }
    // Teams not yet placed in a poule still have to appear somewhere.
    standings['0'] = rankPoule(teams, all, 0).map(serialiseStanding);

    const round = event.currentRound;
    const roundMatches = all.filter((match) => match.round === round);
    const isKnockout = round > event.numRounds;
    const first = roundMatches[0];

    return {
      event: {
        id: event.id,
        name: event.name,
        num_rounds: event.numRounds,
        current_round: round,
        is_knockout: isKnockout,
        round_label: isKnockout && first !== undefined ? (first.bracket ?? 'Knockout') : `Round ${round}`,
        status: event.status,
      },
      poules: poules.map((poule) => ({ id: poule.id, name: poule.name, tables: poule.tables })),
      standings,
      round_matches: roundMatches.map((match) => serialiseMatch(match, ref)),
      server_time: Math.floor(Date.now() / 1000),
    };
  };

  /* ---- the tournament, open to anyone on the network ---- */

  router.all('/state', (req, res) => {
    const event = context.store.activeEvent();
    if (event === null) return res.json({ ok: true, event: null });
    return res.json({ ok: true, ...publicState(event) });
  });

  router.all('/schedule', (req, res) => {
    const event = context.store.activeEvent();
    if (event === null) return res.json({ ok: true, event: null });
    context.store.ensureMatchCodes(event.id);
    context.store.ensurePhysicalTables(event.id);

    const ref = teamLookup(context.store.teams(event.id));
    const rounds: Record<string, Record<string, unknown>[]> = {};
    for (const match of context.store.matches(event.id)) {
      const key = String(match.round);
      const list = rounds[key] ?? [];
      list.push(serialiseScheduleMatch(match, ref));
      rounds[key] = list;
    }
    return res.json({
      ok: true,
      event: { name: event.name, current_round: event.currentRound, num_rounds: event.numRounds },
      poules: context.store.poules(event.id).map((p) => ({ id: p.id, name: p.name, tables: p.tables })),
      rounds,
    });
  });

  /* ---- players ---- */

  router.post('/team_login', (req, res) => {
    const event = eventOr(res);
    if (event === null) return undefined;
    const team = context.store.teamByLoginCode(event.id, text(body(req).code));
    if (team === null) return sendFailure(res, fail('unauthorised', 'Unknown team code.'));
    return res.json({
      ok: true,
      team: {
        id: team.id, name: team.name, number: team.number,
        poule_id: team.pouleId, player1: team.player1, player2: team.player2,
      },
    });
  });

  router.post('/match_login', (req, res) => {
    const event = eventOr(res);
    if (event === null) return undefined;
    context.store.ensureMatchCodes(event.id);
    const match = context.store.matchByCode(event.id, text(body(req).code));
    if (match === null) return sendFailure(res, fail('unauthorised', 'Unknown match code.'));
    const ref = teamLookup(context.store.teams(event.id));
    return res.json({ ok: true, match: { ...serialiseMatch(match, ref), num_rounds: event.numRounds } });
  });

  router.post('/submit_score', (req, res) => {
    const event = eventOr(res);
    if (event === null) return undefined;
    const fields = body(req);

    const match = context.store.matchById(event.id, count(fields.match_id));
    if (match === null) return sendFailure(res, fail('not_found', 'Match not found.'));

    const allowed = authoriseScore(context, event, match, text(fields.code));
    if (!allowed.ok) return sendFailure(res, allowed);

    const saved = applyScore(context, event, match, readScoreInput(fields, text(fields.entered_by)));
    return res.json({ ok: true, status: saved.status });
  });

  /* ---- automated scoring ---- */

  router.all('/ingest_tables', (req, res) => {
    const event = asMachine(req, res);
    if (event === null) return undefined;
    context.store.ensureMatchCodes(event.id);
    context.store.ensurePhysicalTables(event.id);

    const round = optionalNumber(body(req).round) ?? event.currentRound;
    const ref = teamLookup(context.store.teams(event.id));
    const pouleNames = new Map(context.store.poules(event.id).map((p) => [p.id, p.name]));

    return res.json({
      ok: true,
      round,
      matches: context.store
        .matches(event.id, round)
        .map((match) => serialiseIngestMatch(match, ref, pouleNames.get(match.pouleId) ?? null)),
    });
  });

  router.post('/ingest_score', (req, res) => {
    const event = asMachine(req, res);
    if (event === null) return undefined;
    context.store.ensureMatchCodes(event.id);
    context.store.ensurePhysicalTables(event.id);

    const fields = body(req);
    const found = resolveMatch(context, event, fields);
    if (!found.ok) return sendFailure(res, found);
    const match = found.value;

    if (match.teamBId === null) {
      return sendFailure(res, fail('conflict', 'That match is a bye, so there is nothing to score.'));
    }

    const source = text(fields.source) || 'auto';
    const saved = applyScore(context, event, match, readScoreInput(fields, source));
    const ref = teamLookup(context.store.teams(event.id));
    const winner = saved.pointsA === null || saved.pointsB === null ? null
      : saved.pointsA > saved.pointsB ? 'a'
      : saved.pointsB > saved.pointsA ? 'b'
      : saved.shootoutWinner === null ? null
      : saved.shootoutWinner === saved.teamAId ? 'a' : 'b';

    return res.json({
      ok: true,
      match: {
        ...serialiseMatch(saved, ref),
        winner,
        winner_team_id: winner === null ? null : winner === 'a' ? saved.teamAId : saved.teamBId,
      },
    });
  });

  /* ---- the organiser ---- */

  router.post('/admin_login', (req, res) => {
    const event = asOrganiser(req, res);
    if (event === null) return undefined;
    return res.json({ ok: true, event_id: event.id });
  });

  router.post('/admin_state', (req, res) => {
    const event = asOrganiser(req, res);
    if (event === null) return undefined;
    const teams = context.store.teams(event.id);
    const ref = teamLookup(teams);
    return res.json({
      ok: true,
      event: {
        id: event.id, name: event.name, num_rounds: event.numRounds,
        current_round: event.currentRound, advance_per_poule: event.advancePerPoule,
        wildcards: event.wildcards, discipline: event.discipline,
        play_code: event.playCode, api_key: machineKey(context, event), status: event.status,
      },
      poules: context.store.poules(event.id).map((p) => ({ id: p.id, name: p.name, tables: p.tables })),
      teams: teams.map((team) => ({
        id: team.id, number: team.number, name: team.name,
        player1: team.player1, player2: team.player2,
        poule_id: team.pouleId, login_code: team.loginCode,
      })),
      matches: context.store.matches(event.id).map((match) => serialiseMatch(match, ref)),
    });
  });

  router.post('/create_event', (req, res) => {
    const fields = body(req);
    const name = text(fields.name);
    if (name === '') return sendFailure(res, fail('bad_request', 'A tournament needs a name.'));
    const pin = text(fields.admin_pin);
    if (pin === '') return sendFailure(res, fail('bad_request', 'Set an organiser PIN, or nobody can run this.'));

    const id = context.store.createEvent({
      name,
      adminPin: pin,
      playCode: text(fields.play_code),
      discipline: text(fields.discipline) === 'singles' ? 'singles' : 'doubles',
      numRounds: optionalNumber(fields.num_rounds) ?? 4,
    });
    return res.json({ ok: true, event_id: id });
  });

  router.post('/update_event', (req, res) => {
    const event = asOrganiser(req, res);
    if (event === null) return undefined;
    const fields = body(req);

    const changes: Parameters<typeof context.store.updateEvent>[1] = {};
    const name = text(fields.name);
    if (name !== '') Object.assign(changes, { name });
    if (typeof fields.play_code === 'string') Object.assign(changes, { playCode: fields.play_code.trim() });
    for (const [key, field] of [
      ['numRounds', 'num_rounds'], ['currentRound', 'current_round'],
      ['advancePerPoule', 'advance_per_poule'], ['wildcards', 'wildcards'],
    ] as const) {
      const value = optionalNumber(fields[field]);
      if (value !== undefined) Object.assign(changes, { [key]: value });
    }
    if (fields.bronze_final !== undefined) {
      Object.assign(changes, { bronzeFinal: fields.bronze_final === true || fields.bronze_final === 'true' });
    }
    const discipline = text(fields.discipline);
    if (discipline === 'singles' || discipline === 'doubles') Object.assign(changes, { discipline });
    const status = text(fields.status);
    if (status !== '') Object.assign(changes, { status });

    context.store.updateEvent(event.id, changes);
    return res.json({ ok: true });
  });

  router.post('/set_poules', (req, res) => {
    const event = asOrganiser(req, res);
    if (event === null) return undefined;
    const raw = body(req).poules;
    if (!Array.isArray(raw)) return sendFailure(res, fail('bad_request', 'Send the poules to create.'));

    const poules = raw.filter(isRecord).map((entry) => ({
      name: text(entry.name),
      tables: optionalNumber(entry.tables) ?? 11,
    })).filter((poule) => poule.name !== '');

    context.store.setPoules(event.id, poules);
    return res.json({ ok: true, created: poules.length });
  });

  const addOneTeam = (event: StoredEvent, entry: Record<string, unknown>, taken: Set<string>): number | null => {
    const name = text(entry.name);
    if (name === '') return null;
    let code = makeCode(4);
    while (taken.has(code)) code = makeCode(4);
    taken.add(code);
    return context.store.addTeam({
      eventId: event.id,
      name,
      player1: text(entry.player1),
      player2: text(entry.player2),
      pouleId: optionalNumber(entry.poule_id) ?? 0,
      number: context.store.nextTeamNumber(event.id),
      loginCode: code,
    });
  };

  router.post('/add_team', (req, res) => {
    const event = asOrganiser(req, res);
    if (event === null) return undefined;
    const id = addOneTeam(event, body(req), context.store.takenLoginCodes(event.id));
    if (id === null) return sendFailure(res, fail('bad_request', 'A team needs a name.'));
    return res.json({ ok: true, team_id: id });
  });

  router.post('/bulk_add_teams', (req, res) => {
    const event = asOrganiser(req, res);
    if (event === null) return undefined;
    const raw = body(req).teams;
    if (!Array.isArray(raw)) return sendFailure(res, fail('bad_request', 'Send the teams to add.'));

    const taken = context.store.takenLoginCodes(event.id);
    let added = 0;
    for (const entry of raw) {
      if (!isRecord(entry)) continue;
      if (addOneTeam(event, entry, taken) !== null) added += 1;
    }
    return res.json({ ok: true, added });
  });

  router.post('/update_team', (req, res) => {
    const event = asOrganiser(req, res);
    if (event === null) return undefined;
    const fields = body(req);
    const teamId = count(fields.team_id);
    if (context.store.teamById(event.id, teamId) === null) {
      return sendFailure(res, fail('not_found', 'No such team.'));
    }
    const changes: Parameters<typeof context.store.updateTeam>[2] = {};
    for (const [key, field] of [['name', 'name'], ['player1', 'player1'], ['player2', 'player2']] as const) {
      if (typeof fields[field] === 'string') Object.assign(changes, { [key]: fields[field].trim() });
    }
    const pouleId = optionalNumber(fields.poule_id);
    if (pouleId !== undefined) Object.assign(changes, { pouleId });

    context.store.updateTeam(event.id, teamId, changes);
    return res.json({ ok: true });
  });

  router.post('/delete_team', (req, res) => {
    const event = asOrganiser(req, res);
    if (event === null) return undefined;
    context.store.deleteTeam(event.id, count(body(req).team_id));
    return res.json({ ok: true });
  });

  router.post('/generate_round', (req, res) => {
    const event = asOrganiser(req, res);
    if (event === null) return undefined;
    const fields = body(req);
    const round = optionalNumber(fields.round) ?? event.currentRound;
    const drawn = drawRound(context, event, round, fields.force === true || fields.force === 'true');
    if (!drawn.ok) return sendFailure(res, drawn);
    context.store.updateEvent(event.id, { currentRound: round, status: 'running' });
    return res.json({ ok: true, ...drawn.value, round });
  });

  router.post('/generate_ko', (req, res) => {
    const event = asOrganiser(req, res);
    if (event === null) return undefined;
    const fields = body(req);
    const size = optionalNumber(fields.size);
    const drawn = drawKnockout(context, event, {
      ...(size === undefined ? {} : { size }),
      bronze: fields.bronze === true || fields.bronze === 'true',
    });
    if (!drawn.ok) return sendFailure(res, drawn);
    context.store.updateEvent(event.id, { currentRound: drawn.value.round, status: 'running' });
    return res.json({ ok: true, ...drawn.value });
  });

  router.post('/generate_next_ko', (req, res) => {
    const event = asOrganiser(req, res);
    if (event === null) return undefined;
    // Winners are carried through as results arrive; this is the manual nudge.
    const knockout = context.store.matches(event.id).filter((match) => match.phase === 'ko');
    const rounds = [...new Set(knockout.map((match) => match.round))].sort((a, b) => a - b);
    const next = rounds.find((round) => round > event.currentRound);
    if (next === undefined) return sendFailure(res, fail('conflict', 'There is no knockout round after this one.'));
    context.store.updateEvent(event.id, { currentRound: next });
    const label = knockout.find((match) => match.round === next)?.bracket ?? koLabel(1);
    return res.json({ ok: true, round: next, label });
  });

  router.post('/set_match', (req, res) => {
    const event = asOrganiser(req, res);
    if (event === null) return undefined;
    const fields = body(req);
    const match = context.store.matchById(event.id, count(fields.match_id));
    if (match === null) return sendFailure(res, fail('not_found', 'Match not found.'));

    const status = text(fields.status);
    const saved = applyScore(context, event, match, {
      ...readScoreInput(fields, 'organiser'),
      complete: status === 'entered' || status === 'confirmed' || fields.complete === true,
    });
    if (status === 'confirmed') context.store.setMatchStatus(saved.id, 'confirmed');
    return res.json({ ok: true, status: status === 'confirmed' ? 'confirmed' : saved.status });
  });

  router.post('/reset_event', (req, res) => {
    const event = asOrganiser(req, res);
    if (event === null) return undefined;
    context.store.deleteMatches(event.id, {});
    context.store.updateEvent(event.id, { currentRound: 1, status: 'setup' });
    return res.json({ ok: true });
  });

  return router;
}

/**
 * Work out which match a scoring machine means.
 *
 * A match code is never ambiguous, so it wins. A table number means the table in
 * the hall, which is one match per round. Anything that still matches more than
 * one match is refused: sending a result to the wrong table is far worse than an
 * error the caller has to handle.
 */
function resolveMatch(
  context: ApiContext,
  event: StoredEvent,
  fields: Record<string, unknown>,
): Result<Match> {
  const code = text(fields.match_code);
  if (code !== '') {
    const match = context.store.matchByCode(event.id, code);
    return match === null ? fail('not_found', 'Unknown match_code.') : succeed(match);
  }

  const id = optionalNumber(fields.match_id);
  if (id !== undefined) {
    const match = context.store.matchById(event.id, id);
    return match === null ? fail('not_found', 'Unknown match_id.') : succeed(match);
  }

  const table = optionalNumber(fields.table);
  if (table === undefined) {
    return fail('bad_request', 'Identify the match with match_code, match_id, or table.');
  }

  const round = optionalNumber(fields.round) ?? event.currentRound;
  let candidates = context.store.matchByPhysicalTable(event.id, round, table);

  if (candidates.length === 0) {
    // A draw made before tables were numbered through the hall still uses the
    // per-poule number, which needs the poule to tell them apart.
    candidates = context.store.matches(event.id, round).filter((match) => match.tableNo === table);
    const pouleName = text(fields.poule);
    if (pouleName !== '') {
      const poule = context.store
        .poules(event.id)
        .find((entry) => entry.name.toLowerCase() === pouleName.toLowerCase());
      candidates = candidates.filter((match) => match.pouleId === (poule?.id ?? -1));
    }
  }

  const only = candidates[0];
  if (only === undefined) return fail('not_found', `No match at table ${table} in round ${round}.`);
  if (candidates.length > 1) {
    return fail(
      'conflict',
      `Table ${table} is ambiguous in round ${round} (${candidates.length} matches). Send match_code, or add "poule".`,
    );
  }
  return succeed(only);
}

/** Kept exported so a route test can assert the mapping without a live server. */
export function statusFor(result: Result<unknown>): number {
  return result.ok ? 200 : STATUS_BY_REASON[result.reason];
}

/**
 * The public view of a tournament: what the phones, the big board and any
 * automated client all read. Deliberately contains no codes or PINs.
 */
import type { ApiContext } from './context.ts';
import type { StoredEvent } from '../services/tournament-store.ts';
import { rankPoule } from '../core/standings.ts';
import { countsTowardStandings, matchWinner } from '../core/scoring.ts';
import type { Match, RankedTeam } from '../types/index.ts';

export interface PublicTeam {
  readonly id: number;
  readonly name: string;
  readonly number: number;
}

export interface PublicMatch {
  readonly id: number;
  readonly matchCode: string | null;
  readonly pouleId: number;
  readonly round: number;
  readonly table: number;
  readonly phase: 'poule' | 'ko';
  readonly bracket: string | null;
  readonly teamA: PublicTeam | null;
  readonly teamB: PublicTeam | null;
  readonly pointsA: number | null;
  readonly pointsB: number | null;
  readonly twentiesA: number;
  readonly twentiesB: number;
  readonly status: Match['status'];
  readonly counted: boolean;
  /** 'a' | 'b' once decided, so a board never has to re-derive it. */
  readonly winner: 'a' | 'b' | null;
}

export interface PublicState {
  readonly event: {
    readonly id: number;
    readonly name: string;
    readonly currentRound: number;
    readonly numRounds: number;
    readonly pointsWin: number;
    readonly pointsTie: number;
    readonly isKnockout: boolean;
    readonly roundLabel: string;
    readonly status: string;
  };
  readonly poules: readonly { readonly id: number; readonly name: string; readonly tables: number }[];
  /** Ranked teams per poule id. */
  readonly standings: Readonly<Record<string, readonly RankedTeam[]>>;
  readonly roundMatches: readonly PublicMatch[];
}

function toPublicMatch(match: Match, nameOf: (id: number | null) => PublicTeam | null): PublicMatch {
  const winnerId = matchWinner(match);
  const winner = winnerId === null ? null : winnerId === match.teamAId ? 'a' : 'b';
  return {
    id: match.id,
    matchCode: null,
    pouleId: match.pouleId,
    round: match.round,
    table: match.tableNo,
    phase: match.phase,
    bracket: match.bracket,
    teamA: nameOf(match.teamAId),
    teamB: nameOf(match.teamBId),
    pointsA: match.pointsA,
    pointsB: match.pointsB,
    twentiesA: match.twentiesA,
    twentiesB: match.twentiesB,
    status: match.status,
    counted: countsTowardStandings(match),
    winner,
  };
}

export function buildState(context: ApiContext, event: StoredEvent): PublicState {
  const { store } = context;
  store.ensureMatchCodes(event.id);

  const poules = store.poules(event.id);
  const teams = store.teams(event.id);
  const allMatches = store.matches(event.id);
  const roundMatches = allMatches.filter((match) => match.round === event.currentRound);

  const teamById = new Map(teams.map((team) => [team.id, team]));
  const nameOf = (id: number | null): PublicTeam | null => {
    if (id === null) return null;
    const team = teamById.get(id);
    return team === undefined ? null : { id: team.id, name: team.name, number: team.number };
  };

  const standings: Record<string, readonly RankedTeam[]> = {};
  for (const poule of poules) {
    standings[String(poule.id)] = rankPoule(teams, allMatches, poule.id);
  }

  const isKnockout = event.currentRound > event.numRounds;
  const firstKo = roundMatches.find((match) => match.bracket !== null);

  return {
    event: {
      id: event.id,
      name: event.name,
      currentRound: event.currentRound,
      numRounds: event.numRounds,
      pointsWin: event.pointsWin,
      pointsTie: event.pointsTie,
      isKnockout,
      roundLabel: isKnockout ? (firstKo?.bracket ?? 'Knockout') : `Round ${event.currentRound}`,
      status: event.status,
    },
    poules: poules.map((poule) => ({ id: poule.id, name: poule.name, tables: poule.tables })),
    standings,
    roundMatches: roundMatches.map((match) => ({
      ...toPublicMatch(match, nameOf),
      matchCode: store.matchCode(match.id),
    })),
  };
}

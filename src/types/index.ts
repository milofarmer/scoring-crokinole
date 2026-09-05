/**
 * Domain vocabulary for the tournament and the season ranking.
 *
 * Scoring model: a match is 4 sets; each set records points and 20's for both
 * teams. The match is won on TOTAL points over the sets (win 2 / tie 1 / loss 0);
 * total 20's is the ranking tiebreak.
 */

export type MatchPhase = 'poule' | 'ko';

/** pending = drawn, progress = partially entered (auto-save), entered/confirmed = counts. */
export type MatchStatus = 'pending' | 'progress' | 'entered' | 'confirmed';

/**
 * What varies between tournaments: singles is one player per entry, doubles is
 * two. The structure (poules, then a knockout) is the same either way.
 */
export type Discipline = 'singles' | 'doubles';

/** One set. Points are null until entered; 20's default to 0. */
export interface SetScore {
  readonly pa: number | null;
  readonly pb: number | null;
  readonly ta: number;
  readonly tb: number;
}

export interface EventConfig {
  readonly id: number;
  readonly name: string;
  readonly discipline: Discipline;
  readonly numRounds: number;
  readonly pointsWin: number;
  readonly pointsTie: number;
  readonly currentRound: number;
  readonly advancePerPoule: number;
  readonly wildcards: number;
}

export interface Poule {
  readonly id: number;
  readonly name: string;
  readonly tables: number;
}

export interface Team {
  readonly id: number;
  readonly number: number;
  readonly name: string;
  readonly player1: string;
  readonly player2: string;
  readonly pouleId: number;
}

export interface Match {
  readonly id: number;
  readonly pouleId: number;
  readonly round: number;
  readonly tableNo: number;
  /** null only while a knockout slot is still waiting for a winner. */
  readonly teamAId: number | null;
  /** null means a bye (teamA advances) or an unfilled knockout slot. */
  readonly teamBId: number | null;
  readonly pointsA: number | null;
  readonly pointsB: number | null;
  readonly twentiesA: number;
  readonly twentiesB: number;
  readonly phase: MatchPhase;
  /** Knockout round label, e.g. 'Quarter-finals' or 'Bronze final'. */
  readonly bracket: string | null;
  readonly shootoutWinner: number | null;
  readonly sets: readonly SetScore[] | null;
  readonly status: MatchStatus;
}

/** A team's aggregate record over the poule matches that count. */
export interface StandingRow {
  readonly teamId: number;
  readonly played: number;
  readonly wins: number;
  readonly ties: number;
  readonly losses: number;
  readonly points: number;
  readonly twenties: number;
  readonly pointsFor: number;
  readonly pointsAgainst: number;
}

/** A standing joined to the team, as ranked within its poule. */
export interface RankedTeam extends StandingRow {
  readonly name: string;
  readonly number: number;
  readonly pouleId: number;
  readonly player1: string;
  readonly player2: string;
}

/** A qualifier for the finals, carrying the poule position it earned. */
export interface Qualifier extends RankedTeam {
  /** 1 = poule winner, 2 = runner-up (wildcard), and so on. */
  readonly pos: number;
}

/*
 * The season ranking is deliberately NOT part of this app. A tournament reports
 * finishing positions to the croki.nl ranking service (see ../croki-ranking),
 * which owns Field-Weighted Points and the season standings.
 */

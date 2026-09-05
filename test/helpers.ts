import type { Match, Team } from '../src/types/index.ts';

export function makeTeam(id: number, pouleId: number, teamNumber = id, name = `Team ${id}`): Team {
  return { id, number: teamNumber, name, player1: '', player2: '', pouleId };
}

/** A drawn, unplayed poule match; override only what the test cares about. */
export function makeMatch(over: Partial<Match> & { id: number }): Match {
  return {
    pouleId: 1,
    round: 1,
    tableNo: 1,
    teamAId: null,
    teamBId: null,
    pointsA: null,
    pointsB: null,
    twentiesA: 0,
    twentiesB: 0,
    phase: 'poule',
    bracket: null,
    shootoutWinner: null,
    sets: null,
    status: 'pending',
    ...over,
  };
}

/** A finished poule match between two teams. */
export function played(
  id: number,
  teamAId: number,
  teamBId: number,
  pointsA: number,
  pointsB: number,
  twentiesA = 0,
  twentiesB = 0,
): Match {
  return makeMatch({
    id,
    teamAId,
    teamBId,
    pointsA,
    pointsB,
    twentiesA,
    twentiesB,
    status: 'entered',
  });
}

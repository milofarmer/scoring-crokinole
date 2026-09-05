/**
 * Poule draw. Round 1 is random; later rounds are Swiss — pair down the current
 * standings, avoiding a repeat of an earlier meeting where possible.
 */

export type Pairing = readonly [number, number | null];

/** Who each team has already faced, from the rounds before `beforeRound`. */
export function previousOpponents(
  matches: readonly { round: number; teamAId: number | null; teamBId: number | null }[],
  beforeRound: number,
): Map<number, Set<number>> {
  const seen = new Map<number, Set<number>>();
  const remember = (a: number, b: number): void => {
    const set = seen.get(a) ?? new Set<number>();
    set.add(b);
    seen.set(a, set);
  };
  for (const match of matches) {
    if (match.round >= beforeRound) continue;
    const { teamAId, teamBId } = match;
    if (teamAId === null || teamBId === null) continue;
    remember(teamAId, teamBId);
    remember(teamBId, teamAId);
  }
  return seen;
}

/**
 * Pair an ordered list of teams, skipping opponents they have already played.
 * Falls back to the nearest available opponent when every candidate is a repeat,
 * so a draw is always produced. An odd list leaves the last team a bye.
 */
export function pairTeams(
  ordered: readonly number[],
  played: Map<number, Set<number>>,
): Pairing[] {
  const pool = [...ordered];
  const pairs: Pairing[] = [];

  while (pool.length > 0) {
    const first = pool.shift();
    if (first === undefined) break;
    if (pool.length === 0) {
      pairs.push([first, null]);
      break;
    }
    const alreadyPlayed = played.get(first) ?? new Set<number>();
    let index = pool.findIndex((candidate) => !alreadyPlayed.has(candidate));
    if (index === -1) index = 0;
    const opponent = pool[index];
    pool.splice(index, 1);
    pairs.push([first, opponent ?? null]);
  }
  return pairs;
}

/** Fisher-Yates, with an injectable random source so tests are deterministic. */
export function shuffled<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = out[i];
    const b = out[j];
    if (a !== undefined && b !== undefined) {
      out[i] = b;
      out[j] = a;
    }
  }
  return out;
}

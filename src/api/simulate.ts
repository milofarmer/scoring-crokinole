/**
 * Fill a tournament with plausible play, for trying things out.
 *
 * Wired to a button in the organiser screen because the things worth checking
 * before an event are hard to check on an empty database: does the board read
 * from the back of the hall, does the bracket look right, does a scoring machine
 * see what it expects. Typing in a day's results to find out is not reasonable.
 *
 * It writes through the same store the real tournament uses, so what comes out
 * behaves exactly like a real one rather than being a special case that only
 * looks right.
 */
import type { ApiContext } from './context.ts';
import type { StoredEvent } from '../services/tournament-store.ts';
import { makeCode } from '../services/tournament-store.ts';
import { drawKnockout, drawRound } from './draw.ts';
import { applyScore } from './score.ts';
import type { SetScore } from '../types/index.ts';

const TEAM_NAMES: readonly string[] = [
  'De Gladde Schijven', 'Vingervlug', 'Baan Brekers', 'Twintig Vol', 'De Zwaartekracht',
  'Noord-Zuid', 'De Flipperkast', 'Baanvegers', 'De Diagonaal', 'Dubbel en Dwars',
  'Spin en Sink', 'De Boemerang', 'Stip Stapels', 'Zachte Toets', 'De Onderkant',
  'Ring Rakkers', 'De Schietende Sterren', 'De Uitschieters', 'De Vlakke Baan',
  'Centrum Zoekers', 'De Duimspelers', 'Hoekwerk', 'Krijt op de Baan', 'De Middenstip',
  'Schijf en Zo', 'De Kalme Hand', 'Botsende Buren', 'De Laatste Schijf', 'Randgevallen',
  'De Tegenligger', 'Vaste Hand', 'De Achtervolgers', 'Rond en Raak', 'De Stuiteraars',
  'Houten Hart', 'De Peuteraars', 'Glad Ijs', 'De Nachtschijf', 'Tafeldansers',
  'De Rustige Duim', 'Schuifelaars', 'De Twintigers', 'Baanbrekend', 'De Sluipschutters',
];

const FIRST: readonly string[] = ['Anne', 'Bram', 'Cees', 'Daan', 'Eva', 'Femke', 'Gijs',
  'Hanna', 'Ies', 'Joost', 'Kees', 'Lotte', 'Maarten', 'Nienke', 'Otto', 'Pien', 'Roos',
  'Sander', 'Tessa', 'Willem'];
const LAST: readonly string[] = ['de Vries', 'Jansen', 'Bakker', 'Visser', 'Smit', 'Meijer',
  'Mulder', 'de Boer', 'Bos', 'Vos', 'Peters', 'Hendriks', 'van Dijk', 'Kok', 'Willems'];

function pick(list: readonly string[], index: number): string {
  return list[index % list.length] ?? '';
}

/** Poules as even as they can be, aiming at four. */
function planSizes(entrants: number, target: number): number[] {
  const count = Math.max(1, Math.round(entrants / target));
  const base = Math.floor(entrants / count);
  const extra = entrants % count;
  return Array.from({ length: count }, (_unused, i) => base + (i < extra ? 1 : 0));
}

function pouleLetter(index: number): string {
  let name = '';
  for (let n = index; ; n = Math.floor(n / 26) - 1) {
    name = String.fromCharCode(65 + (n % 26)) + name;
    if (n < 26) break;
  }
  return name;
}

/**
 * A set that looks like crokinole rather than like random numbers: one side
 * usually edges it, occasionally it is level, and the odd set runs away.
 */
function makeSet(strengthA: number, strengthB: number, random: () => number): SetScore {
  const runaway = random() < 0.1;
  const swing = (random() * 30 - 15) + (strengthA - strengthB) * 18;
  const base = 20 + Math.floor(random() * 22);
  const pa = Math.max(0, Math.round(base + swing + (runaway && random() < 0.5 ? 40 : 0)));
  const pb = Math.max(0, Math.round(base - swing + (runaway && random() >= 0.5 ? 40 : 0)));
  return {
    pa,
    pb: random() < 0.07 ? pa : pb,   // level sets happen, and the rules must handle them
    ta: random() < 0.35 ? 1 + Math.floor(random() * 2) : 0,
    tb: random() < 0.35 ? 1 + Math.floor(random() * 2) : 0,
  };
}

export interface SimulateOptions {
  readonly name: string;
  readonly entrants: number;
  readonly discipline: 'singles' | 'doubles';
  /** How many poule rounds to play out. The rest are drawn but left empty. */
  readonly roundsPlayed: number;
  /** Play the knockout out as well, so the bracket has something in it. */
  readonly knockout: boolean;
  readonly adminPin: string;
  readonly playCode: string;
  readonly random?: () => number;
}

export interface SimulateResult {
  readonly eventId: number;
  readonly teams: number;
  readonly poules: number;
  readonly rounds: number;
  readonly matchesScored: number;
  readonly knockoutDrawn: boolean;
}

/** Build a whole tournament and play it. Replaces whatever was there. */
export function simulateTournament(context: ApiContext, options: SimulateOptions): SimulateResult {
  const random = options.random ?? Math.random;
  const entrants = Math.max(2, Math.min(options.entrants, TEAM_NAMES.length));
  const sizes = planSizes(entrants, 4);
  const biggest = Math.max(...sizes);
  const rounds = Math.max(1, biggest - 1);

  const existing = context.store.activeEvent();
  if (existing !== null) context.store.deleteEvent(existing.id);

  const eventId = context.store.createEvent({
    name: options.name,
    adminPin: options.adminPin,
    playCode: options.playCode,
    discipline: options.discipline,
    numRounds: rounds,
  });

  context.store.setPoules(eventId, sizes.map((size, i) => ({
    name: pouleLetter(i),
    tables: Math.ceil(size / 2),
  })));
  const poules = context.store.poules(eventId);

  const taken = new Set<string>();
  for (let i = 0; i < entrants; i += 1) {
    let code = makeCode(4);
    while (taken.has(code)) code = makeCode(4);
    taken.add(code);
    const poule = poules[i % poules.length];
    context.store.addTeam({
      eventId,
      name: pick(TEAM_NAMES, i),
      player1: `${pick(FIRST, i)} ${pick(LAST, i)}`,
      player2: options.discipline === 'doubles' ? `${pick(FIRST, i + 7)} ${pick(LAST, i + 3)}` : '',
      pouleId: poule?.id ?? 0,
      number: context.store.nextTeamNumber(eventId),
      loginCode: code,
    });
  }

  // A fixed strength per team, so the table sorts into something believable
  // instead of everyone finishing level.
  const strength = new Map<number, number>();
  for (const team of context.store.teams(eventId)) strength.set(team.id, random());

  const event = (): StoredEvent => {
    const found = context.store.activeEvent();
    if (found === null) throw new Error('the tournament vanished mid-simulation');
    return found;
  };

  let scored = 0;
  const playRound = (round: number): void => {
    for (const match of context.store.matches(eventId, round)) {
      if (match.teamBId === null) continue;         // a bye needs no score
      const a = strength.get(match.teamAId ?? 0) ?? 0.5;
      const b = strength.get(match.teamBId) ?? 0.5;
      applyScore(context, event(), match, {
        sets: [makeSet(a, b, random), makeSet(a, b, random), makeSet(a, b, random), makeSet(a, b, random)],
        complete: true,
        enteredBy: 'simulated',
        shootoutWinner: random() < 0.5 ? match.teamAId : match.teamBId,
      });
      scored += 1;
    }
  };

  for (let round = 1; round <= rounds; round += 1) {
    const drawn = drawRound(context, event(), round, true);
    if (!drawn.ok) break;
    context.store.updateEvent(eventId, { currentRound: round, status: 'running' });
    if (round <= options.roundsPlayed) playRound(round);
  }

  let knockoutDrawn = false;
  if (options.knockout && options.roundsPlayed >= rounds) {
    const drawn = drawKnockout(context, event(), { bronze: true });
    if (drawn.ok) {
      knockoutDrawn = true;
      context.store.updateEvent(eventId, { currentRound: drawn.value.round, status: 'running' });
      // Play the bracket down to the final so it has something in it.
      const koRounds = [...new Set(
        context.store.matches(eventId).filter((m) => m.phase === 'ko').map((m) => m.round),
      )].sort((x, y) => x - y);
      for (const round of koRounds.slice(0, -1)) {
        playRound(round);
        context.store.updateEvent(eventId, { currentRound: round + 1 });
      }
    }
  }

  return {
    eventId,
    teams: entrants,
    poules: poules.length,
    rounds,
    matchesScored: scored,
    knockoutDrawn,
  };
}

/**
 * Fill a tournament with realistic test data, over the same API a phone uses.
 *
 *   node tools/seed.ts [baseUrl] [--rounds=N] [--played=N] [--fresh]
 *
 *   baseUrl    default http://localhost:8085
 *   --rounds   how many rounds to draw                  (default 4)
 *   --played   how many of those to score completely    (default 3, so the
 *              last round is left half-played, which is the interesting case)
 *   --fresh    clear any existing tournament first
 *
 * Useful for seeing the board with something on it, and for checking that a
 * change still behaves with a field of 44 teams rather than the four in a test.
 */
const TEAM_NAMES = [
  'De Gladde Schijven', 'Vingervlug', 'Baan Brekers', 'Twintig Vol', 'De Zwaartekracht',
  'Noord-Zuid', 'De Flipperkast', 'Baanvegers', 'De Diagonaal', 'Dubbel & Dwars',
  'Spin & Sink', 'De Boemerang', 'Stip Stapels', 'Zachte Toets', 'De Onderkant',
  'Ring Rakkers', 'De Schietende Sterren', 'De Uitschieters', 'De Vlakke Baan',
  'Centrum Zoekers', 'De Duimspelers', 'Hoekwerk', 'Krijt op de Baan', 'De Middenstip',
  'Schijf & Zo', 'De Kalme Hand', 'Botsende Buren', 'De Laatste Schijf', 'Randgevallen',
  'De Tegenligger', 'Vaste Hand', 'De Achtervolgers', 'Rond & Raak', 'De Stuiteraars',
  'Houten Hart', 'De Peuteraars', 'Glad Ijs', 'De Nachtschijf', 'Tafeldansers',
  'De Rustige Duim', 'Schuifelaars', 'De Twintigers', 'Baanbrekend', 'De Sluipschutters',
];

const FIRST = ['Anne', 'Bram', 'Cees', 'Daan', 'Eva', 'Femke', 'Gijs', 'Hanna', 'Ies', 'Joost',
  'Kees', 'Lotte', 'Maarten', 'Nienke', 'Otto', 'Pien', 'Quirijn', 'Roos', 'Sander', 'Tessa'];
const LAST = ['de Vries', 'Jansen', 'Bakker', 'Visser', 'Smit', 'Meijer', 'Mulder', 'de Boer',
  'Bos', 'Vos', 'Peters', 'Hendriks', 'van Dijk', 'Kok', 'Willems'];

interface Options {
  readonly base: string;
  readonly rounds: number;
  readonly played: number;
  readonly fresh: boolean;
}

function readOptions(argv: readonly string[]): Options {
  let base = 'http://localhost:8085';
  let rounds = 4;
  let played = 3;
  let fresh = false;

  for (const argument of argv) {
    if (argument === '--fresh') fresh = true;
    else if (argument.startsWith('--rounds=')) rounds = Number(argument.slice(9)) || rounds;
    else if (argument.startsWith('--played=')) played = Number(argument.slice(9)) || played;
    else if (!argument.startsWith('-')) base = argument.replace(/\/+$/, '');
  }
  return { base, rounds, played: Math.min(played, rounds), fresh };
}

const PIN = '1234';
const PLAY_CODE = 'NK2026';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function call(base: string, action: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(`${base}/api/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const parsed: unknown = await response.json();
  if (!isRecord(parsed)) throw new Error(`${action} did not answer with an object`);
  if (parsed.ok !== true) throw new Error(`${action} failed: ${String(parsed.error ?? 'unknown')}`);
  return parsed;
}

function pick<T>(items: readonly T[], index: number): T {
  const item = items[index % items.length];
  if (item === undefined) throw new Error('empty list');
  return item;
}

/** A plausible set: one side usually wins, occasionally it is level. */
function makeSet(strengthA: number, strengthB: number): Record<string, number> {
  const swing = Math.random() * 30 - 15;
  const base = 20 + Math.floor(Math.random() * 25);
  const a = Math.max(0, Math.round(base + swing + strengthA * 6));
  const b = Math.max(0, Math.round(base - swing + strengthB * 6));
  return {
    pa: a,
    pb: Math.random() < 0.08 ? a : b,     // sometimes level, which the rules have to handle
    ta: Math.random() < 0.35 ? 1 + Math.floor(Math.random() * 2) : 0,
    tb: Math.random() < 0.35 ? 1 + Math.floor(Math.random() * 2) : 0,
  };
}

async function main(): Promise<void> {
  const options = readOptions(process.argv.slice(2));
  process.stdout.write(`Seeding ${options.base}\n`);

  if (options.fresh) {
    try {
      await call(options.base, 'reset_event', { admin_pin: PIN });
      process.stdout.write('  cleared the previous tournament\n');
    } catch {
      // Nothing to clear, which is fine on a first run.
    }
  }

  await call(options.base, 'create_event', {
    name: 'NK Crokinole',
    admin_pin: PIN,
    play_code: PLAY_CODE,
    num_rounds: options.rounds,
    discipline: 'doubles',
  });
  process.stdout.write('  created the tournament\n');

  const pouleCount = 11;
  await call(options.base, 'set_poules', {
    admin_pin: PIN,
    poules: Array.from({ length: pouleCount }, (_unused, index) => ({
      name: String.fromCharCode(65 + index),
      tables: 2,
    })),
  });

  const state = await call(options.base, 'state', {});
  const poules = Array.isArray(state.poules) ? state.poules : [];

  await call(options.base, 'bulk_add_teams', {
    admin_pin: PIN,
    teams: TEAM_NAMES.map((name, index) => ({
      name,
      player1: `${pick(FIRST, index)} ${pick(LAST, index)}`,
      player2: `${pick(FIRST, index + 7)} ${pick(LAST, index + 3)}`,
    })),
  });
  process.stdout.write(`  added ${TEAM_NAMES.length} teams\n`);

  // Spread the teams evenly, so every poule has four.
  const admin = await call(options.base, 'admin_state', { admin_pin: PIN });
  const teams = Array.isArray(admin.teams) ? admin.teams : [];
  let index = 0;
  for (const team of teams) {
    if (!isRecord(team)) continue;
    const poule = poules[index % poules.length];
    if (isRecord(poule)) {
      await call(options.base, 'update_team', { admin_pin: PIN, team_id: team.id, poule_id: poule.id });
    }
    index += 1;
  }
  process.stdout.write(`  spread them across ${poules.length} poules\n`);

  for (let round = 1; round <= options.rounds; round += 1) {
    await call(options.base, 'generate_round', { admin_pin: PIN, round, force: true });

    if (round > options.played) {
      process.stdout.write(`  round ${round}: drawn, left unplayed\n`);
      continue;
    }

    const now = await call(options.base, 'state', {});
    const matches = Array.isArray(now.round_matches) ? now.round_matches : [];
    let scored = 0;
    for (const match of matches) {
      if (!isRecord(match) || !isRecord(match.team_b)) continue;   // a bye needs no score
      const strengthA = Math.random();
      const strengthB = Math.random();
      await call(options.base, 'set_match', {
        admin_pin: PIN,
        match_id: match.id,
        sets: [makeSet(strengthA, strengthB), makeSet(strengthA, strengthB),
               makeSet(strengthA, strengthB), makeSet(strengthA, strengthB)],
        status: 'entered',
      });
      scored += 1;
    }
    process.stdout.write(`  round ${round}: drawn and ${scored} matches scored\n`);
  }

  process.stdout.write(`\nDone. Organiser PIN ${PIN}, play code ${PLAY_CODE}.\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

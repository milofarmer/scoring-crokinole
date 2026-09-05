/**
 * Recompute match points from the per-set breakdown.
 *
 *   node tools/recompute-points.ts [--apply] [--db path]
 *
 * Matches used to be scored on the total points a team put up across the four
 * sets. They are now scored per set: 2 to whoever wins a set, 1 each when it is
 * level, so a match is worth 8. Rows written under the old rule still hold the
 * old number, which lands in the standings as hundreds of points and makes the
 * table nonsense.
 *
 * The per-set breakdown was stored all along, so the correct figures can simply
 * be worked out again. Rows without a breakdown are left alone and reported:
 * there is nothing to recompute from, and guessing would be worse than saying so.
 *
 * Prints what it would change and writes nothing without --apply.
 */
import { openDatabase } from '../src/services/db.ts';
import { loadConfig } from '../src/config/index.ts';
import { asRow, num, numOrNull, strOrNull, toSets } from '../src/services/rows.ts';
import { POINTS_PER_SET_TIED, POINTS_PER_SET_WON, SETS_PER_MATCH } from '../src/core/scoring.ts';

function readArguments(argv: readonly string[]): { readonly apply: boolean; readonly databasePath: string | null } {
  let apply = false;
  let databasePath: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const argument = argv[i];
    if (argument === '--apply') apply = true;
    else if (argument === '--db') databasePath = argv[i + 1] ?? null;
  }
  return { apply, databasePath };
}

function main(): void {
  const options = readArguments(process.argv.slice(2));
  const path = options.databasePath ?? loadConfig().databasePath;
  process.stdout.write(`Database: ${path}\n\n`);

  const db = openDatabase(path);
  const rows = db.prepare('SELECT id, match_code, points_a, points_b, sets_json FROM crok_match ORDER BY id').all();
  const update = db.prepare('UPDATE crok_match SET points_a = ?, points_b = ? WHERE id = ?');

  let changed = 0;
  let same = 0;
  let noBreakdown = 0;

  for (const value of rows) {
    const row = asRow(value);
    const id = num(row.id, 'match.id');
    const sets = toSets(row.sets_json, 'match.sets_json');

    if (sets === null) {
      if (numOrNull(row.points_a, 'match.points_a') !== null) noBreakdown += 1;
      continue;
    }

    let pointsA = 0;
    let pointsB = 0;
    for (const set of sets.slice(0, SETS_PER_MATCH)) {
      if (set.pa === null || set.pb === null) continue;
      if (set.pa > set.pb) pointsA += POINTS_PER_SET_WON;
      else if (set.pb > set.pa) pointsB += POINTS_PER_SET_WON;
      else { pointsA += POINTS_PER_SET_TIED; pointsB += POINTS_PER_SET_TIED; }
    }

    const wasA = numOrNull(row.points_a, 'match.points_a') ?? 0;
    const wasB = numOrNull(row.points_b, 'match.points_b') ?? 0;
    if (wasA === pointsA && wasB === pointsB) {
      same += 1;
      continue;
    }

    changed += 1;
    const code = strOrNull(row.match_code, 'match.match_code') ?? `#${id}`;
    process.stdout.write(`  ${code.padEnd(6)}  ${String(wasA).padStart(3)}-${String(wasB).padEnd(3)}  ->  ${pointsA}-${pointsB}\n`);
    if (options.apply) update.run(pointsA, pointsB, id);
  }

  const verb = options.apply ? 'Updated' : 'Would update';
  process.stdout.write(`\n${verb} ${changed} match${changed === 1 ? '' : 'es'}.\n`);
  process.stdout.write(`Already correct: ${same}\n`);
  if (noBreakdown > 0) {
    process.stdout.write(`Scored without a per-set breakdown, left untouched: ${noBreakdown}\n`);
    process.stdout.write('  Those were entered as bare totals. Re-enter them, or correct them in the organiser screen.\n');
  }
  if (!options.apply && changed > 0) process.stdout.write('\nNothing was written. Run again with --apply to save.\n');
}

main();

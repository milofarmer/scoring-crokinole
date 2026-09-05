<?php
/**
 * Recompute match points from the per-set breakdown.
 *
 *   php tools/recompute-points.php [--apply]
 *
 * Matches used to be scored on the total points a team put up across the four
 * sets. They are now scored per set: 2 to whoever wins a set, 1 each when it is
 * level, so a match is worth 8. Rows written under the old rule still hold the
 * old number in points_a/points_b, which lands in the standings as hundreds of
 * points and makes the table nonsense.
 *
 * The per-set breakdown was stored all along, so the correct figures can simply
 * be worked out again. Rows without a breakdown are left alone and reported:
 * there is nothing to recompute from and guessing would be worse than saying so.
 *
 * Prints what it would change and touches nothing unless you pass --apply.
 */

define('CROK', 1);
require __DIR__ . '/../src/store.php';
require __DIR__ . '/../src/logic.php';

$apply = in_array('--apply', $argv, true);
$db = crok_pdo();

$rows = $db->query("SELECT id, match_code, points_a, points_b, sets_json FROM crok_match ORDER BY id")->fetchAll();

$changed = 0; $same = 0; $noBreakdown = 0;
$update = $db->prepare("UPDATE crok_match SET points_a=?, points_b=? WHERE id=?");

foreach ($rows as $r) {
    $raw = $r['sets_json'] ?? '';
    if ($raw === '' || $raw === null) {
        if ($r['points_a'] !== null || $r['points_b'] !== null) $noBreakdown++;
        continue;
    }
    $sets = json_decode($raw, true);
    if (!is_array($sets)) { $noBreakdown++; continue; }

    $pa = 0; $pb = 0;
    foreach (array_slice($sets, 0, CROK_SETS_PER_MATCH) as $s) {
        $a = $s['pa'] ?? null; $b = $s['pb'] ?? null;
        if ($a === null || $b === null || $a === '' || $b === '') continue;
        if ((int)$a > (int)$b)      { $pa += CROK_SET_WIN; }
        elseif ((int)$b > (int)$a)  { $pb += CROK_SET_WIN; }
        else { $pa += CROK_SET_TIE; $pb += CROK_SET_TIE; }
    }

    $wasA = (int)$r['points_a']; $wasB = (int)$r['points_b'];
    if ($wasA === $pa && $wasB === $pb) { $same++; continue; }

    $changed++;
    printf("  %-6s  %3d-%-3d  ->  %d-%d\n", $r['match_code'] ?: ('#' . $r['id']), $wasA, $wasB, $pa, $pb);
    if ($apply) $update->execute([$pa, $pb, (int)$r['id']]);
}

echo "\n";
echo ($apply ? "Updated " : "Would update ") . $changed . " match" . ($changed === 1 ? '' : 'es') . ".\n";
echo "Already correct: $same\n";
if ($noBreakdown > 0) {
    echo "Scored without a per-set breakdown, left untouched: $noBreakdown\n";
    echo "  Those were entered as bare totals. Re-enter them, or correct them in the organiser screen.\n";
}
if (!$apply && $changed > 0) echo "\nNothing was written. Run again with --apply to save.\n";

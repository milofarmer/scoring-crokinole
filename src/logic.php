<?php
/**
 * Crokinole tournament — domain logic: event access, standings, Swiss draw.
 * Include only.
 */

if (!defined('CROK')) { http_response_code(403); exit('forbidden'); }

require_once __DIR__ . '/store.php';

function crok_json($data, int $code = 200): void {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function crok_fail(string $msg, int $code = 400): void {
    crok_json(['ok' => false, 'error' => $msg], $code);
}

/** The event the public pages operate on: a running one if present, else the newest. */
function crok_active_event(PDO $db): ?array {
    $row = $db->query("SELECT * FROM crok_event WHERE status='running' ORDER BY id DESC LIMIT 1")->fetch();
    if ($row) return $row;
    return $db->query("SELECT * FROM crok_event ORDER BY id DESC LIMIT 1")->fetch() ?: null;
}

function crok_event_by_id(PDO $db, int $id): ?array {
    $st = $db->prepare("SELECT * FROM crok_event WHERE id=?");
    $st->execute([$id]);
    return $st->fetch() ?: null;
}

function crok_poules(PDO $db, int $eventId): array {
    $st = $db->prepare("SELECT * FROM crok_poule WHERE event_id=? ORDER BY sort, id");
    $st->execute([$eventId]);
    return $st->fetchAll();
}

function crok_teams(PDO $db, int $eventId): array {
    $st = $db->prepare("SELECT * FROM crok_team WHERE event_id=? ORDER BY number, id");
    $st->execute([$eventId]);
    return $st->fetchAll();
}

function crok_matches(PDO $db, int $eventId, ?int $round = null): array {
    if ($round === null) {
        $st = $db->prepare("SELECT * FROM crok_match WHERE event_id=? ORDER BY round, poule_id, table_no");
        $st->execute([$eventId]);
    } else {
        $st = $db->prepare("SELECT * FROM crok_match WHERE event_id=? AND round=? ORDER BY poule_id, table_no");
        $st->execute([$eventId, $round]);
    }
    return $st->fetchAll();
}

/** Short, unambiguous, unique-within-event match code (shown on the big board). */
function crok_gen_match_code(PDO $db, int $eventId): string {
    $alpha = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I,L,O,0,1
    $chk = $db->prepare("SELECT 1 FROM crok_match WHERE event_id=? AND match_code=?");
    for ($try = 0; $try < 60; $try++) {
        $c = '';
        for ($i = 0; $i < 4; $i++) $c .= $alpha[random_int(0, strlen($alpha) - 1)];
        $chk->execute([$eventId, $c]);
        if (!$chk->fetch()) return $c;
    }
    return substr(strtoupper(bin2hex(random_bytes(3))), 0, 5);
}

/** Give every match in the event a match_code if it lacks one (backfills older rows). */
function crok_ensure_match_codes(PDO $db, int $eventId): void {
    $st = $db->prepare("SELECT id FROM crok_match WHERE event_id=? AND (match_code IS NULL OR match_code='')");
    $st->execute([$eventId]);
    $rows = $st->fetchAll();
    if (!$rows) return;
    $up = $db->prepare("UPDATE crok_match SET match_code=? WHERE id=?");
    foreach ($rows as $r) $up->execute([crok_gen_match_code($db, $eventId), (int)$r['id']]);
}

/** A match counts toward standings when it is complete (all 4 sets in) or a bye.
 *  Status 'progress' = partial auto-save, not yet counted. */
function crok_match_scored(array $m): bool {
    if ($m['team_b_id'] === null || (int)$m['team_b_id'] === 0) return true; // bye
    $s = $m['status'] ?? '';
    if ($s === 'entered' || $s === 'confirmed') return true;
    if ($s === 'progress') return false;
    return $m['points_a'] !== null && $m['points_b'] !== null; // legacy rows
}

/**
 * Compute standings for every team in an event.
 * Returns team_id => [played, wins, ties, losses, points, twenties, diff, for, against].
 */
function crok_standings(PDO $db, array $event): array {
    $teams = crok_teams($db, (int)$event['id']);
    $agg = [];
    foreach ($teams as $t) {
        $agg[(int)$t['id']] = [
            'team_id' => (int)$t['id'],
            'played' => 0, 'wins' => 0, 'ties' => 0, 'losses' => 0,
            'points' => 0, 'twenties' => 0, 'for' => 0, 'against' => 0, 'diff' => 0,
        ];
    }
    $pw = (int)$event['points_win'];
    $pt = (int)$event['points_tie'];

    foreach (crok_matches($db, (int)$event['id']) as $m) {
        if (($m['phase'] ?? 'poule') !== 'poule') continue; // knockout doesn't affect poule standings
        if (!crok_match_scored($m)) continue;
        $a = (int)$m['team_a_id'];
        $bRaw = $m['team_b_id'];
        $isBye = ($bRaw === null || (int)$bRaw === 0);

        if ($isBye) {
            if (isset($agg[$a])) { $agg[$a]['played']++; $agg[$a]['wins']++; $agg[$a]['points'] += $pw; }
            continue;
        }
        $b  = (int)$bRaw;
        $pa = (int)$m['points_a']; $pb = (int)$m['points_b'];
        $ta = (int)$m['twenties_a']; $tb = (int)$m['twenties_b'];

        foreach ([[$a,$pa,$pb,$ta],[$b,$pb,$pa,$tb]] as [$id,$pf,$pag,$tw]) {
            if (!isset($agg[$id])) continue;
            $agg[$id]['played']++;
            $agg[$id]['for'] += $pf;
            $agg[$id]['against'] += $pag;
            $agg[$id]['twenties'] += $tw;
            if ($pf > $pag)      { $agg[$id]['wins']++;   $agg[$id]['points'] += $pw; }
            elseif ($pf === $pag){ $agg[$id]['ties']++;   $agg[$id]['points'] += $pt; }
            else                 { $agg[$id]['losses']++; }
        }
    }
    foreach ($agg as &$r) $r['diff'] = $r['for'] - $r['against'];
    unset($r);
    return $agg;
}

/** Head-to-head match points earned among a set of tied teams. */
function crok_h2h_points(array $group, array $matches, int $pw, int $pt): array {
    $ids = array_column($group, 'team_id');
    $inGroup = array_flip($ids);
    $pts = array_fill_keys($ids, 0);
    foreach ($matches as $m) {
        $a = (int)$m['team_a_id']; $b = (int)($m['team_b_id'] ?? 0);
        if (!$b || !isset($inGroup[$a]) || !isset($inGroup[$b])) continue;
        $pa = (int)$m['points_a']; $pb = (int)$m['points_b'];
        if ($pa > $pb)      $pts[$a] += $pw;
        elseif ($pa < $pb)  $pts[$b] += $pw;
        else { $pts[$a] += $pt; $pts[$b] += $pt; }
    }
    return $pts;
}

/**
 * Ranked team rows for a poule.
 * Order: match points → 20's → head-to-head (onderling resultaat) → team number.
 */
function crok_ranked(PDO $db, array $event, ?int $pouleId = null): array {
    $standings = crok_standings($db, $event);
    $teams = crok_teams($db, (int)$event['id']);
    $rows = [];
    foreach ($teams as $t) {
        if ($pouleId !== null && (int)$t['poule_id'] !== $pouleId) continue;
        $s = $standings[(int)$t['id']];
        $rows[] = $s + ['name' => $t['name'], 'player1' => $t['player1'], 'player2' => $t['player2'], 'number' => (int)$t['number'], 'poule_id' => (int)$t['poule_id']];
    }
    // Primary sort: points, then 20's (both descending).
    usort($rows, fn($x, $y) => [$y['points'], $y['twenties']] <=> [$x['points'], $x['twenties']]);

    // Break remaining ties by head-to-head within each equal group, then number.
    $matches = array_filter(crok_matches($db, (int)$event['id']), 'crok_match_scored');
    $pw = (int)$event['points_win']; $pt = (int)$event['points_tie'];
    $out = []; $i = 0; $n = count($rows);
    while ($i < $n) {
        $j = $i + 1;
        while ($j < $n && $rows[$j]['points'] === $rows[$i]['points'] && $rows[$j]['twenties'] === $rows[$i]['twenties']) $j++;
        $group = array_slice($rows, $i, $j - $i);
        if (count($group) > 1) {
            $h2h = crok_h2h_points($group, $matches, $pw, $pt);
            usort($group, function ($x, $y) use ($h2h) {
                if ($h2h[$y['team_id']] !== $h2h[$x['team_id']]) return $h2h[$y['team_id']] <=> $h2h[$x['team_id']];
                return $x['number'] <=> $y['number'];
            });
        }
        foreach ($group as $g) $out[] = $g;
        $i = $j;
    }
    return $out;
}

/** Opponents a team has already faced, from earlier rounds. */
function crok_prev_opponents(PDO $db, int $eventId, int $beforeRound): array {
    $map = [];
    $st = $db->prepare("SELECT team_a_id, team_b_id FROM crok_match WHERE event_id=? AND round < ?");
    $st->execute([$eventId, $beforeRound]);
    foreach ($st->fetchAll() as $m) {
        $a = (int)$m['team_a_id']; $b = (int)$m['team_b_id'];
        if ($b) { $map[$a][$b] = true; $map[$b][$a] = true; }
    }
    return $map;
}

/* ===================== Knockout (loting) stage ======================== */

/** Winner team-id of a match, or null if undecided. Handles byes and KO shoot-outs. */
function crok_match_winner(array $m): ?int {
    $a = (int)$m['team_a_id']; $b = (int)($m['team_b_id'] ?? 0);
    if (!$b) return $a ?: null;                       // bye
    if ($m['points_a'] === null || $m['points_b'] === null) return null;
    $pa = (int)$m['points_a']; $pb = (int)$m['points_b'];
    if ($pa > $pb) return $a;
    if ($pb > $pa) return $b;
    return $m['shootout_winner'] ? (int)$m['shootout_winner'] : null; // tie → shoot-out
}

/** Label a KO round by how many matches it has (16→R16, 8→'Quarter-finals', …). */
function crok_ko_label(int $matches): string {
    switch ($matches) {
        case 1:  return 'Final';
        case 2:  return 'Semi-finals';
        case 4:  return 'Quarter-finals';
        case 8:  return 'Round of 16';
        case 16: return 'Round of 32';
        default: return 'Round of ' . ($matches * 2);
    }
}

/** Standard bracket seed slot order for a power-of-two size (1-based seeds). */
function crok_bracket_order(int $n): array {
    $order = [1, 2];
    while (count($order) < $n) {
        $r = count($order) * 2 + 1;
        $next = [];
        foreach ($order as $s) { $next[] = $s; $next[] = $r - $s; }
        $order = $next;
    }
    return $order;
}

/** Ordered qualifiers: rank 1 of every poule, then rank 2 of every poule, … (cross-seed). */
function crok_qualifiers(PDO $db, array $event, int $perPoule): array {
    $poules = crok_poules($db, (int)$event['id']);
    $ranked = [];
    foreach ($poules as $p) $ranked[] = array_slice(crok_ranked($db, $event, (int)$p['id']), 0, $perPoule);
    $seeds = [];
    for ($i = 0; $i < $perPoule; $i++) {
        foreach ($ranked as $r) if (isset($r[$i])) $seeds[] = $r[$i];
    }
    return $seeds; // seed 1 = best of first poule, seed 2 = best of second poule, …
}

/**
 * Build the first knockout round from the poule standings.
 * $perPoule teams per poule are cross-seeded into a power-of-two bracket (byes if needed).
 */
function crok_generate_ko(PDO $db, array $event, int $perPoule, bool $force = false): array {
    $eventId = (int)$event['id'];
    $koRound = (int)$event['num_rounds'] + 1;

    $st = $db->prepare("SELECT COUNT(*) c FROM crok_match WHERE event_id=? AND phase='ko'");
    $st->execute([$eventId]);
    if ((int)$st->fetch()['c'] > 0) {
        if (!$force) throw new RuntimeException('Knockout already generated (use force to rebuild).');
        $db->prepare("DELETE FROM crok_match WHERE event_id=? AND phase='ko'")->execute([$eventId]);
    }

    $seeds = crok_qualifiers($db, $event, $perPoule);
    if (count($seeds) < 2) throw new RuntimeException('Not enough qualified teams.');
    $M = 1; while ($M < count($seeds)) $M *= 2;         // next power of two
    $order = crok_bracket_order($M);                    // slot order of seed numbers

    $ins = $db->prepare("INSERT INTO crok_match (event_id, poule_id, round, table_no, team_a_id, team_b_id, phase, bracket, status)
                         VALUES (?,0,?,?,?,?, 'ko', ?, 'pending')");
    $label = crok_ko_label($M / 2);
    $created = 0; $table = 1;
    for ($i = 0; $i < $M; $i += 2) {
        $sa = $order[$i] - 1; $sb = $order[$i + 1] - 1;   // seed indices (0-based)
        $ta = $seeds[$sa]['team_id'] ?? null;
        $tb = $seeds[$sb]['team_id'] ?? null;
        // If a slot is empty it's a bye; keep the real team as A.
        if ($ta === null && $tb !== null) { $ta = $tb; $tb = null; }
        if ($ta === null && $tb === null) continue;
        $ins->execute([$eventId, $koRound, $table++, $ta, $tb, $label]);
        $created++;
    }
    return ['created' => $created, 'round' => $koRound, 'label' => $label, 'bracket_size' => $M];
}

/** Pair the winners of the latest completed KO round into the next round. */
function crok_generate_next_ko(PDO $db, array $event): array {
    $eventId = (int)$event['id'];
    $st = $db->query("SELECT MAX(round) m FROM crok_match WHERE event_id=" . (int)$eventId . " AND phase='ko'");
    $last = (int)($st->fetch()['m'] ?? 0);
    if (!$last) throw new RuntimeException('No knockout bracket yet.');

    $cur = crok_matches($db, $eventId, $last);
    if (count($cur) <= 1) throw new RuntimeException('The final is already set.');
    $winners = [];
    foreach ($cur as $m) {
        $w = crok_match_winner($m);
        if ($w === null) throw new RuntimeException('Finish all matches in the current round first.');
        $winners[] = $w;
    }
    $nextRound = $last + 1;
    $chk = $db->prepare("SELECT COUNT(*) c FROM crok_match WHERE event_id=? AND round=?");
    $chk->execute([$eventId, $nextRound]);
    if ((int)$chk->fetch()['c'] > 0) throw new RuntimeException('Next round already exists.');

    $label = crok_ko_label(count($winners) / 2);
    $ins = $db->prepare("INSERT INTO crok_match (event_id, poule_id, round, table_no, team_a_id, team_b_id, phase, bracket, status)
                         VALUES (?,0,?,?,?,?, 'ko', ?, 'pending')");
    $t = 1;
    for ($i = 0; $i < count($winners); $i += 2) {
        $ins->execute([$eventId, $nextRound, $t++, $winners[$i], $winners[$i + 1] ?? null, $label]);
    }
    return ['created' => (int)(count($winners) / 2), 'round' => $nextRound, 'label' => $label];
}

/**
 * Generate (or regenerate) the draw for one round.
 * Round 1 is random; later rounds are Swiss (rank order, rematches avoided).
 * $force wipes any existing matches for the round first.
 */
function crok_generate_round(PDO $db, array $event, int $round, bool $force = false): array {
    $eventId = (int)$event['id'];

    $st = $db->prepare("SELECT COUNT(*) c FROM crok_match WHERE event_id=? AND round=?");
    $st->execute([$eventId, $round]);
    if ((int)$st->fetch()['c'] > 0) {
        if (!$force) throw new RuntimeException('Round already drawn (use force to redraw).');
        $del = $db->prepare("DELETE FROM crok_match WHERE event_id=? AND round=?");
        $del->execute([$eventId, $round]);
    }

    $prev = crok_prev_opponents($db, $eventId, $round);
    $ins = $db->prepare("INSERT INTO crok_match (event_id, poule_id, round, table_no, team_a_id, team_b_id, status)
                         VALUES (?,?,?,?,?,?, 'pending')");

    $created = 0;
    foreach (crok_poules($db, $eventId) as $poule) {
        $pid = (int)$poule['id'];

        if ($round <= 1) {
            $order = crok_teams($db, $eventId);
            $order = array_values(array_filter($order, fn($t) => (int)$t['poule_id'] === $pid));
            shuffle($order);
            $ids = array_map(fn($t) => (int)$t['id'], $order);
        } else {
            $ranked = crok_ranked($db, $event, $pid);
            $ids = array_map(fn($r) => $r['team_id'], $ranked);
        }

        // Greedy pairing avoiding rematches.
        $pool = $ids;
        $pairs = [];
        while (count($pool) > 0) {
            $a = array_shift($pool);
            if (count($pool) === 0) { $pairs[] = [$a, null]; break; } // bye
            $idx = 0;
            for ($j = 0; $j < count($pool); $j++) {
                if (empty($prev[$a][$pool[$j]])) { $idx = $j; break; }
            }
            $b = $pool[$idx];
            array_splice($pool, $idx, 1);
            $pairs[] = [$a, $b];
        }

        $table = 1;
        foreach ($pairs as [$a, $b]) {
            $ins->execute([$eventId, $pid, $round, $table++, $a, $b]);
            $created++;
        }
    }
    return ['created' => $created];
}

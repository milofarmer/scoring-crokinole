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

/**
 * Apply a score to a match. Shared by the phone (submit_score) and the machine
 * ingest endpoint so both behave identically.
 * $in may carry `sets` (per-set [{pa,pb,ta,tb}]) or direct totals points_a/points_b.
 * Stores totals in points_a/points_b, the breakdown in sets_json, and advances the
 * knockout bracket when a KO match changes.
 */
function crok_apply_score(PDO $db, array $ev, array $m, array $in, string $enteredBy = ''): array {
    $setsJson = null;
    if (isset($in['sets']) && is_array($in['sets'])) {
        $clean = []; $pa = $pb = $ta = $tb = 0;
        $val = fn($v) => ($v === '' || $v === null) ? null : max(0, (int)$v);
        foreach (array_slice($in['sets'], 0, 4) as $s) {
            $row = ['pa' => $val($s['pa'] ?? null), 'pb' => $val($s['pb'] ?? null),
                    'ta' => (int)($s['ta'] ?? 0), 'tb' => (int)($s['tb'] ?? 0)];
            $clean[] = $row;
            $pa += $row['pa'] ?? 0; $pb += $row['pb'] ?? 0; $ta += $row['ta']; $tb += $row['tb'];
        }
        $setsJson = json_encode($clean);
    } else {
        $pa = max(0, (int)($in['points_a'] ?? 0)); $pb = max(0, (int)($in['points_b'] ?? 0));
        $ta = max(0, (int)($in['twenties_a'] ?? 0)); $tb = max(0, (int)($in['twenties_b'] ?? 0));
    }
    $so = isset($in['shootout_winner']) && $in['shootout_winner'] !== '' && $in['shootout_winner'] !== null
        ? (int)$in['shootout_winner'] : null;
    if ($so !== null && !in_array($so, [(int)$m['team_a_id'], (int)$m['team_b_id']], true)) $so = null;
    $status = !empty($in['complete']) ? 'entered' : 'progress';

    if ($setsJson !== null) {
        $db->prepare("UPDATE crok_match SET points_a=?, points_b=?, twenties_a=?, twenties_b=?, sets_json=?, shootout_winner=?, status=?, entered_at=?, entered_by=? WHERE id=?")
           ->execute([$pa, $pb, $ta, $tb, $setsJson, $so, $status, time(), $enteredBy, (int)$m['id']]);
    } else {
        $db->prepare("UPDATE crok_match SET points_a=?, points_b=?, twenties_a=?, twenties_b=?, shootout_winner=?, status=?, entered_at=?, entered_by=? WHERE id=?")
           ->execute([$pa, $pb, $ta, $tb, $so, $status, time(), $enteredBy, (int)$m['id']]);
    }
    if (($m['phase'] ?? '') === 'ko') crok_advance_bracket($db, $ev);

    return ['status' => $status, 'points_a' => $pa, 'points_b' => $pb,
            'twenties_a' => $ta, 'twenties_b' => $tb, 'shootout_winner' => $so];
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
 * All placings: points → 20's (→ team number as a stable fallback).
 * EXCEPTION: the #1 spot only — a tie on points+20's for the lead is broken by
 * head-to-head (onderling resultaat). Lower placings never use head-to-head.
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
    // Points → 20's → number (points & 20's descending, number ascending as a stable tiebreak).
    usort($rows, function ($x, $y) {
        if ($x['points'] !== $y['points']) return $y['points'] <=> $x['points'];
        if ($x['twenties'] !== $y['twenties']) return $y['twenties'] <=> $x['twenties'];
        return $x['number'] <=> $y['number'];
    });

    // Head-to-head decides ONLY the poule winner: reorder the leading group tied on points+20's.
    if (count($rows) > 1) {
        $lead = [];
        foreach ($rows as $r) {
            if ($r['points'] === $rows[0]['points'] && $r['twenties'] === $rows[0]['twenties']) $lead[] = $r;
            else break;
        }
        if (count($lead) > 1) {
            $matches = array_filter(crok_matches($db, (int)$event['id']), 'crok_match_scored');
            $h2h = crok_h2h_points($lead, $matches, (int)$event['points_win'], (int)$event['points_tie']);
            usort($lead, function ($x, $y) use ($h2h) {
                if ($h2h[$y['team_id']] !== $h2h[$x['team_id']]) return $h2h[$y['team_id']] <=> $h2h[$x['team_id']];
                return $x['number'] <=> $y['number'];
            });
            $rows = array_merge($lead, array_slice($rows, count($lead)));
        }
    }
    return $rows;
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

/**
 * Finalists: the top $perPoule of every poule (guaranteed), plus the best
 * $wildcards teams from the next placing across all poules (e.g. the best No.2's).
 * Runners-up are compared on points → 20's only (never head-to-head).
 * Returned seed order: guaranteed teams first (by poule finish), then wildcards.
 */
function crok_qualifiers(PDO $db, array $event, int $perPoule, int $wildcards = 0): array {
    $poules = crok_poules($db, (int)$event['id']);
    $guaranteed = []; $pool = [];
    foreach ($poules as $p) {
        $ranked = crok_ranked($db, $event, (int)$p['id']);
        for ($i = 0; $i < $perPoule; $i++) {
            if (isset($ranked[$i])) $guaranteed[] = $ranked[$i] + ['pos' => $i + 1];
        }
        if (isset($ranked[$perPoule])) $pool[] = $ranked[$perPoule] + ['pos' => $perPoule + 1]; // first non-qualifier
    }
    // Best wildcards among the runners-up — points → 20's only.
    $byPts = function ($x, $y) {
        if ($x['points'] !== $y['points']) return $y['points'] <=> $x['points'];
        if ($x['twenties'] !== $y['twenties']) return $y['twenties'] <=> $x['twenties'];
        return $x['number'] <=> $y['number'];
    };
    usort($pool, $byPts);
    $chosen = array_slice($pool, 0, max(0, $wildcards));

    $all = array_merge($guaranteed, $chosen);
    // Seed: winners (lower pos) first, then by points → 20's.
    usort($all, function ($x, $y) use ($byPts) {
        if ($x['pos'] !== $y['pos']) return $x['pos'] <=> $y['pos'];
        return $byPts($x, $y);
    });
    return $all;
}

/**
 * Build the FULL knockout skeleton from the poule standings: round 1 with the
 * seeded teams, then every later round + a bronze final as empty matches that
 * winners advance into. Cross-seeded into a power-of-two bracket (byes if needed).
 */
function crok_generate_ko(PDO $db, array $event, int $perPoule, int $wildcards = 0, bool $force = false, bool $bronze = true): array {
    $eventId = (int)$event['id'];
    $nr = (int)$event['num_rounds'];

    $st = $db->prepare("SELECT COUNT(*) c FROM crok_match WHERE event_id=? AND phase='ko'");
    $st->execute([$eventId]);
    if ((int)$st->fetch()['c'] > 0) {
        if (!$force) throw new RuntimeException('Knockout already generated (use force to rebuild).');
        $db->prepare("DELETE FROM crok_match WHERE event_id=? AND phase='ko'")->execute([$eventId]);
    }

    $seeds = crok_qualifiers($db, $event, $perPoule, $wildcards);
    if (count($seeds) < 2) throw new RuntimeException('Not enough qualified teams.');
    $M = 1; while ($M < count($seeds)) $M *= 2;         // next power of two
    $order = crok_bracket_order($M);                    // slot order of seed numbers
    $rounds = (int)round(log($M, 2));                   // e.g. 16 → 4 rounds

    $ins = $db->prepare("INSERT INTO crok_match (event_id, poule_id, round, table_no, team_a_id, team_b_id, phase, bracket, status)
                         VALUES (?,0,?,?,?,?, 'ko', ?, 'pending')");

    // Round 1 — seeded teams.
    $r1 = $nr + 1; $table = 1;
    for ($i = 0; $i < $M; $i += 2) {
        $ta = $seeds[$order[$i] - 1]['team_id'] ?? null;
        $tb = $seeds[$order[$i + 1] - 1]['team_id'] ?? null;
        if ($ta === null && $tb !== null) { $ta = $tb; $tb = null; } // bye keeps the real team as A
        $ins->execute([$eventId, $r1, $table++, $ta, $tb, crok_ko_label($M / 2)]);
    }
    // Later rounds — empty matches, to be filled by advancing winners.
    for ($k = 2; $k <= $rounds; $k++) {
        $count = (int)($M / pow(2, $k));
        $label = crok_ko_label($count);
        for ($t = 1; $t <= $count; $t++) $ins->execute([$eventId, $nr + $k, $t, null, null, $label]);
    }
    // Bronze final (optional) — same round number as the final, told apart by its label.
    // Only makes sense once there are semi-finals to lose.
    if ($bronze && $rounds >= 2) {
        $ins->execute([$eventId, $nr + $rounds, 2, null, null, 'Bronze final']);
    }

    crok_advance_bracket($db, $event); // resolve byes immediately
    return ['created' => (int)($M / 2), 'round' => $r1, 'label' => crok_ko_label($M / 2), 'bracket_size' => $M];
}

/** Non-winning team of a decided match (null for byes / undecided). */
function crok_match_loser(array $m): ?int {
    $a = (int)$m['team_a_id']; $b = (int)($m['team_b_id'] ?? 0);
    if (!$b) return null;
    $w = crok_match_winner($m);
    if ($w === null) return null;
    return $w === $a ? $b : $a;
}

/** Propagate KO winners forward into their next-round slots (and SF losers into the bronze final). */
function crok_advance_bracket(PDO $db, array $event): void {
    $eventId = (int)$event['id'];
    $all = array_filter(crok_matches($db, $eventId), fn($m) => ($m['phase'] ?? '') === 'ko');
    if (!$all) return;
    $byRound = [];
    foreach ($all as $m) $byRound[(int)$m['round']][] = $m;
    $roundNums = array_keys($byRound); sort($roundNums);
    $finalRound = max($roundNums);
    $winnersOf = function ($r) use ($byRound) {
        $ms = array_values(array_filter($byRound[$r] ?? [], fn($m) => ($m['bracket'] ?? '') !== 'Bronze final'));
        usort($ms, fn($x, $y) => (int)$x['table_no'] <=> (int)$y['table_no']);
        return $ms;
    };
    $setSlot = function ($matchId, $slot, $team) use ($db) {
        $col = $slot === 0 ? 'team_a_id' : 'team_b_id';
        $db->prepare("UPDATE crok_match SET $col=? WHERE id=?")->execute([$team, $matchId]);
    };

    foreach ($roundNums as $r) {
        if ($r >= $finalRound) break;
        $cur = $winnersOf($r);
        $next = $winnersOf($r + 1);
        foreach ($cur as $i => $m) {
            $w = crok_match_winner($m);
            if ($w === null) continue;
            $target = $next[intdiv($i, 2)] ?? null;
            if ($target) $setSlot((int)$target['id'], $i % 2, $w);
        }
    }
    // Bronze final: the two semi-final losers.
    $bronze = null;
    foreach ($byRound[$finalRound] ?? [] as $m) if (($m['bracket'] ?? '') === 'Bronze final') $bronze = $m;
    if ($bronze && $finalRound - 1 >= $roundNums[0]) {
        $sf = $winnersOf($finalRound - 1);
        foreach ($sf as $i => $m) {
            $l = crok_match_loser($m);
            if ($l !== null) $setSlot((int)$bronze['id'], $i % 2, $l);
        }
    }
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

<?php
/**
 * Crokinole tournament — JSON API.
 *
 * Public reads: ?action=state (no secret).
 * Player write: submit_score (requires the event play_code).
 * Organizer writes: everything else (requires the event admin_pin).
 */

define('CROK', 1);
require_once __DIR__ . '/../src/logic.php';
require_once __DIR__ . '/../src/season.php';

$db = crok_pdo();

// Merge JSON body and query/form params.
$raw = file_get_contents('php://input');
$body = [];
if ($raw !== '' && $raw !== false) {
    $decoded = json_decode($raw, true);
    if (is_array($decoded)) $body = $decoded;
}
$in = array_merge($_GET, $_POST, $body);
// A path (/api/state) wins over anything in the body, so a request cannot claim
// to be one call while being routed as another.
$action = (string)($_GET['_route'] ?? $in['action'] ?? 'state');

function crok_param($in, $key, $default = null) { return $in[$key] ?? $default; }

/* ---- helpers ------------------------------------------------------------ */

function crok_public_event(PDO $db, array $in): ?array {
    if (!empty($in['event_id'])) return crok_event_by_id($db, (int)$in['event_id']);
    return crok_active_event($db);
}

/** Machine API key for automated scoring — generated once per event. */
function crok_ensure_api_key(PDO $db, array $ev): string {
    if (!empty($ev['api_key'])) return (string)$ev['api_key'];
    $key = 'crok_' . bin2hex(random_bytes(16));
    $db->prepare("UPDATE crok_event SET api_key=? WHERE id=?")->execute([$key, (int)$ev['id']]);
    return $key;
}

/** Authenticate an automated client by api_key (header X-Api-Key or body api_key). */
function crok_require_machine(PDO $db, array $in): array {
    $ev = crok_public_event($db, $in);
    if (!$ev) crok_fail('No event.', 404);
    $key = trim((string)($in['api_key'] ?? ($_SERVER['HTTP_X_API_KEY'] ?? '')));
    $real = crok_ensure_api_key($db, $ev);
    if ($key === '' || !hash_equals($real, $key)) crok_fail('Invalid API key.', 401);
    $ev['api_key'] = $real;
    return $ev;
}

function crok_require_admin(PDO $db, array $in): array {
    $ev = crok_public_event($db, $in);
    if (!$ev) crok_fail('No event exists yet.', 404);
    $pin = (string)($in['admin_pin'] ?? '');
    if ($ev['admin_pin'] === '' || $ev['admin_pin'] === null) crok_fail('Event has no admin PIN set.', 403);
    if (!hash_equals((string)$ev['admin_pin'], $pin)) crok_fail('Wrong organizer PIN.', 403);
    return $ev;
}

/** Build the full public state payload (event, poules, teams, standings, current-round matches). */
/** Public payload for a single match (same shape as state round_matches). */
function crok_match_public(PDO $db, array $ev, array $m): array {
    $ids = array_filter([(int)$m['team_a_id'], (int)$m['team_b_id']]);
    $teams = [];
    if ($ids) {
        $ph = implode(',', array_fill(0, count($ids), '?'));
        $st = $db->prepare("SELECT id,name,number FROM crok_team WHERE id IN ($ph)");
        $st->execute(array_values($ids));
        foreach ($st->fetchAll() as $t) $teams[(int)$t['id']] = $t;
    }
    $a = $teams[(int)$m['team_a_id']] ?? null;
    $b = isset($teams[(int)$m['team_b_id']]) ? $teams[(int)$m['team_b_id']] : null;
    return [
        'id' => (int)$m['id'], 'poule_id' => (int)$m['poule_id'], 'round' => (int)$m['round'],
        'table_no' => (int)$m['table_no'],
        'team_a' => $a ? ['id' => (int)$a['id'], 'name' => $a['name'], 'number' => (int)$a['number']] : null,
        'team_b' => $b ? ['id' => (int)$b['id'], 'name' => $b['name'], 'number' => (int)$b['number']] : null,
        'points_a' => $m['points_a'] === null ? null : (int)$m['points_a'],
        'points_b' => $m['points_b'] === null ? null : (int)$m['points_b'],
        'twenties_a' => (int)$m['twenties_a'], 'twenties_b' => (int)$m['twenties_b'],
        'phase' => $m['phase'] ?? 'poule', 'bracket' => $m['bracket'] ?? null,
        'match_code' => $m['match_code'] ?? null,
        'shootout_winner' => $m['shootout_winner'] === null ? null : (int)$m['shootout_winner'],
        'sets' => !empty($m['sets_json']) ? json_decode($m['sets_json'], true) : null,
        'status' => $m['status'], 'scored' => crok_match_scored($m),
        'num_rounds' => (int)$ev['num_rounds'],
    ];
}

function crok_state(PDO $db, array $ev): array {
    $eventId = (int)$ev['id'];
    crok_ensure_match_codes($db, $eventId);
    $poules = crok_poules($db, $eventId);
    $teams = crok_teams($db, $eventId);
    $teamById = [];
    foreach ($teams as $t) $teamById[(int)$t['id']] = $t;

    $standingsByPoule = [];
    foreach ($poules as $p) {
        $standingsByPoule[(int)$p['id']] = crok_ranked($db, $ev, (int)$p['id']);
    }
    // Teams with no poule assigned yet
    $standingsByPoule[0] = crok_ranked($db, $ev, 0);

    $round = (int)$ev['current_round'];
    $matches = [];
    foreach (crok_matches($db, $eventId, $round) as $m) {
        $a = $teamById[(int)$m['team_a_id']] ?? null;
        $b = isset($teamById[(int)$m['team_b_id']]) ? $teamById[(int)$m['team_b_id']] : null;
        $matches[] = [
            'id' => (int)$m['id'],
            'poule_id' => (int)$m['poule_id'],
            'round' => (int)$m['round'],
            'table_no' => (int)$m['table_no'],
            'phys_table' => $m['phys_table'] === null ? null : (int)$m['phys_table'],
            'team_a' => $a ? ['id' => (int)$a['id'], 'name' => $a['name'], 'number' => (int)$a['number']] : null,
            'team_b' => $b ? ['id' => (int)$b['id'], 'name' => $b['name'], 'number' => (int)$b['number']] : null,
            'points_a' => $m['points_a'] === null ? null : (int)$m['points_a'],
            'points_b' => $m['points_b'] === null ? null : (int)$m['points_b'],
            'twenties_a' => (int)$m['twenties_a'],
            'twenties_b' => (int)$m['twenties_b'],
            'phase' => $m['phase'] ?? 'poule',
            'bracket' => $m['bracket'] ?? null,
            'match_code' => $m['match_code'] ?? null,
            'shootout_winner' => $m['shootout_winner'] === null ? null : (int)$m['shootout_winner'],
            'sets' => !empty($m['sets_json']) ? json_decode($m['sets_json'], true) : null,
            'status' => $m['status'],
            'scored' => crok_match_scored($m),
        ];
    }
    $isKo = $round > (int)$ev['num_rounds'];

    return [
        'ok' => true,
        'event' => [
            'id' => $eventId,
            'name' => $ev['name'],
            'num_rounds' => (int)$ev['num_rounds'],
            'current_round' => $round,
            'is_knockout' => $isKo,
            'round_label' => $isKo && $matches ? ($matches[0]['bracket'] ?? 'Knockout') : ('Round ' . $round),
            'status' => $ev['status'],
        ],
        'poules' => array_map(fn($p) => ['id' => (int)$p['id'], 'name' => $p['name'], 'tables' => (int)$p['tables']], $poules),
        'standings' => $standingsByPoule,
        'round_matches' => $matches,
        'server_time' => time(),
    ];
}

/* ---- routing ------------------------------------------------------------ */

try {
    switch ($action) {

    case 'state': {
        $ev = crok_public_event($db, $in);
        if (!$ev) crok_json(['ok' => true, 'event' => null]);
        crok_json(crok_state($db, $ev));
    }

    case 'team_login': {
        $ev = crok_public_event($db, $in);
        if (!$ev) crok_fail('No tournament yet.', 404);
        $code = strtoupper(trim((string)($in['code'] ?? '')));
        if ($code === '') crok_fail('Enter your team code.');
        $st = $db->prepare("SELECT * FROM crok_team WHERE event_id=? AND UPPER(login_code)=?");
        $st->execute([(int)$ev['id'], $code]);
        $t = $st->fetch();
        if (!$t) crok_fail('Unknown team code.', 403);
        crok_json(['ok' => true, 'team' => [
            'id' => (int)$t['id'], 'name' => $t['name'], 'number' => (int)$t['number'],
            'poule_id' => (int)$t['poule_id'], 'player1' => $t['player1'], 'player2' => $t['player2'],
        ]]);
    }

    /* ---------- machine ingest (automated scoring, e.g. an AI table system) ---------- */

    case 'ingest_tables': {
        // What is on each table right now, so a machine can map its camera/table to a match.
        $ev = crok_require_machine($db, $in);
        crok_ensure_match_codes($db, (int)$ev['id']);
        crok_ensure_physical_tables($db, (int)$ev['id']);
        $round = (int)($in['round'] ?? $ev['current_round']);
        $poules = [];
        foreach (crok_poules($db, (int)$ev['id']) as $p) $poules[(int)$p['id']] = $p['name'];
        $teams = [];
        foreach (crok_teams($db, (int)$ev['id']) as $t) $teams[(int)$t['id']] = $t['name'];
        $out = [];
        foreach (crok_matches($db, (int)$ev['id'], $round) as $m) {
            $out[] = [
                'match_code' => $m['match_code'], 'match_id' => (int)$m['id'],
                'round' => (int)$m['round'],
                // The table as it stands in the hall, which is what a camera sees.
                'table' => $m['phys_table'] === null ? null : (int)$m['phys_table'],
                // The old within-the-poule number, still on the players' schedule.
                'poule_table' => (int)$m['table_no'],
                'poule' => $poules[(int)$m['poule_id']] ?? null,
                'phase' => $m['phase'] ?? 'poule', 'bracket' => $m['bracket'],
                'team_a' => ['id' => (int)$m['team_a_id'], 'name' => $teams[(int)$m['team_a_id']] ?? null],
                'team_b' => $m['team_b_id'] ? ['id' => (int)$m['team_b_id'], 'name' => $teams[(int)$m['team_b_id']] ?? null] : null,
                'points_a' => $m['points_a'] === null ? null : (int)$m['points_a'],
                'points_b' => $m['points_b'] === null ? null : (int)$m['points_b'],
                'status' => $m['status'],
            ];
        }
        crok_json(['ok' => true, 'round' => $round, 'matches' => $out]);
    }

    case 'ingest_score': {
        $ev = crok_require_machine($db, $in);
        crok_ensure_match_codes($db, (int)$ev['id']);
        crok_ensure_physical_tables($db, (int)$ev['id']);
        $eventId = (int)$ev['id'];

        // Resolve the target match: match_code (preferred) | match_id | table (+round, +poule).
        $m = null;
        if (!empty($in['match_code'])) {
            $st = $db->prepare("SELECT * FROM crok_match WHERE event_id=? AND UPPER(match_code)=UPPER(?)");
            $st->execute([$eventId, trim((string)$in['match_code'])]);
            $m = $st->fetch() ?: null;
            if (!$m) crok_fail('Unknown match_code.', 404);
        } elseif (!empty($in['match_id'])) {
            $st = $db->prepare("SELECT * FROM crok_match WHERE id=? AND event_id=?");
            $st->execute([(int)$in['match_id'], $eventId]);
            $m = $st->fetch() ?: null;
            if (!$m) crok_fail('Unknown match_id.', 404);
        } elseif (isset($in['table'])) {
            // A table number means the table in the hall. That is one match per
            // round, so a camera above it never has to know which poule is
            // sitting there. The old per-poule numbering is still accepted when
            // a poule is named with it, for anything drawn before tables were
            // numbered through.
            $round = (int)($in['round'] ?? $ev['current_round']);
            $all = crok_matches($db, $eventId, $round);
            $want = (int)$in['table'];

            $cands = array_values(array_filter($all, fn($x) => $x['phys_table'] !== null && (int)$x['phys_table'] === $want));
            if (count($cands) === 0) {
                $cands = array_values(array_filter($all, fn($x) => (int)$x['table_no'] === $want));
                if (!empty($in['poule'])) {
                    $pid = null;
                    foreach (crok_poules($db, $eventId) as $p) if (strcasecmp($p['name'], (string)$in['poule']) === 0) $pid = (int)$p['id'];
                    $cands = array_values(array_filter($cands, fn($x) => (int)$x['poule_id'] === $pid));
                }
            }
            if (count($cands) === 0) crok_fail('No match at table ' . $want . ' in round ' . $round . '.', 404);
            if (count($cands) > 1) crok_fail('Table ' . $want . ' is ambiguous in round ' . $round .
                ' (' . count($cands) . ' matches). Send match_code, or add "poule".', 409);
            $m = $cands[0];
        } else {
            crok_fail('Identify the match with match_code, match_id, or table.');
        }

        if (!$m['team_b_id']) crok_fail('That match is a bye — nothing to score.', 409);
        $src = trim((string)($in['source'] ?? 'auto'));
        $res = crok_apply_score($db, $ev, $m, $in, $src);

        // Return the resulting state so the caller can confirm what was recorded.
        $st = $db->prepare("SELECT * FROM crok_match WHERE id=?");
        $st->execute([(int)$m['id']]);
        $after = $st->fetch();
        $w = crok_match_winner($after);
        crok_json(['ok' => true, 'match' => crok_match_public($db, $ev, $after) + [
            'winner_team_id' => $w,
            'winner' => $w === null ? null : ($w === (int)$after['team_a_id'] ? 'a' : 'b'),
        ]]);
    }

    /* ---------- season ranking (NCA Field-Weighted Points) ---------- */

    case 'season_state': {
        // Public leaderboard + the list of counted nights.
        $season = trim((string)($in['season'] ?? '')) ?: null;
        $seasons = array_map(fn($r) => $r['season'], $db->query("SELECT DISTINCT season FROM crok_snight WHERE season IS NOT NULL AND season<>'' ORDER BY season DESC")->fetchAll());
        $nights = $db->query("SELECT n.*, (SELECT COUNT(*) FROM crok_sresult r WHERE r.snight_id=n.id) players FROM crok_snight n ORDER BY date DESC, id DESC")->fetchAll();
        crok_json([
            'ok' => true,
            'seasons' => $seasons,
            'standings' => crok_season_standings($db, $season),
            'nights' => array_map(fn($n) => [
                'id' => (int)$n['id'], 'season' => $n['season'], 'name' => $n['name'], 'date' => $n['date'],
                'host' => $n['host'], 'type' => $n['type'], 'field_size' => (int)$n['field_size'],
                'fsi' => (float)$n['fsi'], 'fdi' => (float)$n['fdi'], 'players' => (int)$n['players'],
            ], $nights),
        ]);
    }

    case 'season_data': { // full data for the organizer view
        crok_require_admin($db, $in);
        crok_json([
            'ok' => true,
            'players' => $db->query("SELECT * FROM crok_player ORDER BY name")->fetchAll(),
            'nights' => $db->query("SELECT * FROM crok_snight ORDER BY date DESC, id DESC")->fetchAll(),
            'results' => $db->query("SELECT r.*, p.name player_name FROM crok_sresult r JOIN crok_player p ON p.id=r.player_id ORDER BY r.snight_id, r.position")->fetchAll(),
        ]);
    }

    case 'season_add_player': {
        crok_require_admin($db, $in);
        $name = trim((string)($in['name'] ?? ''));
        if ($name === '') crok_fail('Player name?');
        $db->prepare("INSERT INTO crok_player (name, created_at) VALUES (?,?)")->execute([$name, time()]);
        crok_json(['ok' => true, 'id' => (int)$db->lastInsertId()]);
    }

    case 'season_save_night': {
        crok_require_admin($db, $in);
        $id = (int)($in['id'] ?? 0);
        $fields = [
            'season' => trim((string)($in['season'] ?? 'S17')),
            'name' => trim((string)($in['name'] ?? '')),
            'date' => trim((string)($in['date'] ?? '')),
            'host' => trim((string)($in['host'] ?? '')),
            'type' => ($in['type'] ?? 'singles') === 'doubles' ? 'doubles' : 'singles',
            'field_size' => max(1, (int)($in['field_size'] ?? 1)),
            'fsi' => (float)($in['fsi'] ?? 1.0),
            'fdi' => (float)($in['fdi'] ?? 1.0),
        ];
        if ($id) {
            $set = implode(',', array_map(fn($k) => "$k=?", array_keys($fields)));
            $db->prepare("UPDATE crok_snight SET $set WHERE id=?")->execute([...array_values($fields), $id]);
        } else {
            $cols = implode(',', array_keys($fields)) . ',created_at';
            $ph = implode(',', array_fill(0, count($fields), '?')) . ',?';
            $db->prepare("INSERT INTO crok_snight ($cols) VALUES ($ph)")->execute([...array_values($fields), time()]);
            $id = (int)$db->lastInsertId();
        }
        crok_recompute_night($db, $id); // keep stored FWP in sync with FSI/FDI/size
        crok_json(['ok' => true, 'id' => $id]);
    }

    case 'season_add_result': {
        crok_require_admin($db, $in);
        $nid = (int)($in['snight_id'] ?? 0);
        $pid = (int)($in['player_id'] ?? 0);
        $pos = max(1, (int)($in['position'] ?? 1));
        $n = $db->prepare("SELECT * FROM crok_snight WHERE id=?"); $n->execute([$nid]); $night = $n->fetch();
        if (!$night || !$pid) crok_fail('Pick a night and a player.');
        $fwp = crok_fwp($pos, (int)$night['field_size'], (float)$night['fsi'], (float)$night['fdi']);
        $db->prepare("INSERT INTO crok_sresult (snight_id, player_id, position, fwp, created_at) VALUES (?,?,?,?,?)")
           ->execute([$nid, $pid, $pos, $fwp, time()]);
        crok_json(['ok' => true, 'fwp' => $fwp]);
    }

    case 'season_delete_result': {
        crok_require_admin($db, $in);
        $db->prepare("DELETE FROM crok_sresult WHERE id=?")->execute([(int)($in['id'] ?? 0)]);
        crok_json(['ok' => true]);
    }

    case 'season_delete_night': {
        crok_require_admin($db, $in);
        $id = (int)($in['id'] ?? 0);
        $db->prepare("DELETE FROM crok_sresult WHERE snight_id=?")->execute([$id]);
        $db->prepare("DELETE FROM crok_snight WHERE id=?")->execute([$id]);
        crok_json(['ok' => true]);
    }

    case 'schedule': {
        // Public: every match across all rounds, with team names — for the big board.
        $ev = crok_public_event($db, $in);
        if (!$ev) crok_json(['ok' => true, 'event' => null]);
        crok_ensure_match_codes($db, (int)$ev['id']);
        $teams = crok_teams($db, (int)$ev['id']);
        $byId = [];
        foreach ($teams as $t) $byId[(int)$t['id']] = $t;
        $rounds = [];
        foreach (crok_matches($db, (int)$ev['id']) as $m) {
            $a = $byId[(int)$m['team_a_id']] ?? null;
            $b = isset($byId[(int)$m['team_b_id']]) ? $byId[(int)$m['team_b_id']] : null;
            $rounds[(int)$m['round']][] = [
                'poule_id' => (int)$m['poule_id'], 'table_no' => (int)$m['table_no'],
                'phys_table' => $m['phys_table'] === null ? null : (int)$m['phys_table'],
                'a' => $a ? $a['name'] : '—', 'b' => $b ? $b['name'] : null,
                'sets_a' => $m['points_a'] === null ? null : (int)$m['points_a'],
                'sets_b' => $m['points_b'] === null ? null : (int)$m['points_b'],
                'twenties_a' => (int)$m['twenties_a'], 'twenties_b' => (int)$m['twenties_b'],
                'phase' => $m['phase'] ?? 'poule', 'bracket' => $m['bracket'] ?? null,
                'match_code' => $m['match_code'] ?? null,
                'shootout_winner' => $m['shootout_winner'] === null ? null : (int)$m['shootout_winner'],
                'win' => (function () use ($m) { $w = crok_match_winner($m); return $w === null ? null : ($w === (int)$m['team_a_id'] ? 'a' : 'b'); })(),
                'status' => $m['status'], 'scored' => crok_match_scored($m),
            ];
        }
        crok_json(['ok' => true, 'event' => ['name' => $ev['name'], 'current_round' => (int)$ev['current_round'], 'num_rounds' => (int)$ev['num_rounds']],
            'poules' => array_map(fn($p) => ['id' => (int)$p['id'], 'name' => $p['name'], 'tables' => (int)$p['tables']], crok_poules($db, (int)$ev['id'])),
            'rounds' => $rounds]);
    }

    case 'match_login': {
        $ev = crok_public_event($db, $in);
        if (!$ev) crok_fail('No tournament yet.', 404);
        crok_ensure_match_codes($db, (int)$ev['id']);
        $code = strtoupper(trim((string)($in['code'] ?? '')));
        if ($code === '') crok_fail('Enter the match code.');
        $st = $db->prepare("SELECT * FROM crok_match WHERE event_id=? AND UPPER(match_code)=?");
        $st->execute([(int)$ev['id'], $code]);
        $m = $st->fetch();
        if (!$m) crok_fail('Unknown match code.', 403);
        crok_json(['ok' => true, 'match' => crok_match_public($db, $ev, $m)]);
    }

    case 'submit_score': {
        $ev = crok_public_event($db, $in);
        if (!$ev) crok_fail('No event.', 404);

        $matchId = (int)($in['match_id'] ?? 0);
        $st = $db->prepare("SELECT * FROM crok_match WHERE id=? AND event_id=?");
        $st->execute([$matchId, (int)$ev['id']]);
        $m = $st->fetch();
        if (!$m) crok_fail('Match not found.', 404);

        // Auth: organizer PIN, event play_code, this match's own code, OR a team login code in this match.
        $code = trim((string)($in['code'] ?? ''));
        $okAdmin  = $ev['admin_pin'] !== '' && hash_equals((string)$ev['admin_pin'], $code);
        $okPlay   = $ev['play_code'] !== '' && hash_equals((string)$ev['play_code'], $code);
        $okCode   = !empty($m['match_code']) && strcasecmp((string)$m['match_code'], $code) === 0;
        $okMember = false;
        if (!$okAdmin && !$okPlay && !$okCode && $code !== '') {
            $ts = $db->prepare("SELECT id FROM crok_team WHERE event_id=? AND UPPER(login_code)=UPPER(?)");
            $ts->execute([(int)$ev['id'], $code]);
            $tid = $ts->fetch();
            if ($tid) $okMember = in_array((int)$tid['id'], [(int)$m['team_a_id'], (int)$m['team_b_id']], true);
        }
        if (!$okAdmin && !$okPlay && !$okCode && !$okMember) crok_fail('Not your match, or wrong code.', 403);
        if ($m['status'] === 'confirmed' && !$okAdmin) crok_fail('This result is locked by the organizer.', 409);

        $res = crok_apply_score($db, $ev, $m, $in, trim((string)($in['entered_by'] ?? '')));
        crok_json(['ok' => true, 'status' => $res['status']]);
    }

    /* ---------- organizer actions (admin_pin required) ------------------ */

    case 'admin_login': {
        crok_require_admin($db, $in);
        $ev = crok_public_event($db, $in);
        crok_json(['ok' => true, 'event_id' => (int)$ev['id']]);
    }

    case 'admin_state': {
        $ev = crok_require_admin($db, $in);
        $eventId = (int)$ev['id'];
        crok_ensure_match_codes($db, $eventId);
        $round = (int)($in['round'] ?? $ev['current_round']);
        $teams = crok_teams($db, $eventId);
        $teamById = [];
        foreach ($teams as $t) $teamById[(int)$t['id']] = $t;
        $matches = [];
        foreach (crok_matches($db, $eventId, $round) as $m) {
            $matches[] = [
                'id' => (int)$m['id'], 'poule_id' => (int)$m['poule_id'], 'table_no' => (int)$m['table_no'],
                'team_a_id' => $m['team_a_id'] === null ? null : (int)$m['team_a_id'],
                'team_b_id' => $m['team_b_id'] === null ? null : (int)$m['team_b_id'],
                'points_a' => $m['points_a'] === null ? null : (int)$m['points_a'],
                'points_b' => $m['points_b'] === null ? null : (int)$m['points_b'],
                'twenties_a' => (int)$m['twenties_a'], 'twenties_b' => (int)$m['twenties_b'],
                'phase' => $m['phase'] ?? 'poule', 'bracket' => $m['bracket'] ?? null,
                'match_code' => $m['match_code'] ?? null,
                'shootout_winner' => $m['shootout_winner'] === null ? null : (int)$m['shootout_winner'],
                'sets' => !empty($m['sets_json']) ? json_decode($m['sets_json'], true) : null,
                'status' => $m['status'],
            ];
        }
        crok_json([
            'ok' => true,
            'event' => [
                'id' => $eventId, 'name' => $ev['name'], 'play_code' => $ev['play_code'],
                'num_rounds' => (int)$ev['num_rounds'], 'points_win' => (int)$ev['points_win'],
                'points_tie' => (int)$ev['points_tie'], 'current_round' => (int)$ev['current_round'],
                'advance_per_poule' => (int)($ev['advance_per_poule'] ?? 1),
                'wildcards' => (int)($ev['wildcards'] ?? 0),
                'bronze_final' => (int)($ev['bronze_final'] ?? 1),
                'api_key' => crok_ensure_api_key($db, $ev),
                'poule_count' => count(crok_poules($db, $eventId)),
                'status' => $ev['status'],
            ],
            'poules' => array_map(fn($p) => ['id' => (int)$p['id'], 'name' => $p['name'], 'tables' => (int)$p['tables']], crok_poules($db, $eventId)),
            'teams' => array_map(fn($t) => [
                'id' => (int)$t['id'], 'number' => (int)$t['number'], 'name' => $t['name'],
                'player1' => $t['player1'], 'player2' => $t['player2'], 'poule_id' => (int)$t['poule_id'],
                'login_code' => $t['login_code'] ?? '',
            ], $teams),
            'round' => $round,
            'matches' => $matches,
            'ko_rounds' => (function () use ($db, $eventId) {
                $q = $db->prepare("SELECT round, MAX(bracket) bracket, COUNT(*) c FROM crok_match WHERE event_id=? AND phase='ko' GROUP BY round ORDER BY round");
                $q->execute([$eventId]);
                return array_map(fn($r) => ['round' => (int)$r['round'], 'label' => $r['bracket'], 'count' => (int)$r['c']], $q->fetchAll());
            })(),
        ]);
    }

    case 'create_event': {
        // First event needs no prior PIN; a later one requires the current admin PIN.
        $existing = crok_active_event($db);
        if ($existing) crok_require_admin($db, $in);

        $name = trim((string)($in['name'] ?? 'Crokinole Tournament'));
        $play = trim((string)($in['play_code'] ?? ''));
        $pin  = trim((string)($in['admin_pin'] ?? ''));
        $rounds = max(1, (int)($in['num_rounds'] ?? 4));
        $pw = (int)($in['points_win'] ?? 2);
        $ptie = (int)($in['points_tie'] ?? 1);
        if ($pin === '') crok_fail('Set an organizer PIN.');
        if ($play === '') crok_fail('Set a table code for players.');

        $st = $db->prepare("INSERT INTO crok_event (name, play_code, admin_pin, num_rounds, points_win, points_tie, current_round, status, created_at)
                            VALUES (?,?,?,?,?,?,1,'running',?)");
        $st->execute([$name, $play, $pin, $rounds, $pw, $ptie, time()]);
        crok_json(['ok' => true, 'event_id' => (int)$db->lastInsertId()]);
    }

    case 'update_event': {
        $ev = crok_require_admin($db, $in);
        $fields = [];
        $vals = [];
        foreach (['name' => 'str', 'play_code' => 'str', 'num_rounds' => 'int', 'points_win' => 'int',
                  'points_tie' => 'int', 'current_round' => 'int', 'advance_per_poule' => 'int',
                  'wildcards' => 'int', 'bronze_final' => 'int', 'status' => 'str'] as $k => $type) {
            if (array_key_exists($k, $in)) {
                $fields[] = "$k=?";
                $vals[] = $type === 'int' ? (int)$in[$k] : trim((string)$in[$k]);
            }
        }
        if ($fields) {
            $vals[] = (int)$ev['id'];
            $db->prepare("UPDATE crok_event SET " . implode(',', $fields) . " WHERE id=?")->execute($vals);
        }
        crok_json(['ok' => true]);
    }

    case 'set_poules': {
        $ev = crok_require_admin($db, $in);
        $poules = $in['poules'] ?? []; // [{name, tables}]
        if (!is_array($poules)) crok_fail('poules must be a list.');
        $eventId = (int)$ev['id'];

        // Upsert by name so existing team assignments (poule_id) survive edits.
        $existing = [];
        foreach (crok_poules($db, $eventId) as $p) $existing[mb_strtolower(trim($p['name']))] = (int)$p['id'];
        $keep = [];
        $sort = 0;
        foreach ($poules as $p) {
            $name = trim((string)($p['name'] ?? ''));
            if ($name === '') continue;
            $tables = max(1, (int)($p['tables'] ?? 11));
            $key = mb_strtolower($name);
            if (isset($existing[$key])) {
                $db->prepare("UPDATE crok_poule SET name=?, tables=?, sort=? WHERE id=?")
                   ->execute([$name, $tables, $sort++, $existing[$key]]);
                $keep[] = $existing[$key];
            } else {
                $db->prepare("INSERT INTO crok_poule (event_id, name, tables, sort) VALUES (?,?,?,?)")
                   ->execute([$eventId, $name, $tables, $sort++]);
                $keep[] = (int)$db->lastInsertId();
            }
        }
        // Remove poules that were dropped, but only if no team still points at them.
        foreach ($existing as $id) {
            if (in_array($id, $keep, true)) continue;
            $c = $db->prepare("SELECT COUNT(*) c FROM crok_team WHERE poule_id=?");
            $c->execute([$id]);
            if ((int)$c->fetch()['c'] === 0) $db->prepare("DELETE FROM crok_poule WHERE id=?")->execute([$id]);
        }
        crok_json(['ok' => true]);
    }

    case 'add_team': {
        $ev = crok_require_admin($db, $in);
        crok_add_team($db, (int)$ev['id'], $in);
        crok_json(['ok' => true]);
    }

    case 'bulk_add_teams': {
        $ev = crok_require_admin($db, $in);
        $text = (string)($in['text'] ?? '');
        // Map poule names to ids
        $pmap = [];
        foreach (crok_poules($db, (int)$ev['id']) as $p) $pmap[mb_strtolower(trim($p['name']))] = (int)$p['id'];
        $n = 0;
        foreach (preg_split('/\r\n|\r|\n/', $text) as $line) {
            $line = trim($line);
            if ($line === '') continue;
            $parts = array_map('trim', preg_split('/[;\t|]/', $line));
            $name = $parts[0] ?? '';
            $p1 = $parts[1] ?? '';
            $p2 = $parts[2] ?? '';
            $pouleName = mb_strtolower($parts[3] ?? '');
            if ($name === '') continue;
            crok_add_team($db, (int)$ev['id'], [
                'name' => $name, 'player1' => $p1, 'player2' => $p2,
                'poule_id' => $pmap[$pouleName] ?? 0,
            ]);
            $n++;
        }
        crok_json(['ok' => true, 'added' => $n]);
    }

    case 'update_team': {
        $ev = crok_require_admin($db, $in);
        $id = (int)($in['id'] ?? 0);
        $fields = []; $vals = [];
        foreach (['name' => 'str', 'player1' => 'str', 'player2' => 'str', 'poule_id' => 'int', 'number' => 'int'] as $k => $type) {
            if (array_key_exists($k, $in)) { $fields[] = "$k=?"; $vals[] = $type === 'int' ? (int)$in[$k] : trim((string)$in[$k]); }
        }
        if ($fields) {
            $vals[] = $id; $vals[] = (int)$ev['id'];
            $db->prepare("UPDATE crok_team SET " . implode(',', $fields) . " WHERE id=? AND event_id=?")->execute($vals);
        }
        crok_json(['ok' => true]);
    }

    case 'delete_team': {
        $ev = crok_require_admin($db, $in);
        $id = (int)($in['id'] ?? 0);
        $db->prepare("DELETE FROM crok_team WHERE id=? AND event_id=?")->execute([$id, (int)$ev['id']]);
        crok_json(['ok' => true]);
    }

    case 'generate_round': {
        $ev = crok_require_admin($db, $in);
        $round = (int)($in['round'] ?? $ev['current_round']);
        $force = !empty($in['force']);
        try {
            $res = crok_generate_round($db, $ev, $round, $force);
        } catch (RuntimeException $e) {
            crok_fail($e->getMessage(), 409);
        }
        crok_json(['ok' => true] + $res);
    }

    case 'generate_ko': {
        $ev = crok_require_admin($db, $in);
        $per = (int)($in['per_poule'] ?? $ev['advance_per_poule'] ?? 1);
        $wild = (int)($in['wildcards'] ?? $ev['wildcards'] ?? 0);
        $bronze = array_key_exists('bronze_final', $in)
            ? !empty($in['bronze_final'])
            : (int)($ev['bronze_final'] ?? 1) === 1;
        $force = !empty($in['force']);
        try { $res = crok_generate_ko($db, $ev, $per, $wild, $force, $bronze); }
        catch (RuntimeException $e) { crok_fail($e->getMessage(), 409); }
        // Remember the settings and make the KO round live.
        $db->prepare("UPDATE crok_event SET advance_per_poule=?, wildcards=?, bronze_final=?, current_round=? WHERE id=?")
           ->execute([$per, $wild, $bronze ? 1 : 0, $res['round'], (int)$ev['id']]);
        crok_json(['ok' => true] + $res);
    }

    case 'generate_next_ko': {
        // Full bracket is created up front and winners advance automatically; this just refreshes.
        $ev = crok_require_admin($db, $in);
        crok_advance_bracket($db, $ev);
        crok_json(['ok' => true, 'label' => 'Bracket refreshed']);
    }

    case 'set_match': {
        $ev = crok_require_admin($db, $in);
        $id = (int)($in['id'] ?? 0);
        $st = $db->prepare("SELECT * FROM crok_match WHERE id=? AND event_id=?");
        $st->execute([$id, (int)$ev['id']]);
        if (!$st->fetch()) crok_fail('Match not found.', 404);
        $fields = []; $vals = [];
        foreach (['team_a_id', 'team_b_id', 'points_a', 'points_b', 'twenties_a', 'twenties_b', 'table_no', 'shootout_winner'] as $k) {
            if (array_key_exists($k, $in)) {
                $fields[] = "$k=?";
                $vals[] = ($in[$k] === '' || $in[$k] === null) ? null : (int)$in[$k];
            }
        }
        if (array_key_exists('status', $in)) { $fields[] = "status=?"; $vals[] = (string)$in['status']; }
        if ($fields) {
            $vals[] = $id;
            $db->prepare("UPDATE crok_match SET " . implode(',', $fields) . " WHERE id=?")->execute($vals);
        }
        crok_advance_bracket($db, $ev); // keep the bracket consistent after a manual edit
        crok_json(['ok' => true]);
    }

    case 'reset_event': {
        // Danger: wipe everything for the active event. Requires admin PIN.
        $ev = crok_require_admin($db, $in);
        foreach (['crok_match', 'crok_team', 'crok_poule'] as $tbl) {
            $db->prepare("DELETE FROM $tbl WHERE event_id=?")->execute([(int)$ev['id']]);
        }
        $db->prepare("DELETE FROM crok_event WHERE id=?")->execute([(int)$ev['id']]);
        crok_json(['ok' => true]);
    }

    default:
        crok_fail('Unknown action: ' . $action, 404);
    }
} catch (Throwable $e) {
    crok_fail('Server error: ' . $e->getMessage(), 500);
}

/* ---- shared insert ------------------------------------------------------ */

function crok_add_team(PDO $db, int $eventId, array $in): void {
    $st = $db->prepare("SELECT COALESCE(MAX(number),0)+1 n FROM crok_team WHERE event_id=?");
    $st->execute([$eventId]);
    $num = (int)($in['number'] ?? $st->fetch()['n']);
    $code = trim((string)($in['login_code'] ?? '')) ?: crok_gen_login_code($db, $eventId);
    $ins = $db->prepare("INSERT INTO crok_team (event_id, poule_id, number, name, player1, player2, login_code, created_at)
                        VALUES (?,?,?,?,?,?,?,?)");
    $ins->execute([
        $eventId,
        (int)($in['poule_id'] ?? 0),
        $num,
        trim((string)($in['name'] ?? '')),
        trim((string)($in['player1'] ?? '')),
        trim((string)($in['player2'] ?? '')),
        $code,
        time(),
    ]);
}

/** Short, unambiguous team login code, unique within the event. */
function crok_gen_login_code(PDO $db, int $eventId): string {
    $alpha = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I,L,O,0,1
    $chk = $db->prepare("SELECT 1 FROM crok_team WHERE event_id=? AND login_code=?");
    for ($try = 0; $try < 50; $try++) {
        $c = '';
        for ($i = 0; $i < 4; $i++) $c .= $alpha[random_int(0, strlen($alpha) - 1)];
        $chk->execute([$eventId, $c]);
        if (!$chk->fetch()) return $c;
    }
    return substr(strtoupper(bin2hex(random_bytes(3))), 0, 5);
}

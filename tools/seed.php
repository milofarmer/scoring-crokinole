<?php
/**
 * Seed the crokinole app with realistic test data via its HTTP API.
 *
 *   php tools/seed.php [baseUrl] [--rounds=N] [--played=N] [--fresh]
 *
 *   baseUrl    default http://localhost:8085  (use http://localhost:8091 for the php -S preview)
 *   --rounds   how many of the 4 rounds to draw            (default 4)
 *   --played   how many of those rounds to fully score     (default 3, i.e. round 4 left in progress)
 *   --fresh    delete any existing event first
 *
 * Creates: event "NK Crokinole" (code NK2026 / pin 1234), poules A & B of 22 teams
 * across 11 tables each, Swiss draws, and plausible game scores + 20's.
 */

$base   = 'http://localhost:8085';
$rounds = 4;
$played = 3;
$fresh  = false;
foreach (array_slice($argv, 1) as $a) {
    if ($a === '--fresh') $fresh = true;
    elseif (preg_match('/^--rounds=(\d+)$/', $a, $m)) $rounds = (int)$m[1];
    elseif (preg_match('/^--played=(\d+)$/', $a, $m)) $played = (int)$m[1];
    elseif ($a[0] !== '-') $base = rtrim($a, '/');
}
$PIN = '1234';
$CODE = 'NK2026';

function api(string $base, array $body): array {
    $ch = curl_init($base . '/api.php');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_POSTFIELDS => json_encode($body),
        CURLOPT_RETURNTRANSFER => true,
    ]);
    $out = curl_exec($ch);
    if ($out === false) { fwrite(STDERR, "  ! request failed: " . curl_error($ch) . "\n"); exit(1); }
    return json_decode($out, true) ?? [];
}

echo "Seeding $base …\n";

if ($fresh) { api($base, ['action' => 'reset_event', 'admin_pin' => $PIN]); echo "  · reset existing event\n"; }

$r = api($base, ['action' => 'create_event', 'name' => 'NK Crokinole', 'play_code' => $CODE,
    'admin_pin' => $PIN, 'num_rounds' => 4, 'points_win' => 2, 'points_tie' => 1]);
if (empty($r['ok'])) { fwrite(STDERR, "  ! create_event: " . ($r['error'] ?? '?') . " (try --fresh)\n"); exit(1); }
echo "  · created event (code $CODE, pin $PIN)\n";

api($base, ['action' => 'set_poules', 'admin_pin' => $PIN,
    'poules' => [['name' => 'A', 'tables' => 11], ['name' => 'B', 'tables' => 11]]]);
echo "  · poules A & B\n";

/* --- 44 team names + player pairs --------------------------------------- */
$names = [
    'De Schietende Sterren','Twintig Vol','Baan Brekers','De Gladde Schijven','Hoekwerk',
    'Centrum Zoekers','De Duimspelers','Ring Rakkers','De Vlakke Baan','Schijf & Zo',
    'De Middenstip','Krijt op de Baan','De Flipperkast','Vingervlug','De Ricochet',
    'Botsende Buren','De Twintigers','Rand Lopers','De Kalme Hand','Spin & Sink',
    'De Houten Schijf','Noord-Zuid','De Diagonaal','Kanters United','De Stootrand',
    'Zachte Toets','De Pendule','Baanvegers','De Scherpschutters','Rond & Raak',
    'De Boemerang','Stip Stapels','De Wrijving','Kurk & Klap','De Onderkant',
    'Vier op een Rij','De Snelle Schijf','Randje Twintig','De Zwaartekracht','Klick Klack',
    'De Laatste Schijf','Baan 8','De Uitschieters','Dubbel & Dwars',
];
$fn = ['Anne','Bram','Cor','Daan','Eva','Floor','Guus','Hanna','Ivo','Jorn','Koen','Lieke',
    'Mees','Nina','Otto','Puck','Roos','Sven','Tijn','Vera','Wout','Yara','Bas','Fenna',
    'Gijs','Hidde','Ise','Joost','Kaya','Lars','Marit','Noud','Olaf','Pien','Quinn','Rick',
    'Sanne','Teun','Ties','Ulla','Vince','Wies','Xander','Zoë'];

$lines = [];
for ($i = 0; $i < 44; $i++) {
    $poule = $i < 22 ? 'A' : 'B';
    $p1 = $fn[$i % count($fn)];
    $p2 = $fn[(int)($i * 1.7 + 11) % count($fn)];
    if ($p2 === $p1) $p2 = $fn[($i + 1) % count($fn)];
    $lines[] = "{$names[$i]}; {$p1}; {$p2}; {$poule}";
}
$r = api($base, ['action' => 'bulk_add_teams', 'admin_pin' => $PIN, 'text' => implode("\n", $lines)]);
echo "  · added {$r['added']} teams\n";

/* --- draw + score rounds ------------------------------------------------ */
mt_srand(42);
for ($round = 1; $round <= $rounds; $round++) {
    $g = api($base, ['action' => 'generate_round', 'admin_pin' => $PIN, 'round' => $round, 'force' => 1]);
    echo "  · round $round: drew " . ($g['created'] ?? 0) . " matches";

    if ($round <= $played) {
        $ms = api($base, ['action' => 'admin_state', 'admin_pin' => $PIN, 'round' => $round])['matches'] ?? [];
        $scored = 0;
        foreach ($ms as $m) {
            if (empty($m['team_b_id'])) continue; // bye
            // 4 sets, each with points + 20's per team; total points decides the match.
            $sets = [];
            for ($s = 0; $s < 4; $s++) {
                $sets[] = [
                    'pa' => mt_rand(10, 55), 'pb' => mt_rand(10, 55),
                    'ta' => mt_rand(0, 3), 'tb' => mt_rand(0, 3),
                ];
            }
            api($base, ['action' => 'submit_score', 'code' => $CODE, 'match_id' => $m['id'],
                'sets' => $sets, 'complete' => 1]);
            $scored++;
        }
        echo ", scored $scored";
    }
    echo "\n";
}

// Show the round that is currently "live": the first unscored round, else the last.
$current = min($rounds, $played + 1);
api($base, ['action' => 'update_event', 'admin_pin' => $PIN, 'current_round' => $current]);
echo "  · current round set to $current\n";

// Show a few team login codes (players sign in with these).
$teams = api($base, ['action' => 'admin_state', 'admin_pin' => $PIN])['teams'] ?? [];
echo "\nSample team logins (code → team):\n";
foreach (array_slice($teams, 0, 6) as $t) printf("  %-6s %s\n", $t['login_code'], $t['name']);
echo "  … " . count($teams) . " teams total (all codes in /admin.php).\n";

echo "\nDone.\n  Phone   $base\n  Screen  $base/board.php\n  Admin   $base/admin.php  (pin $PIN)\n";

<?php
/**
 * Season ranking — NCA Field-Weighted Points (FWP).
 * Include only. Independent of the tournament tables.
 */
if (!defined('CROK')) { http_response_code(403); exit('forbidden'); }

require_once __DIR__ . '/store.php';

/**
 * Field-Weighted Points for a finishing position.
 * Reverse-engineered from NCA data (mean abs error ~0.6 pt over the published examples):
 *   FWP = TOP·FSI · [ f + (1−f)·(1−x)^K ],  f = FLOOR·FDI,  x = (pos−1)/(N−1)
 * FSI sets the top prize; FDI sets the floor; position decays between them.
 * Constants are calibratable; results also support a manual override.
 */
function crok_fwp(int $pos, int $N, float $fsi, float $fdi, float $top = 50.0, float $floor = 0.40, float $k = 1.83): float {
    if ($N <= 1) return round($top * $fsi, 1);
    $pos = max(1, min($N, $pos));
    $x = ($pos - 1) / ($N - 1);
    $f = $floor * $fdi;
    return round($top * $fsi * ($f + (1 - $f) * pow(1 - $x, $k)), 1);
}

/** Recompute + store FWP for every result of a night (after its FSI/FDI/size changes). */
function crok_recompute_night(PDO $db, int $nightId): void {
    $n = $db->prepare("SELECT * FROM crok_snight WHERE id=?");
    $n->execute([$nightId]);
    $night = $n->fetch();
    if (!$night) return;
    $rs = $db->prepare("SELECT * FROM crok_sresult WHERE snight_id=?");
    $rs->execute([$nightId]);
    $up = $db->prepare("UPDATE crok_sresult SET fwp=? WHERE id=?");
    foreach ($rs->fetchAll() as $r) {
        $fwp = crok_fwp((int)$r['position'], (int)$night['field_size'], (float)$night['fsi'], (float)$night['fdi']);
        $up->execute([$fwp, (int)$r['id']]);
    }
}

/**
 * Season standings: each player's best-5 FWP total, with singles/doubles contribution
 * (the singles/doubles split of the counting five). Sorted by total desc.
 */
function crok_season_standings(PDO $db, ?string $season = null): array {
    $sql = "SELECT r.player_id, r.fwp, n.type, p.name
            FROM crok_sresult r
            JOIN crok_snight n ON n.id = r.snight_id
            JOIN crok_player p ON p.id = r.player_id";
    $args = [];
    if ($season !== null && $season !== '') { $sql .= " WHERE n.season = ?"; $args[] = $season; }
    $st = $db->prepare($sql);
    $st->execute($args);

    $byPlayer = [];
    foreach ($st->fetchAll() as $row) {
        $pid = (int)$row['player_id'];
        $byPlayer[$pid]['name'] = $row['name'];
        $byPlayer[$pid]['results'][] = ['fwp' => (float)$row['fwp'], 'type' => $row['type']];
    }

    $out = [];
    foreach ($byPlayer as $pid => $p) {
        $res = $p['results'];
        usort($res, fn($a, $b) => $b['fwp'] <=> $a['fwp']);
        $counting = array_slice($res, 0, 5);
        $total = 0.0; $singles = 0.0; $doubles = 0.0;
        foreach ($counting as $r) {
            $total += $r['fwp'];
            if ($r['type'] === 'doubles') $doubles += $r['fwp']; else $singles += $r['fwp'];
        }
        $out[] = [
            'player_id' => $pid, 'name' => $p['name'],
            'total' => round($total, 1),
            'singles' => round($singles, 1), 'doubles' => round($doubles, 1),
            'played' => count($res), 'counting' => count($counting),
        ];
    }
    usort($out, fn($a, $b) => $b['total'] <=> $a['total']);
    return $out;
}

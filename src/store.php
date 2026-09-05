<?php
/**
 * Crokinole tournament — storage layer.
 *
 * A single PDO connection plus idempotent schema creation. Defaults to SQLite
 * (perfect for a self-contained, dockerised, single-event app with a writable
 * volume). Set CROK_DB_DRIVER=mysql to point at a MySQL/MariaDB instead.
 *
 * This file is an include only — never served directly.
 */

if (!defined('CROK')) { http_response_code(403); exit('forbidden'); }

function crok_pdo(): PDO {
    static $pdo = null;
    if ($pdo instanceof PDO) return $pdo;

    $driver = strtolower(getenv('CROK_DB_DRIVER') ?: 'sqlite');
    $opts = [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ];

    if ($driver === 'mysql') {
        $host = getenv('CROK_DB_HOST') ?: 'db';
        $port = getenv('CROK_DB_PORT') ?: '3306';
        $name = getenv('CROK_DB_NAME') ?: 'crok';
        $user = getenv('CROK_DB_USER') ?: 'crok';
        $pass = getenv('CROK_DB_PASS') ?: '';
        $dsn  = "mysql:host=$host;port=$port;dbname=$name;charset=utf8mb4";
        $pdo  = new PDO($dsn, $user, $pass, $opts);
    } else {
        $path = getenv('CROK_SQLITE_PATH') ?: (__DIR__ . '/../data/crok.sqlite');
        if (!is_dir(dirname($path))) @mkdir(dirname($path), 0777, true);
        $pdo = new PDO('sqlite:' . $path, null, null, $opts);
        $pdo->exec('PRAGMA journal_mode=WAL');
        $pdo->exec('PRAGMA foreign_keys=ON');
    }

    crok_migrate($pdo, $driver);
    return $pdo;
}

/** Create tables if they do not exist. Written to run on both SQLite and MySQL. */
function crok_migrate(PDO $pdo, string $driver): void {
    $pk  = $driver === 'mysql'
        ? 'INTEGER PRIMARY KEY AUTO_INCREMENT'
        : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    $eng = $driver === 'mysql' ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4' : '';

    $pdo->exec("CREATE TABLE IF NOT EXISTS crok_event (
        id           $pk,
        name         TEXT,
        play_code    TEXT,
        admin_pin    TEXT,
        num_rounds   INTEGER DEFAULT 4,
        points_win   INTEGER DEFAULT 2,
        points_tie   INTEGER DEFAULT 1,
        current_round INTEGER DEFAULT 1,
        advance_per_poule INTEGER DEFAULT 1,
        wildcards    INTEGER DEFAULT 0,
        status       TEXT DEFAULT 'setup',
        created_at   INTEGER
    )$eng");
    try { $pdo->exec("ALTER TABLE crok_event ADD COLUMN advance_per_poule INTEGER DEFAULT 1"); } catch (Throwable $e) {}
    try { $pdo->exec("ALTER TABLE crok_event ADD COLUMN wildcards INTEGER DEFAULT 0"); } catch (Throwable $e) {}
    try { $pdo->exec("ALTER TABLE crok_event ADD COLUMN api_key TEXT"); } catch (Throwable $e) {}
    try { $pdo->exec("ALTER TABLE crok_event ADD COLUMN bronze_final INTEGER DEFAULT 1"); } catch (Throwable $e) {}


    $pdo->exec("CREATE TABLE IF NOT EXISTS crok_poule (
        id        $pk,
        event_id  INTEGER,
        name      TEXT,
        tables    INTEGER DEFAULT 11,
        sort      INTEGER DEFAULT 0
    )$eng");

    $pdo->exec("CREATE TABLE IF NOT EXISTS crok_team (
        id         $pk,
        event_id   INTEGER,
        poule_id   INTEGER,
        number     INTEGER,
        name       TEXT,
        player1    TEXT,
        player2    TEXT,
        login_code TEXT,
        created_at INTEGER
    )$eng");
    // Additive migration for tables created before login_code existed.
    try { $pdo->exec("ALTER TABLE crok_team ADD COLUMN login_code TEXT"); } catch (Throwable $e) {}

    // ---- Season ranking (NCA Field-Weighted Points) — independent of tournaments ----
    $pdo->exec("CREATE TABLE IF NOT EXISTS crok_player (
        id         $pk,
        name       TEXT,
        created_at INTEGER
    )$eng");
    $pdo->exec("CREATE TABLE IF NOT EXISTS crok_snight (
        id         $pk,
        season     TEXT,
        name       TEXT,
        date       TEXT,
        host       TEXT,
        type       TEXT DEFAULT 'singles',
        field_size INTEGER,
        fsi        REAL,
        fdi        REAL,
        created_at INTEGER
    )$eng");
    $pdo->exec("CREATE TABLE IF NOT EXISTS crok_sresult (
        id         $pk,
        snight_id  INTEGER,
        player_id  INTEGER,
        position   INTEGER,
        fwp        REAL,
        created_at INTEGER
    )$eng");

    $pdo->exec("CREATE TABLE IF NOT EXISTS crok_match (
        id         $pk,
        event_id   INTEGER,
        poule_id   INTEGER,
        round      INTEGER,
        table_no   INTEGER,
        phys_table INTEGER,
        team_a_id  INTEGER,
        team_b_id  INTEGER,
        points_a   INTEGER,
        points_b   INTEGER,
        twenties_a INTEGER DEFAULT 0,
        twenties_b INTEGER DEFAULT 0,
        phase      TEXT DEFAULT 'poule',
        shootout_winner INTEGER,
        bracket    TEXT,
        match_code TEXT,
        sets_json  TEXT,
        status     TEXT DEFAULT 'pending',
        entered_at INTEGER,
        entered_by TEXT
    )$eng");
    foreach (['phase TEXT', 'shootout_winner INTEGER', 'bracket TEXT', 'match_code TEXT', 'sets_json TEXT',
              'phys_table INTEGER'] as $add) {
        try { $pdo->exec("ALTER TABLE crok_match ADD COLUMN $add"); } catch (Throwable $e) {}
    }
}

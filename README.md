# Crokinole Tournament — live scoring

A self-contained scoring app for a **2v2 fixed-team** crokinole tournament
(built for the NK format: poules of 11 tables, 4 preliminary rounds, NCA-style
match points). Players enter results on their phones, the standings update live
on a big screen.

Modelled visually on [croki.nl](https://croki.nl): warm cream, tan/gold accent,
Space Mono + Space Grotesk, the crokinole-board mark.

## Scoring

- **Win = 2**, **tie = 1**, **loss = 0** match points (configurable).
- Per match each side enters its **game score** and its number of **20's**.
- Standings rank by **match points → total 20's → point differential**.

## Three screens

| Page | Who | What |
|------|-----|------|
| `index.php` | Players (phone) | Pick your table for the current round, enter both teams' score + 20's. Needs the **table code**. |
| `board.php` | Big screen | Live poule standings + round, auto-refreshing every ~2.5s. |
| `admin.php` | Organizer | Create the event, add teams into poules, auto-generate the Swiss draw per round, advance rounds, correct scores. Needs the **organizer PIN**. |

Live updates use short polling — phones POST, the board polls. No websockets,
so it runs on any plain PHP host.

## Run with Docker

```bash
docker compose up --build
```

Then open **http://localhost:8085** (phone entry), `/board.php`, `/admin.php`.
Data is SQLite in the `crok_data` volume, so it survives restarts.

First run: open `/admin.php` → **Create tournament** (set a table code + organizer
PIN) → add poules (A, B…) → add the 44 teams → **Generate draw** for round 1 →
**Set as current round**. Players go to the root URL, board goes on the projector.

## Run without Docker (local dev)

```bash
php -S localhost:8085 -t public
```

Uses SQLite at `crok/data/crok.sqlite` (created automatically).

## Optional: MySQL instead of SQLite

Set `CROK_DB_DRIVER=mysql` plus `CROK_DB_HOST/NAME/USER/PASS` (see
`docker-compose.yml`). The same schema is created automatically.

## Layout

```
crok/
  public/           # web root (served)
    index.php       # phone score entry
    board.php       # big-screen standings
    admin.php       # organizer control panel
    api.php         # JSON API
    assets/         # style.css, board.css
  src/              # includes (not web-served)
    store.php       # PDO + schema
    logic.php       # standings + Swiss draw
    brand.php       # head + board logo
  Dockerfile
  docker-compose.yml
```

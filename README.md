# Crokinole tournament — live scoring

Scoring for a crokinole tournament, singles or 2v2 fixed teams. It runs on a
laptop in the hall: players enter results on their phones over the venue's wifi,
the standings go up on a projector, and nothing depends on the internet.

Built for the NK format — poules, four preliminary rounds, then a knockout — but
the field size, the number of rounds and how many teams go through are all set
per tournament.

## Scoring

A match is **four sets**. Each set is won by whoever scored more **in that set**
and is worth **2**, or **1 each** when the set is level. So a match hands out
eight points and a side can take anything from 0 to 8.

This is worth stating plainly because the obvious reading is wrong: **the match
is not decided by adding up the points scored.** A team that loses one set 5-80
and wins the other three 21-20 has scored 68 against 140, and wins the match 6-2.
Points scored decide a set and nothing else.

20's are recorded per set but never decide a set. In the poule table they
separate teams level on points, and head-to-head then settles first place. A
level knockout match goes to a shoot-out, first to two, and to sudden death if
that is still level.

## Screens

| Page | Who | What |
|---|---|---|
| `/` | Players, on a phone | Their match, one set at a time. Sign in with a team code, or open a single match with the code from the board. |
| `/board.php` | The projector | Poule standings, the knockout bracket, and what is on each table. Cycles by itself. |
| `/admin.php` | The organiser | Create the tournament, add teams, draw rounds, draw the knockout, correct anything. Needs the PIN. |
| `/season.php` | Anyone | The season ranking, on NCA Field-Weighted Points. |
| `/api-docs.php` | Integrators | The full API reference, with a Try it panel that calls this laptop. |

The board carries a QR code players scan to reach the scoring page. Give the
laptop a name on the network with `tools/announce-name.sh` and the board shows
`croki.local:8085` instead of an IP nobody can remember.

## Running it

**On a Mac, for an actual event**, use the app: `npm run dist` builds a `.dmg`
into `dist/`. It runs in the menu bar, starts the server, and puts the board and
the organiser screen a click away. Nobody needs Node or Docker installed.

The build is not signed yet, so the first open needs
System Settings → Privacy & Security → Open Anyway.

**From the source:**

```bash
npm install
npm start                 # http://localhost:8085
```

**With Docker:**

```bash
docker compose up --build
```

The database is SQLite, kept outside the app: in `~/Library/Application Support`
for the Mac app, in the `crok_data` volume under Docker, and at `CROK_DB_PATH`
otherwise.

## Setting up a tournament

Open `/admin.php`, create the tournament with an organiser PIN, add the poules,
add the teams, then draw round one. Players go to the address on the board.

## The API

Everything the pages do is a documented HTTP call, so a scoring machine can do
it too. `/api-docs.php` is the reference and `public/openapi.json` is the
machine-readable contract.

Two calls matter for automatic scoring: ask which match is at which table, then
send results back.

```bash
curl -H 'X-Api-Key: <event key>' http://croki.local:8085/api/ingest_tables

curl -X POST http://croki.local:8085/api/ingest_score \
  -H 'Content-Type: application/json' -H 'X-Api-Key: <event key>' \
  -d '{"table":7,"sets":[{"pa":21,"pb":20,"ta":1,"tb":0}],"complete":false,"source":"table-cam-2"}'
```

`table` is the table **in the hall**, one match per round, so a camera above it
needs to know nothing about poules. An automatic result goes through the same
path as one typed on a phone, so the jury can overrule either.

## Layout

```
src/
  api/         routes, scoring, draws, the JSON shapes
  core/        the rules: scoring, standings, Swiss draw, bracket, classification
  services/    database, page rendering, the season ranking
  config/      settings from the environment
  server.ts    entry point
public/        the pages and their assets, plus openapi.json
electron/      the Mac menu bar app
tools/         announce a name on the network, seed test data, migrations
test/          82 tests, run with node --test
```

## Checks

```bash
npm run check           # lint, typecheck, tests
npm run typecheck:app   # the Electron shell
```

No build step: Node 24 runs the TypeScript directly.

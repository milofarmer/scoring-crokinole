/**
 * Entry point: serve the tournament API and the pages from one local process.
 * Designed to run on a laptop at a venue, with phones joining over the Wi-Fi.
 */
import express from 'express';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config/index.ts';
import { openDatabase } from './services/db.ts';
import { createTournamentStore } from './services/tournament-store.ts';
import { createRouter } from './api/routes.ts';
import { createPageRenderer, pageNameFor } from './services/pages.ts';
import { createSeasonStore } from './services/season-store.ts';
import { createSeasonRouter, seasonActionHandlers } from './api/season-routes.ts';

/** Addresses a phone on the same network can actually reach. */
export function lanAddresses(): string[] {
  const found: string[] = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) found.push(entry.address);
    }
  }
  return found;
}

export function createApp(): express.Express {
  const config = loadConfig();
  const db = openDatabase(config.databasePath);
  const store = createTournamentStore(db);
  const pages = createPageRenderer({ publicDir: config.publicDir });
  const seasons = createSeasonStore(db);

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false }));

  const context = { config, store };
  const api = createRouter(context);
  const season = createSeasonRouter(context, seasons);
  const seasonActions = seasonActionHandlers(context, seasons);

  /**
   * Every call is one action, and there are two ways to name it. /api/state is
   * the form to use. api.php?action=state is what the pages and anything that
   * integrated earlier already send, so it is rewritten onto the same routes
   * rather than maintained twice.
   *
   * The action may be in the query string or in the body, because the pages send
   * it both ways. The query wins where both are present.
   *
   * What must not happen is a request routed by its path while claiming another
   * action in its body, so /api/<action> never consults the body at all. Only
   * this one endpoint, which has no action in its path, reads it.
   */
  app.all(/^\/api\.php$/, (req, res) => {
    const fromQuery = typeof req.query.action === 'string' ? req.query.action : '';
    const fromBody =
      typeof req.body === 'object' && req.body !== null && !Array.isArray(req.body)
        && typeof Reflect.get(req.body, 'action') === 'string'
        ? String(Reflect.get(req.body, 'action'))
        : '';
    const action = fromQuery || fromBody || 'state';
    if (!/^[a-z_][a-z0-9_]*$/i.test(action)) {
      res.status(404).json({ ok: false, error: `Unknown action: ${action}` });
      return;
    }
    // The season ranking is a separate router, so send its actions there.
    const seasonHandler = Object.hasOwn(seasonActions, action) ? seasonActions[action] : undefined;
    if (seasonHandler !== undefined) {
      seasonHandler(req, res);
      return;
    }
    req.url = `/${action}`;
    // If no route claims it, say the action is unknown. Falling through would
    // land on the page handler and answer an API call with HTML.
    api(req, res, () => {
      res.status(404).json({ ok: false, error: `Unknown action: ${action}` });
    });
  });

  app.use('/api', season);
  app.use('/api', api);

  /**
   * Pages are templates: the shared head, nav and logo are filled in per request
   * so a changed stylesheet is picked up without a restart. This has to come
   * before the static handler, or the raw template is served with its
   * placeholders showing.
   */
  app.get(/.*/, (req, res, next) => {
    const name = pageNameFor(req.path);
    if (name === null) return next();
    try {
      const page = pages.renderPage(name);
      res.set(page.headers);
      return res.send(page.html);
    } catch {
      return next();
    }
  });

  app.use(express.static(config.publicDir, { index: false }));

  // Anything else under /api is a call that does not exist, and should say so in
  // JSON rather than falling through to a page.
  app.use('/api', (_req, res) => res.status(404).json({ ok: false, error: 'Unknown action.' }));

  return app;
}

/* Only listen when this file is the program being run. Importing it — a test
   building an app on a throwaway port, for instance — must not quietly take the
   real one. */
const runningDirectly = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (runningDirectly) start();

function start(): void {
  const config = loadConfig();
  const app = createApp();

  const server = app.listen(config.port, () => {
  const urls = lanAddresses().map((address) => `http://${address}:${config.port}`);
  process.stdout.write(`Crokinole tournament running on port ${config.port}\n`);
    process.stdout.write(`  On this machine: http://localhost:${config.port}\n`);
    for (const url of urls) process.stdout.write(`  For phones:      ${url}\n`);
    process.stdout.write(`  Data file:       ${config.databasePath}\n`);
  });

/**
 * A busy port used to print "running on port N" and then exit silently, which
 * looks from the outside exactly like the app starting and then vanishing.
 * Say what happened instead.
 */
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      process.stderr.write(
        `Port ${config.port} is already in use, so the tournament could not start.\n` +
          '  Something else is on that port: another copy of this app, or Docker.\n' +
          '  Stop it, or start this one with a different PORT.\n',
      );
    } else {
      process.stderr.write(`The tournament server could not start: ${error.message}\n`);
    }
    process.exitCode = 1;
    server.close();
  });
}

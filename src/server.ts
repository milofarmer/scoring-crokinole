/**
 * Entry point: serve the tournament API and the pages from one local process.
 * Designed to run on a laptop at a venue, with phones joining over the Wi-Fi.
 */
import express from 'express';
import os from 'node:os';
import { loadConfig } from './config/index.ts';
import { openDatabase } from './services/db.ts';
import { createTournamentStore } from './services/tournament-store.ts';
import { createRouter } from './api/routes.ts';

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

  const app = express();
  app.use(express.json({ limit: '256kb' }));
  app.use('/api', createRouter({ config, store }));
  app.use(express.static(config.publicDir));
  return app;
}

const config = loadConfig();
const app = createApp();

app.listen(config.port, () => {
  const urls = lanAddresses().map((address) => `http://${address}:${config.port}`);
  process.stdout.write(`Crokinole tournament running on port ${config.port}\n`);
  process.stdout.write(`  On this machine: http://localhost:${config.port}\n`);
  for (const url of urls) process.stdout.write(`  For phones:      ${url}\n`);
  process.stdout.write(`  Data file:       ${config.databasePath}\n`);
});

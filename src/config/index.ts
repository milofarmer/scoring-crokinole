/** Runtime configuration, read once from the environment. */
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export interface AppConfig {
  readonly port: number;
  /** SQLite file. Kept outside the served directory. */
  readonly databasePath: string;
  /** Directory of static pages and assets. */
  readonly publicDir: string;
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readPort(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`PORT must be a number between 1 and 65535, got "${raw}"`);
  }
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: readPort(env.PORT, 8085),
    databasePath: env.CROK_DB_PATH ?? path.join(projectRoot, 'data', 'crok.sqlite'),
    publicDir: env.CROK_PUBLIC_DIR ?? path.join(projectRoot, 'public'),
  };
}

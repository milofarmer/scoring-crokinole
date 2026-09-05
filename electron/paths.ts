/**
 * Where the desktop shell finds the things it needs. A checkout and an installed
 * copy lay their files out differently, so every path is asked for here rather
 * than spelled out at each call site.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from 'electron';

const electronDir = path.dirname(fileURLToPath(import.meta.url));

export interface ServerPaths {
  /** Folder that holds src/ and public/. The server resolves its own files from here. */
  readonly root: string;
  readonly entry: string;
  readonly publicDir: string;
  readonly databasePath: string;
  /** Where the running server's process id is noted down between launches. */
  readonly pidFile: string;
}

export function serverPaths(): ServerPaths {
  // The server opens its pages and its database as ordinary files, and a path
  // inside the asar archive is not one. Packaging therefore leaves src/, public/
  // and node_modules beside the archive, in app.asar.unpacked.
  const root = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked')
    : path.resolve(electronDir, '..');

  return {
    root,
    entry: path.join(root, 'src', 'server.ts'),
    publicDir: path.join(root, 'public'),
    // A tournament in progress must survive an update, so results are kept in
    // the user's own data folder instead of inside the app bundle.
    databasePath: path.join(app.getPath('userData'), 'crok.sqlite'),
    pidFile: path.join(app.getPath('userData'), 'server.pid'),
  };
}

/** Icons stay inside the archive: Electron reads those through its own file layer. */
export function assetPath(name: string): string {
  return path.join(electronDir, 'assets', name);
}

/**
 * The served pages are mid-move from PHP to plain HTML, so ask the disk which
 * name is actually there instead of hard-coding one that may have been renamed.
 */
export function pageName(publicDir: string, candidates: readonly string[]): string {
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(publicDir, candidate))) return candidate;
  }
  return candidates[0] ?? '';
}

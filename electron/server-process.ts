/**
 * The tournament server, kept alive as a child process.
 *
 * The project runs TypeScript straight from source with no build step, so the
 * server needs a Node that strips types. Electron ships exactly such a Node: the
 * same binary, started through ELECTRON_RUN_AS_NODE, which saves asking the
 * organiser's machine to have a matching Node installed.
 */
import fs from 'node:fs';
import net from 'node:net';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import type { ServerPaths } from './paths.ts';

export type ServerStatus =
  | { readonly kind: 'starting' }
  | { readonly kind: 'running'; readonly addresses: readonly string[] }
  | { readonly kind: 'stopped'; readonly detail: string };

export interface ServerHandle {
  readonly status: () => ServerStatus;
  readonly restart: () => void;
  /** Ends the child, then calls back. Safe to call when nothing is running. */
  readonly stop: (done: () => void) => void;
}

/** How long a polite SIGTERM gets before the port is taken back by force. */
const STOP_GRACE_MS = 3000;

/** How many ports to try past the preferred one before giving up. */
const PORT_ATTEMPTS = 10;

function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '0.0.0.0');
  });
}

/**
 * The first port nothing else is sitting on.
 *
 * Without this the app looks broken rather than blocked: the server cannot bind,
 * dies, and every menu item greys out with no hint that something else has the
 * port. Plenty of laptops have something on 8085 already, and an organiser
 * setting up in a hall is in no position to go hunting for it. Moving over one
 * costs nothing, because the address players use is read off the running server
 * rather than assumed.
 */
export async function findFreePort(preferred: number): Promise<number> {
  for (let offset = 0; offset < PORT_ATTEMPTS; offset += 1) {
    const candidate = preferred + offset;
    if (candidate > 65535) break;
    if (await portIsFree(candidate)) return candidate;
  }
  // Nothing free nearby: use the preferred one so the failure names it.
  return preferred;
}

/** The server announces itself by printing the addresses it can be reached on. */
const URL_PATTERN = /https?:\/\/\S+/g;

function lastLine(text: string): string {
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  return lines[lines.length - 1]?.trim() ?? '';
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Blocks the thread. Only ever used at startup, before the menu bar item exists. */
function waitUntil(done: () => boolean, timeoutMs: number): void {
  const clock = new Int32Array(new SharedArrayBuffer(4));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (done()) return;
    Atomics.wait(clock, 0, 0, 50);
  }
}

/**
 * A force quit kills the shell outright, so it never gets to stop the server and
 * the orphan keeps the port. The child's process id is therefore written down,
 * and each launch clears out whatever the last one left behind.
 */
function reapPrevious(paths: ServerPaths): void {
  let pid = 0;
  try {
    pid = Number.parseInt(fs.readFileSync(paths.pidFile, 'utf8').trim(), 10);
  } catch {
    return;
  }
  if (!Number.isInteger(pid) || pid <= 1 || !isAlive(pid)) return;

  // A process id on its own proves nothing, since the system hands them out
  // again. Only kill something that is still running this very server.
  try {
    const command = execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' });
    if (!command.includes(paths.entry)) return;
  } catch {
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
    waitUntil(() => !isAlive(pid), STOP_GRACE_MS);
    if (isAlive(pid)) process.kill(pid, 'SIGKILL');
  } catch {
    // Gone between the check and the signal, which is the outcome we wanted.
  }
}

function rememberPid(paths: ServerPaths, pid: number | undefined): void {
  try {
    if (pid === undefined) fs.rmSync(paths.pidFile, { force: true });
    else fs.writeFileSync(paths.pidFile, String(pid));
  } catch {
    // Losing the note only costs the tidy-up above, so it is not worth a fuss.
  }
}

function exitDetail(code: number | null, signal: NodeJS.Signals | null, error: string): string {
  if (error !== '') return error;
  if (signal !== null) return `Stopped on signal ${signal}.`;
  return `Stopped with exit code ${code ?? 0}.`;
}

export function createServer(
  paths: ServerPaths,
  port: number,
  onChange: (status: ServerStatus) => void,
): ServerHandle {
  let child: ChildProcess | null = null;
  let status: ServerStatus = { kind: 'starting' };
  let addresses: string[] = [];
  let lastError = '';
  // Set while we are the ones ending the child, so a deliberate stop is not
  // reported as a crash.
  let stopping = false;

  function publish(next: ServerStatus): void {
    status = next;
    onChange(next);
  }

  function launch(): void {
    addresses = [];
    lastError = '';
    stopping = false;
    publish({ kind: 'starting' });

    reapPrevious(paths);

    const started = spawn(process.execPath, [paths.entry], {
      cwd: paths.root,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        PORT: String(port),
        CROK_PUBLIC_DIR: paths.publicDir,
        CROK_DB_PATH: paths.databasePath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child = started;
    rememberPid(paths, started.pid);

    started.stdout?.setEncoding('utf8');
    started.stdout?.on('data', (text: string) => {
      for (const match of text.matchAll(URL_PATTERN)) {
        if (!addresses.includes(match[0])) addresses.push(match[0]);
      }
      if (addresses.length > 0) publish({ kind: 'running', addresses: [...addresses] });
    });

    // Anything on stderr is the most useful thing to show if the server then
    // dies: a busy port, a database it cannot write.
    started.stderr?.setEncoding('utf8');
    started.stderr?.on('data', (text: string) => {
      const line = lastLine(text);
      if (line !== '') lastError = line;
    });

    started.on('error', (error: Error) => {
      child = null;
      publish({ kind: 'stopped', detail: error.message });
    });

    started.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      child = null;
      rememberPid(paths, undefined);
      if (stopping) return;
      publish({ kind: 'stopped', detail: exitDetail(code, signal, lastError) });
    });
  }

  function stop(done: () => void): void {
    const running = child;
    if (running === null || running.exitCode !== null) {
      done();
      return;
    }
    stopping = true;

    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done();
    };
    // A server that will not leave politely still has to let go of the port,
    // otherwise the next launch cannot bind it.
    const timer: NodeJS.Timeout = setTimeout(() => {
      running.kill('SIGKILL');
      finish();
    }, STOP_GRACE_MS);

    running.once('exit', finish);
    running.kill('SIGTERM');
  }

  launch();

  return {
    status: () => status,
    stop,
    restart: () => stop(launch),
  };
}

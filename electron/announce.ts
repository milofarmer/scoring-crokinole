/**
 * Give the tournament a name on the hall's network.
 *
 * Players otherwise have to type an address like 192.168.178.17:8085 off a
 * projector, which is both hard to read from the back of a room and different at
 * every venue. Announcing a name means they can type croki.local:8085 instead,
 * and it stays the same wherever the tournament is held.
 *
 * This is mDNS, the same mechanism that makes printers and speakers appear by
 * name. Nothing is configured on the router and there is no DNS server: the
 * laptop simply answers when a phone asks who croki.local is.
 *
 * It used to be a script the organiser had to remember to run and leave running.
 * Nobody remembers, so the app does it.
 *
 * Two things it deliberately does not do. It never fails loudly: if the name
 * cannot be announced the numeric address still works, and a tournament must not
 * be held up by a convenience. And it does not assume the address stays put — a
 * laptop that joins another network gets a new one, so the announcement is
 * remade rather than left pointing somewhere stale.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';

/** How often to notice the laptop has changed network. Cheap, so no reason to be lazy. */
const ADDRESS_CHECK_MS = 30_000;

export interface Announcement {
  /** The name players can type, or null when nothing could be announced. */
  readonly name: () => string | null;
  readonly stop: () => void;
}

/** The address of this laptop on the network the phones are on. */
export function currentAddress(): string | null {
  // Wi-Fi before anything else: at a venue the laptop is on the hall's wifi, and
  // a stray virtual interface would otherwise be announced instead.
  const named = os.networkInterfaces();
  const order = ['en0', 'en1', 'en2', ...Object.keys(named)];
  const seen = new Set<string>();

  for (const key of order) {
    if (seen.has(key)) continue;
    seen.add(key);
    for (const entry of named[key] ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address;
    }
  }
  return null;
}

/**
 * Announce `name`.local pointing at this laptop, and keep it pointing there.
 * Returns immediately; announcing happens in the background.
 */
export function announceName(options: { readonly name: string; readonly port: number }): Announcement {
  let child: ChildProcess | null = null;
  let announced: string | null = null;
  let address: string | null = null;
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  const stopChild = (): void => {
    if (child === null) return;
    const running = child;
    child = null;
    running.removeAllListeners();
    running.kill('SIGTERM');
  };

  const announce = (): void => {
    const found = currentAddress();
    if (found === null || found === address) return;   // nothing to say, or nothing changed
    address = found;
    stopChild();

    // dns-sd -P registers a proxy record: this name, at this address.
    const started = spawn(
      'dns-sd',
      ['-P', options.name, '_http._tcp', 'local', String(options.port), `${options.name}.local`, found],
      { stdio: 'ignore' },
    );

    started.on('error', () => {
      // No dns-sd, which means this is not a Mac, or it is unavailable. The
      // numeric address still works, so there is nothing worth saying.
      child = null;
      announced = null;
    });
    started.on('exit', () => {
      if (child === started) { child = null; announced = null; }
    });

    child = started;
    announced = `${options.name}.local:${options.port}`;
  };

  announce();
  timer = setInterval(() => { if (!stopped) announce(); }, ADDRESS_CHECK_MS);

  return {
    name: () => announced,
    stop: () => {
      stopped = true;
      if (timer !== null) clearInterval(timer);
      timer = null;
      stopChild();
      announced = null;
    },
  };
}

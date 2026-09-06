/**
 * The addresses this machine can be reached on.
 *
 * Kept apart from the server entry point so a route can ask for them without
 * importing the thing that starts a listener.
 */
import os from 'node:os';

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

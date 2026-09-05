/**
 * Update checks against the project's GitHub releases.
 *
 * Two rules shape all of this.
 *
 * Nothing installs itself. An unsigned build cannot replace itself on macOS
 * without tripping Gatekeeper, so a found update sends the organiser to the
 * releases page. Once the build is signed and notarised, autoDownload can be
 * turned back on and this becomes a real in-place update.
 *
 * And nothing interrupts a tournament. This laptop is driving a projector in a
 * hall. A dialog taking focus during a final is worse than the update being
 * missed altogether, so while an event is running a waiting update only changes
 * a line in the menu. It gets to ask properly once the hall has gone home.
 */
import electronUpdater from 'electron-updater';
import { app, dialog, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { decideUpdateAction, describeUpdateError } from './update-policy.ts';

const RELEASES_URL = 'https://github.com/milofarmer/scoring-crokinole/releases';

/** Long enough not to compete with starting the server on a cold launch. */
const FIRST_CHECK_MS = 45_000;
/** A tournament lasts a day. Checking four times in one is plenty. */
const REPEAT_CHECK_MS = 6 * 60 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Is an event actually being played right now?
 *
 * Asked of the running server rather than tracked here, because the server is
 * the one that knows. Any doubt counts as yes: a missed notification costs
 * nothing, and a dialog over the big screen during a final costs a lot.
 */
async function tournamentIsLive(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/state`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return true;
    const parsed: unknown = await response.json();
    if (!isRecord(parsed)) return true;
    if (parsed.event === null) return false;
    if (!isRecord(parsed.event)) return true;
    return parsed.event.status === 'running';
  } catch {
    return true;
  }
}

/** The version waiting on the releases page, or null when this copy is current. */
async function findUpdate(): Promise<string | null> {
  const { autoUpdater } = electronUpdater;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  const result = await autoUpdater.checkForUpdates();
  if (result === null) return null;
  const newest = result.updateInfo.version;
  return newest === app.getVersion() ? null : newest;
}

/**
 * Which version the organiser has already said no to, so a restart does not
 * ask again about the same one. Kept beside the database rather than in the app
 * bundle, which an update replaces wholesale.
 */
function declinedFile(): string {
  return path.join(app.getPath('userData'), 'declined-update.json');
}

function readDeclined(): string | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(declinedFile(), 'utf8'));
    if (!isRecord(parsed)) return null;
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

function rememberDeclined(version: string): void {
  try {
    fs.writeFileSync(declinedFile(), JSON.stringify({ version }), 'utf8');
  } catch {
    // Being unable to note this down only means asking again next time.
  }
}

async function offer(version: string): Promise<void> {
  const answer = await dialog.showMessageBox({
    type: 'info',
    message: `Version ${version} is available.`,
    detail:
      'Installing from here needs a signed build, so download it from the releases page for now.',
    buttons: ['Open releases page', 'Not now'],
    defaultId: 0,
    cancelId: 1,
  });
  if (answer.response === 0) await shell.openExternal(RELEASES_URL);
  else rememberDeclined(version);
}

export interface UpdateWatcher {
  /** From the menu. The organiser asked, so it always answers. */
  readonly checkNow: () => void;
  /** The version waiting, for the menu to mention. */
  readonly pending: () => string | null;
  readonly stop: () => void;
}

/**
 * Checks shortly after launch and every few hours after that, and tells the menu
 * when something is waiting.
 */
export function createUpdateWatcher(options: {
  readonly port: number;
  readonly onChange: () => void;
}): UpdateWatcher {
  let pending: string | null = null;
  let timer: NodeJS.Timeout | null = null;
  let firstTimer: NodeJS.Timeout | null = null;
  let checking = false;

  const quietCheck = async (): Promise<void> => {
    if (checking || !app.isPackaged) return;
    checking = true;
    try {
      const version = await findUpdate();
      if (version === null) {
        if (pending !== null) {
          pending = null;
          options.onChange();
        }
        return;
      }

      if (version !== pending) {
        pending = version;
        options.onChange();   // the menu says so from here on, whatever happens next
      }

      const action = decideUpdateAction({
        version,
        tournamentLive: await tournamentIsLive(options.port),
        declined: readDeclined(),
        askedFor: false,
      });
      if (action.kind === 'offer') await offer(action.version);
    } catch {
      // Offline, or no release published yet. Neither is worth interrupting
      // anyone over on a check they did not ask for.
    } finally {
      checking = false;
    }
  };

  const checkNow = async (): Promise<void> => {
    if (!app.isPackaged) {
      await dialog.showMessageBox({
        type: 'info',
        message: 'Update checks only run in an installed copy.',
        detail: 'This is running from the project folder, so there is nothing to update.',
        buttons: ['OK'],
      });
      return;
    }
    try {
      const version = await findUpdate();
      if (version === null) {
        pending = null;
        options.onChange();
        await dialog.showMessageBox({
          type: 'info',
          message: `Crokinole Tournament ${app.getVersion()} is up to date.`,
          buttons: ['OK'],
        });
        return;
      }
      pending = version;
      options.onChange();
      // Asked for deliberately, so answer even mid-tournament.
      await offer(version);
    } catch (error) {
      await dialog.showMessageBox({
        type: 'warning',
        message: 'Could not check for updates.',
        detail: `${describeUpdateError(error)}\n\nThis is normal without a network connection, or before the first release is published.`,
        buttons: ['OK'],
      });
    }
  };

  firstTimer = setTimeout(() => void quietCheck(), FIRST_CHECK_MS);
  timer = setInterval(() => void quietCheck(), REPEAT_CHECK_MS);

  return {
    checkNow: () => void checkNow(),
    pending: () => pending,
    stop: () => {
      // A live timer keeps the process alive and would stop the app quitting.
      if (firstTimer !== null) clearTimeout(firstTimer);
      if (timer !== null) clearInterval(timer);
      firstTimer = null;
      timer = null;
    },
  };
}

/**
 * The macOS shell: a menu bar item and nothing else.
 *
 * There is deliberately no application window. The three screens are already web
 * pages meant for a projector, a laptop and a pile of phones, so they open in the
 * default browser; the app's job is to keep the server up and hand out the link.
 */
import { Tray, app, clipboard, nativeImage, shell } from 'electron';
import { assetPath, pageName, serverPaths, type ServerPaths } from './paths.ts';
import { createServer, findFreePort, type ServerHandle, type ServerStatus } from './server-process.ts';
import { buildMenu } from './tray-menu.ts';
import { createUpdateWatcher, type UpdateWatcher } from './updates.ts';

/** Matches the server's own default, so the links here point where it listens. */
const DEFAULT_PORT = 8085;

/**
 * Page file names, most wanted first. The served pages are being moved from PHP
 * to plain HTML, so each screen lists both and the first one on disk wins.
 */
const BOARD_PAGE = ['board.html', 'board.php'] as const;
const ORGANISER_PAGE = ['admin.html', 'admin.php'] as const;
const SCORE_ENTRY_PAGE = ['index.html', 'index.php'] as const;

function readPort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_PORT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return DEFAULT_PORT;
  return parsed;
}

/**
 * What a phone should type in. The server prints localhost first, but that is no
 * use to anyone else in the hall, so prefer an address on the network.
 */
function joinAddress(status: ServerStatus): string | null {
  if (status.kind !== 'running') return null;
  const local = /\/\/(localhost|127\.0\.0\.1)[:/]/;
  return status.addresses.find((url) => !local.test(url)) ?? status.addresses[0] ?? null;
}

// Held at module level: a Tray that goes out of scope is collected, and the
// menu bar item silently disappears with it.
let tray: Tray | null = null;
let shuttingDown = false;

async function start(): Promise<void> {
  // Step past anything already using the preferred port rather than failing.
  const port = await findFreePort(readPort(process.env.PORT));
  const paths: ServerPaths = serverPaths();

  const pages = {
    board: pageName(paths.publicDir, BOARD_PAGE),
    organiser: pageName(paths.publicDir, ORGANISER_PAGE),
    scoreEntry: pageName(paths.publicDir, SCORE_ENTRY_PAGE),
  };

  // Opening on this machine, so localhost is the right address even when the
  // laptop's network address changes mid-tournament.
  const openPage = (page: string): void => {
    void shell.openExternal(`http://localhost:${port}/${page}`);
  };

  const icon = nativeImage.createFromPath(assetPath('trayTemplate.png'));
  icon.setTemplateImage(true); // so it inverts with a light or dark menu bar

  const item = new Tray(icon);
  item.setToolTip('Crokinole Tournament');
  tray = item;

  let server: ServerHandle | null = null;
  let updates: UpdateWatcher | null = null;
  let lastStatus: ServerStatus | null = null;

  const refresh = (status: ServerStatus): void => {
    lastStatus = status;
    const address = joinAddress(status);
    item.setContextMenu(
      buildMenu({ status, joinAddress: address, pendingUpdate: updates?.pending() ?? null }, {
        openBoard: () => openPage(pages.board),
        openOrganiser: () => openPage(pages.organiser),
        openScoreEntry: () => openPage(pages.scoreEntry),
        // The address phones need is the one on the network, not localhost.
        copyJoinAddress: () => {
          if (address !== null) clipboard.writeText(address);
        },
        restartServer: () => server?.restart(),
        checkForUpdates: () => updates?.checkNow(),
        quit: () => app.quit(),
      }),
    );
  };

  server = createServer(paths, port, refresh);
  // Redraw the menu when an update turns up, so the new line appears without
  // waiting for the server's status to change.
  updates = createUpdateWatcher({
    port,
    onChange: () => { if (lastStatus !== null) refresh(lastStatus); },
  });
  refresh(server.status());

  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    // Take the menu bar item away at once, so quitting looks immediate even
    // though the server needs a moment to let go.
    tray?.destroy();
    tray = null;
    // A pending timer would keep the process alive after the window is gone.
    updates?.stop();
    updates = null;
    // Quitting while the child still holds the port would leave the next launch
    // unable to bind it, so wait for the server to be gone before leaving.
    server?.stop(() => app.quit());
  };

  app.on('before-quit', (event) => {
    if (shuttingDown) return;
    event.preventDefault();
    shutdown();
  });

  // A terminal-launched copy gets these instead of before-quit.
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Two copies would fight over the port, and the second would look broken.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void app.whenReady().then(() => {
    // No dock icon: this lives in the menu bar.
    app.dock?.hide();
    void start();
  });
}

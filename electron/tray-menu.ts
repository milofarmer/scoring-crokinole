/**
 * The dropdown behind the menu bar item. It is rebuilt from scratch on every
 * status change, because a menu is cheap and keeping items in sync by hand is
 * where this kind of code usually goes wrong.
 */
import { Menu, type MenuItemConstructorOptions } from 'electron';
import type { ServerStatus } from './server-process.ts';

export interface MenuActions {
  readonly openBoard: () => void;
  readonly openOrganiser: () => void;
  readonly openScoreEntry: () => void;
  readonly copyJoinAddress: () => void;
  readonly restartServer: () => void;
  readonly checkForUpdates: () => void;
  readonly quit: () => void;
}

/** The line at the top: is it up, and what do the phones type in. */
function statusItems(status: ServerStatus, joinAddress: string | null, actions: MenuActions): MenuItemConstructorOptions[] {
  if (status.kind === 'starting') {
    return [{ label: 'Starting the server', enabled: false }];
  }
  if (status.kind === 'running') {
    return [
      {
        label: 'Server running',
        sublabel: joinAddress ?? 'no network address yet',
        enabled: false,
      },
    ];
  }
  return [
    { label: 'Server stopped', sublabel: status.detail, enabled: false },
    { label: 'Restart server', click: actions.restartServer },
  ];
}

export function buildMenu(status: ServerStatus, joinAddress: string | null, actions: MenuActions): Menu {
  const running = status.kind === 'running';

  const template: MenuItemConstructorOptions[] = [
    ...statusItems(status, joinAddress, actions),
    { type: 'separator' },
    { label: 'Open board', enabled: running, click: actions.openBoard },
    { label: 'Open organiser screen', enabled: running, click: actions.openOrganiser },
    { label: 'Open score entry', enabled: running, click: actions.openScoreEntry },
    { label: 'Copy join address', enabled: joinAddress !== null, click: actions.copyJoinAddress },
    { type: 'separator' },
    { label: 'Check for updates…', click: actions.checkForUpdates },
    { label: 'Quit', accelerator: 'Command+Q', click: actions.quit },
  ];

  return Menu.buildFromTemplate(template);
}

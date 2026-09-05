/**
 * Update checks against the GitHub releases of the project.
 *
 * Nothing installs itself yet: an unsigned build cannot replace itself on macOS
 * without tripping Gatekeeper, so a found update sends the organiser to the
 * releases page. Once the build is signed and notarised, autoDownload can be
 * turned back on and this becomes a real in-place update.
 */
import electronUpdater from 'electron-updater';
import { app, dialog, shell } from 'electron';

const RELEASES_URL = 'https://github.com/milofarmer/scoring-crokinole/releases';

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged) {
    await dialog.showMessageBox({
      type: 'info',
      message: 'Update checks only run in an installed copy.',
      detail: 'This is running from the project folder, so there is nothing to update.',
      buttons: ['OK'],
    });
    return;
  }

  const { autoUpdater } = electronUpdater;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  try {
    const result = await autoUpdater.checkForUpdates();
    const newest = result === null ? app.getVersion() : result.updateInfo.version;

    if (newest === app.getVersion()) {
      await dialog.showMessageBox({
        type: 'info',
        message: `Crokinole Tournament ${app.getVersion()} is up to date.`,
        buttons: ['OK'],
      });
      return;
    }

    const answer = await dialog.showMessageBox({
      type: 'info',
      message: `Version ${newest} is available.`,
      detail: 'Installing it from here needs a signed build, so download it from the releases page for now.',
      buttons: ['Open releases page', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    if (answer.response === 0) await shell.openExternal(RELEASES_URL);
  } catch (error) {
    // Offline, or no release published yet. Neither is worth an alarming dialog.
    await dialog.showMessageBox({
      type: 'warning',
      message: 'Could not check for updates.',
      detail: `${describe(error)}\n\nThis is normal without a network connection, or before the first release is published.`,
      buttons: ['OK'],
    });
  }
}

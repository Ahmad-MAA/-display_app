import type { BrowserWindow } from 'electron';
import { RestartBudget } from '@shared/recovery';
import { log } from './log';

/**
 * Keeps a renderer alive: logs hangs and load failures, and reloads the page when its
 * process dies (GPU driver reset, out of memory, a crash in capture code). At most three
 * reloads a minute; after that `onGaveUp` is told and the window is left as it is.
 */
export function guardRenderer(
  win: BrowserWindow,
  name: string,
  reload: () => Promise<void>,
  hooks: { onReloaded: () => void; onGaveUp: (reason: string) => void },
): void {
  const budget = new RestartBudget(3, 60_000);
  const wc = win.webContents;
  wc.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit' || win.isDestroyed()) return;
    const what = `${name} renderer stopped (${details.reason}, exit code ${details.exitCode})`;
    if (!budget.tryConsume(Date.now())) {
      log('error', `${what}; it crashed 3 times within a minute, not reloading again`);
      hooks.onGaveUp(`${what}. It kept crashing, so ProjectorDesk stopped reloading it.`);
      return;
    }
    log('error', `${what}; reloading`);
    reload().then(
      () => {
        log('info', `${name} reloaded after a crash`);
        hooks.onReloaded();
      },
      (err: unknown) => {
        log('error', `${name} could not be reloaded: ${String(err)}`);
        hooks.onGaveUp(`${what} and could not be reloaded.`);
      },
    );
  });
  wc.on('unresponsive', () => {
    log('warn', `${name} is not responding`);
  });
  wc.on('responsive', () => {
    log('info', `${name} is responding again`);
  });
  wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
    if (isMainFrame) log('error', `${name} failed to load ${url}: ${description} (${code})`);
  });
  wc.on('preload-error', (_e, path, err) => {
    log('error', `${name} preload ${path} failed: ${err.message}`);
  });
}

import { globalShortcut } from 'electron';
import { DEFAULT_HOTKEYS, type HotkeyStatus, type PresenterAction } from '@shared/controls';
import { log } from './log';

/**
 * System-wide hotkeys (RegisterHotKey under the hood): they fire while another app has
 * focus and do NOT move focus, so a player stays in its own full screen while the
 * presenter switches sources. Registered only while running; unregistered on quit.
 */
export function registerHotkeys(run: (a: PresenterAction) => void): HotkeyStatus[] {
  const status: HotkeyStatus[] = [];
  for (const h of DEFAULT_HOTKEYS) {
    let registered = false;
    try {
      registered = globalShortcut.register(h.global, () => {
        run(h.action);
      });
    } catch (err) {
      log('warn', `Hotkey ${h.global} invalid: ${String(err)}`);
    }
    if (!registered) {
      log(
        'warn',
        `Hotkey ${h.global} (${h.label}) is already used by another app; use the button or Control Panel key instead`,
      );
    }
    status.push({ action: h.action, accelerator: h.global, registered });
  }
  log(
    'info',
    `Global hotkeys: ${status.filter((s) => s.registered).length}/${status.length} registered`,
  );
  return status;
}

export function unregisterHotkeys(): void {
  globalShortcut.unregisterAll();
}

import { globalShortcut } from 'electron';
import { DEFAULT_HOTKEYS, type HotkeyStatus, type PresenterAction } from '@shared/controls';
import { log } from './log';

/**
 * System-wide hotkeys (RegisterHotKey under the hood): they fire while another app has
 * focus and do NOT move focus, so a player stays in its own full screen while the
 * presenter switches sources. Registered only while running; unregistered on quit.
 * Re-registering (after editing them in Settings) replaces the previous set.
 */
export function registerHotkeys(
  accelerators: Record<PresenterAction, string>,
  run: (a: PresenterAction) => void,
): HotkeyStatus[] {
  globalShortcut.unregisterAll();
  const status: HotkeyStatus[] = [];
  const used = new Set<string>();
  for (const h of DEFAULT_HOTKEYS) {
    const acc = accelerators[h.action] || h.global;
    let registered = false;
    if (used.has(acc.toLowerCase())) {
      log('warn', `Hotkey ${acc} is assigned to more than one action; ${h.label} skipped`);
    } else {
      used.add(acc.toLowerCase());
      try {
        registered = globalShortcut.register(acc, () => {
          run(h.action);
        });
      } catch (err) {
        log('warn', `Hotkey ${acc} is not a valid combination: ${String(err)}`);
      }
      if (!registered) {
        log(
          'warn',
          `Hotkey ${acc} (${h.label}) couldn't be registered (used by another app or invalid); use the button or Control Panel key instead`,
        );
      }
    }
    status.push({ action: h.action, accelerator: acc, registered });
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

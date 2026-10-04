import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { screen } from 'electron';
import type { ExtendResult } from '@shared/diagnostics';
import { log } from './log';

const WAIT_MS = 6000;
const POLL_MS = 250;

function run(exe: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(exe, args, { windowsHide: true, timeout: 10_000 }, (err) => {
      if (err) reject(new Error(err.message));
      else resolve();
    });
  });
}

async function waitForExtended(ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (screen.getAllDisplays().length >= 2) return true;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return screen.getAllDisplays().length >= 2;
}

/**
 * Switch Windows to "Extend" (same as Win+P → Extend). DisplaySwitch returns before
 * the mode change completes, so poll until a second display shows up.
 * Some builds ignore "/extend" but accept the legacy numeric form ("3" = extend).
 */
export async function extendDisplays(): Promise<ExtendResult> {
  if (process.platform !== 'win32') {
    return {
      ok: false,
      displayCount: screen.getAllDisplays().length,
      message: 'Switching to Extend is only available on Windows.',
    };
  }
  const exe = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'DisplaySwitch.exe');
  for (const args of [['/extend'], ['3']]) {
    try {
      log('info', `Running DisplaySwitch.exe ${args.join(' ')}`);
      await run(exe, args);
    } catch (err) {
      // Non-zero exit codes don't reliably mean failure; still wait for the mode change.
      log('warn', `DisplaySwitch.exe ${args.join(' ')} reported: ${String(err)}`);
    }
    if (await waitForExtended(WAIT_MS)) {
      const count = screen.getAllDisplays().length;
      log('info', `Extend mode active: ${count} displays`);
      return { ok: true, displayCount: count, message: `Extended: ${count} displays detected.` };
    }
  }
  const count = screen.getAllDisplays().length;
  log('warn', 'Extend did not produce a second display');
  return {
    ok: false,
    displayCount: count,
    message:
      'Windows did not report a second display. Check the projector cable/input, then press Win+P → Extend.',
  };
}

import type { BrowserWindow } from 'electron';
import type { ContentProtectionStatus } from '@shared/diagnostics';

/** WDA_EXCLUDEFROMCAPTURE needs Windows 10 version 2004 (build 19041) or newer. */
const MIN_EXCLUDE_BUILD = 19041;

function windowsBuild(): number | null {
  if (process.platform !== 'win32') return null;
  const parts = process.getSystemVersion().split('.');
  const build = Number(parts[2]);
  return Number.isFinite(build) ? build : null;
}

/** Must be called right after the Output window is created and BEFORE it is shown. */
export function applyContentProtection(win: BrowserWindow): ContentProtectionStatus {
  win.setContentProtection(true);
  return checkContentProtection(win, true);
}

export function checkContentProtection(
  win: BrowserWindow,
  requested: boolean,
): ContentProtectionStatus {
  const build = windowsBuild();
  const reportedByElectron = win.isContentProtected();
  let osSupportsExclusion: boolean;
  if (process.platform === 'win32')
    osSupportsExclusion = build !== null && build >= MIN_EXCLUDE_BUILD;
  else if (process.platform === 'darwin') osSupportsExclusion = true;
  else osSupportsExclusion = false;

  const ok = requested && reportedByElectron && osSupportsExclusion;
  let message: string;
  if (ok) {
    message = 'Output window is excluded from screen capture (no recursive mirror).';
  } else if (!reportedByElectron) {
    message =
      'Content protection could not be enabled on the Output window. Capturing the projector screen will produce a recursive mirror.';
  } else if (process.platform === 'win32') {
    message = `Windows build ${build ?? 'unknown'} only blacks out protected windows (needs 19041 / Windows 10 2004+). Capturing the projector screen will produce a recursive black mirror; "Entire Screen" of the projector display will be disabled.`;
  } else {
    message = `Content protection is not supported on ${process.platform}. "Entire Screen" of the projector display will be disabled.`;
  }

  return {
    platform: process.platform,
    osVersion: process.getSystemVersion(),
    windowsBuild: build,
    requested,
    reportedByElectron,
    osSupportsExclusion,
    ok,
    message,
  };
}

/**
 * "Something is covering the projector": another app's window above our Output window on
 * the projector display. Typical cause: a WPS / PowerPoint slide show with Presenter View,
 * which puts the slide show TOPMOST on the second monitor, so the audience sees it instead
 * of what's picked in ProjectorDesk. Pure filtering; the window helper does the z-order walk.
 */
import type { WinInfo } from './follow';

export interface CoveringWindow {
  hwnd: string;
  title: string;
  processName: string | null;
  topmost: boolean;
  fullscreen: boolean;
  /** % of the projector display covered. */
  coverage: number;
}

/** Shell surfaces that legitimately sit above everything (taskbars, Start, desktop). */
const SHELL_CLASSES = new Set([
  'Shell_TrayWnd',
  'Shell_SecondaryTrayWnd',
  'Progman',
  'WorkerW',
  'Windows.UI.Core.CoreWindow',
  'NotifyIconOverflowWindow',
  'TopLevelWindowForOverflowXamlIsland',
  'XamlExplorerHostIslandWindow',
  'MultitaskingViewFrame',
  'ForegroundStaging',
]);

export function relevantCovering(
  list: readonly WinInfo[],
  ownHwnds: ReadonlySet<string>,
): CoveringWindow[] {
  return list
    .filter((w) => !ownHwnds.has(w.hwnd) && !SHELL_CLASSES.has(w.className))
    .map((w) => ({
      hwnd: w.hwnd,
      title: w.title || w.className,
      processName: w.processName,
      topmost: w.topmost,
      fullscreen: w.fullscreen,
      coverage: w.coverage,
    }));
}

export function coveringKey(list: readonly CoveringWindow[]): string {
  return list
    .map((w) => w.hwnd)
    .sort()
    .join(',');
}

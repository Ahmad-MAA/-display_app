/**
 * "Follow full screen": some apps don't go full screen in the window you projected.
 * Windows Media Player, VLC and PowerPoint's slide show open a separate full-screen
 * window (WMP even hides its main window), so a window capture loses the content.
 * While a window is projected, main polls the window helper and, when the same process
 * shows a full-screen window, captures that instead, then switches back when it closes.
 * Pure decision logic lives here so it can be unit-tested.
 */
import type { Rect } from './displays';

/** One top-level window as reported by the window helper (physical pixels). */
export interface WinInfo {
  hwnd: string;
  pid: number;
  processName: string | null;
  title: string;
  className: string;
  exists: boolean;
  visible: boolean;
  minimized: boolean;
  maximized: boolean;
  cloaked: boolean;
  owned: boolean;
  fullscreen: boolean;
  /** WS_EX_TOPMOST: stays above normal windows (incl. our Output). */
  topmost: boolean;
  /** Covering op only: % of the projector monitor this window covers. */
  coverage: number;
  /** WS_EX_LAYERED / WS_EX_TRANSPARENT / WS_EX_TOOLWINDOW / WS_EX_NOACTIVATE. */
  layered: boolean;
  transparent: boolean;
  toolWindow: boolean;
  noActivate: boolean;
  /** Raw extended style, for diagnostics. */
  exStyle: string;
  rect: Rect | null;
  monitor: Rect | null;
}

/** Full-screen windows that must never be followed. */
const IGNORED_CLASSES = new Set([
  'PodiumParent', // PowerPoint Presenter View (notes screen); follow the slide show instead
  'Progman',
  'WorkerW',
  'Shell_TrayWnd',
]);

export type FollowDecision = { kind: 'primary' } | { kind: 'window'; win: WinInfo };

/**
 * What should be captured right now for a projected window `target`.
 * - target itself is full screen (Chrome/Edge/YouTube) → keep capturing it.
 * - another full-screen window of the same process exists → follow it (keep the one
 *   already followed if it's still there, else the topmost).
 * - otherwise → the window the presenter picked.
 */
export function chooseFollow(
  target: WinInfo,
  fullscreen: readonly WinInfo[],
  currentHwnd: string | null,
): FollowDecision {
  if (!target.exists || target.fullscreen) return { kind: 'primary' };
  const candidates = fullscreen.filter(
    (w) =>
      w.exists &&
      w.fullscreen &&
      w.hwnd !== target.hwnd &&
      w.pid === target.pid &&
      !IGNORED_CLASSES.has(w.className),
  );
  if (candidates.length === 0) return { kind: 'primary' };
  const current = candidates.find((w) => w.hwnd === currentHwnd);
  // Prefer real content windows over full-screen overlays (e.g. a player's transparent,
  // click-through controls bar): stable sort keeps z-order among equals.
  const best = [...candidates].sort((a, b) => overlayScore(a) - overlayScore(b))[0];
  if (current && best && overlayScore(current) <= overlayScore(best)) {
    return { kind: 'window', win: current };
  }
  return best ? { kind: 'window', win: best } : { kind: 'primary' };
}

/** Lower = more likely the real content window. */
export function overlayScore(w: WinInfo): number {
  return (
    (w.transparent ? 8 : 0) + (w.layered ? 4 : 0) + (w.toolWindow ? 2 : 0) + (w.noActivate ? 1 : 0)
  );
}

export function decisionKey(d: FollowDecision): string {
  return d.kind === 'window' ? `window:${d.win.hwnd}` : 'primary';
}

/**
 * Commits a decision only after it was seen `needed` times in a row, so full-screen
 * enter/exit animations and transient windows don't cause back-and-forth switching.
 */
export class Stabilizer {
  private pendingKey: string | null = null;
  private count = 0;
  private committedKey = 'primary';

  constructor(private readonly needed = 2) {}

  /** Returns true when `key` has just become the committed decision. */
  push(key: string): boolean {
    if (key === this.committedKey) {
      this.pendingKey = null;
      this.count = 0;
      return false;
    }
    if (key === this.pendingKey) this.count++;
    else {
      this.pendingKey = key;
      this.count = 1;
    }
    if (this.count >= this.needed) {
      this.committedKey = key;
      this.pendingKey = null;
      this.count = 0;
      return true;
    }
    return false;
  }

  reset(): void {
    this.pendingKey = null;
    this.count = 0;
    this.committedKey = 'primary';
  }
}

/** One line per window for the diagnostics log. */
export function describeWindows(list: readonly WinInfo[]): string {
  return list
    .map((w) => {
      const flags = [
        w.visible ? 'visible' : 'hidden',
        w.minimized && 'minimized',
        w.maximized && 'maximized',
        w.cloaked && 'cloaked',
        w.owned && 'owned',
        w.fullscreen && 'FULLSCREEN',
        w.topmost && 'topmost',
        w.layered && 'layered',
        w.transparent && 'transparent',
        w.toolWindow && 'tool',
        w.noActivate && 'noactivate',
        w.exStyle && `ex=${w.exStyle}`,
      ]
        .filter(Boolean)
        .join(',');
      const r = w.rect ? `${w.rect.width}×${w.rect.height}@(${w.rect.x},${w.rect.y})` : '?';
      return `${w.hwnd} [${w.className}] "${w.title.slice(0, 50)}" ${r} ${flags}`;
    })
    .join(' | ');
}

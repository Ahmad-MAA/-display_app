/** Presenter controls (step 6) and their hotkeys. */

export interface PresenterControls {
  /** Output shows black; capture keeps running underneath. */
  blank: boolean;
  /** Output holds the current frame (video paused). Reset when the source changes. */
  freeze: boolean;
  /** Include the mouse cursor in the capture (needs a capture restart to change). */
  cursor: boolean;
  /** Stats overlay drawn on the Output. */
  statsOverlay: boolean;
}

export const DEFAULT_CONTROLS: PresenterControls = {
  blank: false,
  freeze: false,
  cursor: true,
  statsOverlay: false,
};

export type PresenterAction =
  'blank' | 'freeze' | 'cursor' | 'fill-cycle' | 'stats' | 'next' | 'prev' | 'hide-output';

export interface HotkeyBinding {
  action: PresenterAction;
  /** Global (system-wide) accelerator, Electron syntax. Works while other apps have focus. */
  global: string;
  /** Key(s) that work while the Control Panel is focused. */
  local: string;
  label: string;
}

/**
 * Global hotkeys use Ctrl+Alt: a global plain "B" would steal that letter from every app
 * the presenter types in. Next/previous use PageDown/PageUp, not arrows: many Intel
 * graphics drivers rotate the screen on Ctrl+Alt+Arrow. Configurable in step 7.
 */
export const DEFAULT_HOTKEYS: readonly HotkeyBinding[] = [
  { action: 'blank', global: 'CommandOrControl+Alt+B', local: 'B', label: 'Blank (black screen)' },
  { action: 'freeze', global: 'CommandOrControl+Alt+F', local: 'F', label: 'Freeze frame' },
  {
    action: 'fill-cycle',
    global: 'CommandOrControl+Alt+M',
    local: 'M',
    label: 'Fill mode: Fit → Fill → Stretch',
  },
  { action: 'stats', global: 'CommandOrControl+Alt+S', local: 'S', label: 'Stats overlay' },
  { action: 'cursor', global: 'CommandOrControl+Alt+C', local: 'C', label: 'Show / hide cursor' },
  {
    action: 'next',
    global: 'CommandOrControl+Alt+PageDown',
    local: 'Ctrl+→',
    label: 'Next source',
  },
  {
    action: 'prev',
    global: 'CommandOrControl+Alt+PageUp',
    local: 'Ctrl+←',
    label: 'Previous source',
  },
  {
    action: 'hide-output',
    global: 'CommandOrControl+Alt+H',
    local: 'Esc',
    label: 'Emergency hide / show Output',
  },
];

export interface HotkeyStatus {
  action: PresenterAction;
  accelerator: string;
  /** false when another app already owns this combination. */
  registered: boolean;
}

/** Map a Control Panel keydown to an action (null = not ours). */
export function localAction(e: {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): PresenterAction | null {
  if (e.ctrlKey && !e.altKey && !e.metaKey) {
    if (e.key === 'ArrowRight') return 'next';
    if (e.key === 'ArrowLeft') return 'prev';
    return null;
  }
  if (e.ctrlKey || e.altKey || e.metaKey) return null;
  switch (e.key) {
    case 'Escape':
      return 'hide-output';
    case 'b':
    case 'B':
      return 'blank';
    case 'f':
    case 'F':
      return 'freeze';
    case 'm':
    case 'M':
      return 'fill-cycle';
    case 's':
    case 'S':
      return 'stats';
    case 'c':
    case 'C':
      return 'cursor';
    default:
      return null;
  }
}

import type { AppState } from '@shared/diagnostics';
import type { DisplayInfo } from '@shared/displays';

interface Layout {
  primary: DisplayInfo;
  secondary: DisplayInfo;
}

function layout(state: AppState): Layout | null {
  const primary = state.displays.find((d) => d.id === state.primaryDisplayId);
  const secondary = state.displays.find((d) => d.id === state.targetDisplayId);
  return primary && secondary ? { primary, secondary } : null;
}

const pct = (s: number) => `${Math.round(s * 100)}%`;

/**
 * Step-1 hardware gate. Every item must be run on a real projector / second monitor.
 *
 * `requires` returns null when the CURRENT layout demonstrates the item, otherwise
 * what is missing. "Pass" is only accepted while the requirement holds, so each
 * recorded snapshot is evidence for that specific item.
 */
export const HARDWARE_CHECKS: readonly {
  id: string;
  label: string;
  requires: (l: Layout, s: AppState) => string | null;
  /** Shown instead of the generic hint when the item can't be verified automatically. */
  note?: (s: AppState) => string;
}[] = [
  {
    id: 'follow-wmp-v2',
    label:
      'Follow re-test: project WMP, enter its full screen → the VIDEO plays on the projector; exit → back to the WMP window. Then Copy report (it now has a “Follow full screen trace”)',
    requires: () => null,
  },
  {
    id: 'cursor-v2',
    label:
      'Cursor: press C once → the button changes to “Cursor: can’t hide (Phase 1)” with an explanation (Chromium always draws the cursor)',
    requires: () => null,
  },
  {
    id: 'focus-caret',
    label:
      'Caret: project the app that showed a blinking caret, Diagnostics → “Check focus in 5 s”, click into another app and type; the result is in the report',
    requires: (_l, s) =>
      s.focusCheck?.includes('foreground') ? null : 'run the focus check first',
  },
  {
    id: 'helper-running',
    label:
      'Window helper fix: NO amber “Window helper unavailable” banner; process names are back in the Windows tab',
    requires: (_l, s) => (s.windowHelper.reason ? `helper: ${s.windowHelper.reason}` : null),
  },
  {
    id: 'step6-blank-freeze',
    label:
      'Step 6: B blanks (black, preview keeps moving), B again restores; F freezes the picture, F again resumes',
    requires: (_l, s) => (s.projection.state === 'live' ? null : 'project something first'),
  },
  {
    id: 'step6-global',
    label:
      'Step 6: with WMP (or a video) in its own full screen, Ctrl+Alt+PgDn / PgUp switch the projected source and WMP stays full screen',
    requires: (_l, s) =>
      s.hotkeys.length > 0 && s.hotkeys.every((h) => h.registered)
        ? null
        : 'some global hotkeys are taken by another app (see Diagnostics → Global hotkeys)',
  },
  {
    id: 'step6-stats',
    label:
      'Step 6: S shows the stats overlay on the projector (fps, dropped, latency); Now projecting shows the same line',
    requires: (_l, s) => (s.stats ? null : 'project something live first'),
  },
  {
    id: 'step6-cursor',
    label:
      'Step 6: C hides the mouse cursor on the projector (or the panel says this capture ignored it); C again shows it',
    requires: () => null,
  },
  {
    id: 'step6-hide',
    label:
      'Step 6: Esc in the Control Panel hides the Output (desktop shows on projector) and Esc again brings it back; M cycles Fit/Fill/Stretch',
    requires: () => null,
  },
  {
    id: 'covering-warning-retest',
    label:
      'Covering warning (re-test): WPS slide show on Monitor 2 with Presenter View → red banner appears within ~2 s; ends → clears',
    requires: () => null,
  },
  {
    id: 'fill-modes',
    label:
      'Step 5: Fit / Fill / Stretch on a source whose shape differs from the projector: Fit = black bars, Fill = edges trimmed, Stretch = distorted to fill',
    requires: (_l, s) => (s.projection.state === 'live' ? null : 'project something first'),
  },
  {
    id: 'crop',
    label:
      'Step 5: Crop… → drag a region → Apply: only that region fills the projector (shape kept, per fill mode); preview outlines it; Clear crop restores the whole picture',
    requires: (_l, s) => (s.display.crop ? null : 'apply a crop first'),
  },
  {
    id: 'crop-reset',
    label:
      'Step 5: pick another source while cropped → new source shows uncropped; fill mode is kept',
    requires: () => null,
  },
  {
    id: 'blank-terminal',
    label:
      'Step 5: project a mostly-black terminal (cmd / Windows Terminal) → NO “showing black” warning',
    requires: () => null,
  },
  {
    id: 'covering-warning',
    label:
      'Covering warning: start a WPS/PowerPoint slide show WITH Presenter View → red “Another window is covering the projector” appears; ends → warning clears',
    requires: () => null,
  },
  {
    id: 'follow-wmp',
    label:
      'Follow full screen: project Windows Media Player, press its full-screen button → video stays on the projector (“Following full screen”); exit → back to the WMP window',
    requires: () => null,
  },
  {
    id: 'follow-vlc',
    label: 'Follow full screen: same with VLC (double-click the video)',
    requires: () => null,
  },
  {
    id: 'follow-chrome',
    label:
      'Follow full screen: Chrome/Edge YouTube full screen keeps working (same window; no “Following” note expected)',
    requires: () => null,
  },
  {
    id: 'follow-ppt',
    label:
      'Follow full screen (if you have PowerPoint): project PowerPoint, start the slide show on the laptop screen → the slides follow',
    requires: () => null,
  },
  {
    id: 'project-window',
    label:
      'Step 4: click a window → it fills the projector without distortion (black bars if the shape differs) and the “Now projecting” preview is live',
    requires: (_l, s) =>
      s.projection.state === 'live' ? null : 'click a window card to project it first',
  },
  {
    id: 'project-switch',
    label:
      'Step 4: click another source → quick fade through black, no flash of the old content; the previous capture stops',
    requires: (_l, s) =>
      s.projection.token >= 2 ? null : 'project at least two sources one after the other',
  },
  {
    id: 'project-minimized',
    label:
      'Step 4: click a MINIMIZED card → it restores and projects; the Control Panel stays focused and in front (also try one that was maximized before minimizing)',
    requires: () => null,
  },
  {
    id: 'project-closed',
    label: 'Step 4: close the projected window → projector goes black, panel says “Source closed”',
    requires: () => null,
  },
  {
    id: 'project-recursion',
    label:
      'Step 4: Screens → project the ASUS (projector) screen → NO recursive mirror; the projector shows that screen without the Output on it',
    requires: () => null,
  },
  {
    id: 'sources-windows',
    label:
      'Step 3: Windows tab lists your open apps with live thumbnails, icons and process names; ProjectorDesk itself is not listed',
    requires: () => null,
  },
  {
    id: 'sources-minimized-v2',
    label:
      'Step 3: minimize a window, come back — its card STAYS, greyed out with “Minimized · restore this window”; restore it and the live thumbnail returns. Also: an app minimized before ProjectorDesk started is listed',
    requires: () => null,
  },
  {
    id: 'sources-screens',
    label:
      'Step 3: Screens tab shows both screens; the projector one is marked “Output is on this screen”',
    requires: () => null,
  },
  {
    id: 'sources-refresh',
    label:
      'Step 3: open a new app — it appears within ~2 s of returning to the panel; filter box narrows by title or app name',
    requires: () => null,
  },
  {
    id: 'extend-button',
    label: 'Step 2: Win+P → Duplicate, then "Switch to Extend" brings the Output back',
    requires: (_l, s) =>
      s.extendSuccesses > 0 ? null : 'set Duplicate (Win+P), then click "Switch to Extend"',
  },
  {
    id: 'primary-swap',
    label: 'Step 2: make the projector the main display → Control Panel and Output swap screens',
    requires: (_l, s) =>
      s.primarySwaps > 0
        ? null
        : 'Settings → Display → select projector → "Make this my main display" (then swap back)',
  },
  {
    id: 'hotplug',
    label: 'Unplug and replug the projector while the app is running (re-test in step 2)',
    requires: (_l, s) =>
      s.hotplugRecoveries > 0 ? null : 'no unplug → replug recovery seen this session yet',
  },
  {
    id: 'dpi-primary-high',
    label: 'Primary at 125% or 150%, secondary at 100%',
    requires: ({ primary, secondary }) =>
      primary.scaleFactor >= 1.25 && secondary.scaleFactor === 1
        ? null
        : `now primary ${pct(primary.scaleFactor)}, secondary ${pct(secondary.scaleFactor)}`,
  },
  {
    id: 'dpi-secondary-high',
    label: 'Primary at 100%, secondary at 125% or 150% (reverse)',
    requires: ({ primary, secondary }) =>
      primary.scaleFactor === 1 && secondary.scaleFactor >= 1.25
        ? null
        : `now primary ${pct(primary.scaleFactor)}, secondary ${pct(secondary.scaleFactor)}`,
  },
  {
    id: 'pos-left',
    label: 'Secondary positioned LEFT of primary',
    requires: ({ primary, secondary }) =>
      secondary.bounds.x + secondary.bounds.width <= primary.bounds.x
        ? null
        : 'secondary is not left of primary (drag it left in Settings → Display)',
  },
  {
    id: 'pos-right',
    label: 'Secondary positioned RIGHT of primary',
    requires: ({ primary, secondary }) =>
      secondary.bounds.x >= primary.bounds.x + primary.bounds.width
        ? null
        : 'secondary is not right of primary',
  },
  {
    id: 'pos-above',
    label: 'Secondary positioned ABOVE primary',
    requires: ({ primary, secondary }) =>
      secondary.bounds.y + secondary.bounds.height <= primary.bounds.y
        ? null
        : 'secondary is not above primary (drag it on top in Settings → Display)',
  },
  {
    id: 'non-native',
    label: 'Projector at a non-native resolution (e.g. 1024×768 or 1280×800)',
    // Windows doesn't expose the panel's native mode to Electron; the tester confirms.
    requires: () => null,
    note: (s) => {
      const d = s.displays.find((x) => x.id === s.targetDisplayId);
      return d
        ? `Projector is currently at ${d.nativeSize.width}×${d.nativeSize.height} px. Pass only if that is NOT its native resolution (Settings → Display → Display resolution).`
        : 'Set the projector to a non-native resolution.';
    },
  },
];

export type CheckId = string;
export type CheckResult = 'untested' | 'pass' | 'fail';

/** null when Pass may be recorded right now, else why not. */
export function passBlocker(id: CheckId, state: AppState): string | null {
  const check = HARDWARE_CHECKS.find((c) => c.id === id);
  if (!check) return 'unknown check';
  const l = layout(state);
  if (!l) return 'no projector display detected';
  if (!state.placement?.ok) return 'Output placement is not OK';
  if (state.placement.targetDisplayId !== l.secondary.id) return 'Output is not placed yet';
  return check.requires(l, state);
}

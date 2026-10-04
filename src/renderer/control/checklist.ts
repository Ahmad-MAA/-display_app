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
}[] = [
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
  },
  {
    id: 'hotplug',
    label: 'Unplug and replug the projector while the app is running',
    requires: (_l, s) =>
      s.hotplugRecoveries > 0 ? null : 'no unplug → replug recovery seen this session yet',
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

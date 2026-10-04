/**
 * Pure projector-display selection rules (unit-tested; no Electron imports).
 *
 * - The primary display is never a target (it hosts the Control Panel).
 * - After the current target is unplugged, stay hidden until that same display returns,
 *   a NEW display is plugged in, or the user picks one. Never silently jump to some
 *   other monitor that happened to be connected all along.
 * - Otherwise: user's preferred display → current target (stable when a third monitor
 *   appears) → first non-primary display.
 */
export interface TargetInputs {
  displayIds: readonly number[];
  primaryId: number;
  preferredId: number | null;
  currentId: number | null;
  lostId: number | null;
}

export function resolveTarget(i: TargetInputs): number | null {
  const candidates = i.displayIds.filter((id) => id !== i.primaryId);
  if (i.lostId !== null) return candidates.includes(i.lostId) ? i.lostId : null;
  if (i.preferredId !== null && candidates.includes(i.preferredId)) return i.preferredId;
  if (i.currentId !== null && candidates.includes(i.currentId)) return i.currentId;
  return candidates[0] ?? null;
}

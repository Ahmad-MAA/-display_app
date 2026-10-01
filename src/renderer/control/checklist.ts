/** Step-1 hardware gate. Every item must be run on a real projector / second monitor. */
export const HARDWARE_CHECKS = [
  { id: 'dpi-primary-high', label: 'Primary at 125% or 150%, secondary at 100%' },
  { id: 'dpi-secondary-high', label: 'Primary at 100%, secondary at 125% or 150% (reverse)' },
  { id: 'pos-left', label: 'Secondary positioned LEFT of primary' },
  { id: 'pos-right', label: 'Secondary positioned RIGHT of primary' },
  { id: 'pos-above', label: 'Secondary positioned ABOVE primary' },
  { id: 'non-native', label: 'Projector at a non-native resolution (e.g. 1024×768 or 1280×800)' },
  { id: 'hotplug', label: 'Unplug and replug the projector while the app is running' },
] as const;

export type CheckId = (typeof HARDWARE_CHECKS)[number]['id'];
export type CheckResult = 'untested' | 'pass' | 'fail';

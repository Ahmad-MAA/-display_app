import { screen, type Display } from 'electron';
import type { DisplayInfo } from '@shared/displays';

export function toDisplayInfo(d: Display, primaryId: number): DisplayInfo {
  return {
    id: d.id,
    label: d.label || `Display ${d.id}`,
    bounds: { ...d.bounds },
    workArea: { ...d.workArea },
    scaleFactor: d.scaleFactor,
    nativeSize: {
      width: Math.round(d.bounds.width * d.scaleFactor),
      height: Math.round(d.bounds.height * d.scaleFactor),
    },
    rotation: d.rotation,
    colorDepth: d.colorDepth,
    colorSpace: d.colorSpace,
    depthPerComponent: d.depthPerComponent,
    displayFrequency: d.displayFrequency,
    internal: d.internal,
    isPrimary: d.id === primaryId,
  };
}

export function listDisplays(): DisplayInfo[] {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d) => toDisplayInfo(d, primaryId));
}

export function findDisplay(id: number): Display | undefined {
  return screen.getAllDisplays().find((d) => d.id === id);
}

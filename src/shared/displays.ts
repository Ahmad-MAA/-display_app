/** Plain rectangle in DIPs (device-independent pixels). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Serializable subset of Electron's `Display`, safe to send over IPC. */
export interface DisplayInfo {
  id: number;
  label: string;
  bounds: Rect;
  workArea: Rect;
  scaleFactor: number;
  /** Physical pixel size: bounds * scaleFactor, rounded. */
  nativeSize: { width: number; height: number };
  rotation: number;
  colorDepth: number;
  colorSpace: string;
  depthPerComponent: number;
  displayFrequency: number;
  internal: boolean;
  isPrimary: boolean;
}

export function rectEquals(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export function formatRect(r: Rect): string {
  return `${r.width}×${r.height} @ (${r.x}, ${r.y})`;
}

/**
 * Heuristic HDR detection from what Chromium reports. Windows HDR displays report
 * colorDepth > 24 (e.g. 30 or 48) and/or an extended/PQ/HLG colour space.
 */
export function isHdrDisplay(d: Pick<DisplayInfo, 'colorDepth' | 'colorSpace'>): boolean {
  const cs = d.colorSpace.toUpperCase();
  return (
    d.colorDepth > 24 ||
    cs.includes('PQ') ||
    cs.includes('HLG') ||
    cs.includes('SCRGB') ||
    cs.includes('LINEAR') ||
    cs.includes('BT2020')
  );
}

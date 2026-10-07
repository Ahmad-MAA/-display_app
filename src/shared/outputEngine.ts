/**
 * OutputEngine contract.
 *
 * The Control Panel and main-process orchestration talk ONLY to this interface.
 * Phase 1 implements it with `ElectronOutputEngine` (a BrowserWindow that captures
 * via getDisplayMedia). Phase 2 implements the same messages in a native
 * WinUI 3 / Windows.Graphics.Capture process reached over `\\.\pipe\projectordesk`.
 *
 * Keep everything here serializable: the message types below are the wire format.
 *
 * ElectronOutputEngine implements all of it; engineProtocol.ts holds the wire codec. The
 * Phase 2 plan is in docs/ARCHITECTURE.md.
 */
import type { CropRect } from './geometry';

export const ENGINE_PROTOCOL_VERSION = 1;
export const NATIVE_ENGINE_PIPE = '\\\\.\\pipe\\projectordesk';

export type EngineKind = 'electron' | 'native';
export type FillMode = 'fit' | 'fill' | 'stretch';

/** Source identity that a non-Electron engine can resolve on its own. */
export interface SourceDescriptor {
  /** Electron desktopCapturer id, e.g. "window:132456:0" or "screen:0:0". */
  sourceId: string;
  kind: 'window' | 'screen';
  /** HWND for windows (parsed from the sourceId), as a decimal string; null for screens. */
  hwnd: string | null;
  /** Electron display_id for screens (maps to an HMONITOR natively); null for windows. */
  displayId: string | null;
  processName: string | null;
  title: string;
}

export interface EngineStats {
  /** Frames actually presented per second (requestVideoFrameCallback in Phase 1). */
  deliveredFps: number;
  droppedFrames: number;
  totalFrames: number;
  /** Median capture→present latency, ms (best estimate the engine can make). */
  medianLatencyMs: number | null;
  /** Median per-frame processing time, ms. */
  medianProcessingMs: number | null;
  sourceWidth: number;
  sourceHeight: number;
  refreshRate: number;
}

export type EngineErrorCode =
  | 'capture-permission-denied'
  | 'source-not-found'
  | 'source-ended'
  | 'display-not-found'
  | 'content-protection-unsupported'
  | 'internal';

export interface EngineError {
  code: EngineErrorCode;
  message: string;
}

export type Unsubscribe = () => void;

export interface OutputEngine {
  readonly kind: EngineKind;
  start(targetDisplayId: number): Promise<void>;
  stop(): Promise<void>;
  setSource(source: SourceDescriptor | null): Promise<void>;
  setFillMode(mode: FillMode): void;
  /** Crop in source-normalized coordinates (0..1 of the frame); null = whole frame. */
  setCrop(rect: CropRect | null): void;
  blank(on: boolean): void;
  freeze(on: boolean): void;
  setCursor(on: boolean): void;
  onStats(cb: (stats: EngineStats) => void): Unsubscribe;
  onSourceEnded(cb: (source: SourceDescriptor) => void): Unsubscribe;
  onError(cb: (error: EngineError) => void): Unsubscribe;
}

/** Commands main → engine. */
export type EngineCommand =
  | { type: 'start'; targetDisplayId: number }
  | { type: 'stop' }
  | { type: 'setSource'; source: SourceDescriptor | null }
  | { type: 'setFillMode'; mode: FillMode }
  | { type: 'setCrop'; rect: CropRect | null }
  | { type: 'blank'; on: boolean }
  | { type: 'freeze'; on: boolean }
  | { type: 'setCursor'; on: boolean };

/** Events engine → main. */
export type EngineEvent =
  | { type: 'stats'; stats: EngineStats }
  | { type: 'sourceEnded'; source: SourceDescriptor }
  | { type: 'error'; error: EngineError };

/** Versioned envelope. One JSON object per line when carried over the named pipe. */
export interface EngineEnvelope<T extends EngineCommand | EngineEvent> {
  v: typeof ENGINE_PROTOCOL_VERSION;
  seq: number;
  msg: T;
}

/**
 * Parse an Electron desktopCapturer id into native handles.
 * "window:<hwnd>:<n>" → HWND; "screen:<index>:<n>" → screen (display_id comes from
 * DesktopCapturerSource.display_id, passed separately).
 */
export function parseSourceId(
  sourceId: string,
): { kind: 'window'; hwnd: string } | { kind: 'screen'; index: string } | null {
  const m = /^(window|screen):(\d+):\d+$/.exec(sourceId);
  if (!m?.[1] || !m[2]) return null;
  return m[1] === 'window' ? { kind: 'window', hwnd: m[2] } : { kind: 'screen', index: m[2] };
}

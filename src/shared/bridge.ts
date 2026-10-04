/** Shapes of the APIs each preload exposes via contextBridge. Pure types: no Electron imports. */
import type { AppState, ExtendResult, LogEntry, OutputViewport } from './diagnostics';
import type { OutputControls, OutputStatsReport, TestPatternInfo } from './ipc';
import type { HotkeyStatus, PresenterAction } from './controls';
import type { CropRect, OutputDisplay } from './geometry';
import type { FillMode, SourceDescriptor } from './outputEngine';
import type { ProjectResult, SourceStatus } from './projection';
import type { SourceList } from './sources';

export interface ControlApi {
  getState(): Promise<AppState>;
  getLogs(): Promise<LogEntry[]>;
  setTestPattern(on: boolean): Promise<void>;
  replaceOutput(): Promise<void>;
  setTargetDisplay(displayId: number | null): Promise<void>;
  extendDisplays(): Promise<ExtendResult>;
  onState(cb: (s: AppState) => void): () => void;
  onLog(cb: (e: LogEntry) => void): () => void;
  getSources(): Promise<SourceList>;
  refreshSources(): Promise<SourceList>;
  onSources(cb: (list: SourceList) => void): () => void;
  project(sourceId: string | null): Promise<ProjectResult>;
  setFollowFullscreen(on: boolean): Promise<void>;
  setFillMode(mode: FillMode): Promise<void>;
  setCrop(crop: CropRect | null): Promise<void>;
  action(action: PresenterAction): Promise<void>;
  focusCheck(delaySeconds: number): Promise<void>;
  toggleFavorite(sourceId: string): Promise<void>;
  removeFavorite(favoriteId: string): Promise<void>;
  projectFavorite(favoriteId: string): Promise<ProjectResult>;
  setHotkeys(accelerators: Record<PresenterAction, string>): Promise<HotkeyStatus[]>;
  resume(accept: boolean): Promise<ProjectResult>;
}

export interface OutputApi {
  onTestPattern(cb: (info: TestPatternInfo | null) => void): () => void;
  reportViewport(v: OutputViewport): void;
  onSetSource(
    cb: (req: { token: number; source: SourceDescriptor | null; cursor: boolean }) => void,
  ): () => void;
  reportSourceStatus(status: SourceStatus): void;
  onDisplay(cb: (d: OutputDisplay) => void): () => void;
  onControls(cb: (c: OutputControls) => void): () => void;
  reportStats(stats: OutputStatsReport): void;
}

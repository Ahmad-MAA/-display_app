/** Shapes of the APIs each preload exposes via contextBridge. Pure types: no Electron imports. */
import type { AppState, LogEntry, OutputViewport } from './diagnostics';
import type { TestPatternInfo } from './ipc';

export interface ControlApi {
  getState(): Promise<AppState>;
  getLogs(): Promise<LogEntry[]>;
  setTestPattern(on: boolean): Promise<void>;
  replaceOutput(): Promise<void>;
  onState(cb: (s: AppState) => void): () => void;
  onLog(cb: (e: LogEntry) => void): () => void;
}

export interface OutputApi {
  onTestPattern(cb: (info: TestPatternInfo | null) => void): () => void;
  reportViewport(v: OutputViewport): void;
}

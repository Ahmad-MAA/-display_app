/**
 * Typed IPC contract between main, the Control Panel and the Output window.
 * Every channel name and payload type lives here; nothing crosses IPC as `any`.
 */
import type { AppState, ExtendResult, LogEntry, OutputViewport } from './diagnostics';
import type { DisplayInfo } from './displays';
import type { SourceDescriptor } from './outputEngine';
import type { ProjectResult, SourceStatus } from './projection';
import type { SourceList } from './sources';

/** Control Panel → main, request/response (ipcRenderer.invoke / ipcMain.handle). */
export interface ControlInvokeMap {
  'state:get': { args: []; result: AppState };
  'logs:get': { args: []; result: LogEntry[] };
  'output:set-test-pattern': { args: [on: boolean]; result: void };
  'output:replace': { args: []; result: void };
  /** null = automatic target selection. */
  'displays:set-target': { args: [displayId: number | null]; result: void };
  /** Run `DisplaySwitch.exe /extend`, then re-scan. */
  'displays:extend': { args: []; result: ExtendResult };
  /** Latest enumeration (enumerates first if none yet). */
  'sources:get': { args: []; result: SourceList };
  /** Enumerate now (manual Refresh). */
  'sources:refresh': { args: []; result: SourceList };
  /** Project a source by its Electron id (only the id crosses IPC); null = stop. */
  'output:project': { args: [sourceId: string | null]; result: ProjectResult };
}

/** main → Control Panel, push events (webContents.send / ipcRenderer.on). */
export interface ControlEventMap {
  'state:changed': AppState;
  'log:entry': LogEntry;
  'sources:changed': SourceList;
}

/** Info the Output window draws in its placement test pattern. */
export interface TestPatternInfo {
  display: DisplayInfo;
}

/** main → Output window, push events. */
export interface OutputEventMap {
  'output:test-pattern': TestPatternInfo | null;
  /** Start capturing this source (null = go black and stop capturing). */
  'output:set-source': { token: number; source: SourceDescriptor | null };
}

/** Output window → main, fire-and-forget (ipcRenderer.send / ipcMain.on). */
export interface OutputSendMap {
  'output:viewport': OutputViewport;
  'output:source-status': SourceStatus;
}

export type ControlInvokeChannel = keyof ControlInvokeMap;
export type ControlEventChannel = keyof ControlEventMap;
export type OutputEventChannel = keyof OutputEventMap;
export type OutputSendChannel = keyof OutputSendMap;

export const CONTROL_INVOKE_CHANNELS: readonly ControlInvokeChannel[] = [
  'state:get',
  'logs:get',
  'output:set-test-pattern',
  'output:replace',
  'displays:set-target',
  'displays:extend',
  'sources:get',
  'sources:refresh',
  'output:project',
];

export const CONTROL_EVENT_CHANNELS: readonly ControlEventChannel[] = [
  'state:changed',
  'log:entry',
  'sources:changed',
];

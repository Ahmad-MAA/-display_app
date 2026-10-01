/**
 * Typed IPC contract between main, the Control Panel and the Output window.
 * Every channel name and payload type lives here; nothing crosses IPC as `any`.
 */
import type { AppState, LogEntry, OutputViewport } from './diagnostics';
import type { DisplayInfo } from './displays';

/** Control Panel → main, request/response (ipcRenderer.invoke / ipcMain.handle). */
export interface ControlInvokeMap {
  'state:get': { args: []; result: AppState };
  'logs:get': { args: []; result: LogEntry[] };
  'output:set-test-pattern': { args: [on: boolean]; result: void };
  'output:replace': { args: []; result: void };
}

/** main → Control Panel, push events (webContents.send / ipcRenderer.on). */
export interface ControlEventMap {
  'state:changed': AppState;
  'log:entry': LogEntry;
}

/** Info the Output window draws in its placement test pattern. */
export interface TestPatternInfo {
  display: DisplayInfo;
}

/** main → Output window, push events. */
export interface OutputEventMap {
  'output:test-pattern': TestPatternInfo | null;
}

/** Output window → main, fire-and-forget (ipcRenderer.send / ipcMain.on). */
export interface OutputSendMap {
  'output:viewport': OutputViewport;
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
];

export const CONTROL_EVENT_CHANNELS: readonly ControlEventChannel[] = [
  'state:changed',
  'log:entry',
];

import { contextBridge, ipcRenderer } from 'electron';
import type { ControlApi } from '@shared/bridge';
import type {
  ControlEventChannel,
  ControlEventMap,
  ControlInvokeChannel,
  ControlInvokeMap,
} from '@shared/ipc';

function invoke<K extends ControlInvokeChannel>(
  channel: K,
  ...args: ControlInvokeMap[K]['args']
): Promise<ControlInvokeMap[K]['result']> {
  return ipcRenderer.invoke(channel, ...args) as Promise<ControlInvokeMap[K]['result']>;
}

function on<K extends ControlEventChannel>(
  channel: K,
  cb: (payload: ControlEventMap[K]) => void,
): () => void {
  const listener = (_e: Electron.IpcRendererEvent, payload: ControlEventMap[K]) => {
    cb(payload);
  };
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: ControlApi = {
  getState: () => invoke('state:get'),
  getLogs: () => invoke('logs:get'),
  setTestPattern: (on: boolean) => invoke('output:set-test-pattern', on),
  replaceOutput: () => invoke('output:replace'),
  setTargetDisplay: (displayId) => invoke('displays:set-target', displayId),
  extendDisplays: () => invoke('displays:extend'),
  onState: (cb: (s: ControlEventMap['state:changed']) => void) => on('state:changed', cb),
  getSources: () => invoke('sources:get'),
  refreshSources: () => invoke('sources:refresh'),
  onSources: (cb) => on('sources:changed', cb),
  project: (sourceId) => invoke('output:project', sourceId),
  setFollowFullscreen: (on) => invoke('output:set-follow', on),
  setFillMode: (mode) => invoke('output:set-fill-mode', mode),
  setCrop: (crop) => invoke('output:set-crop', crop),
  action: (a) => invoke('output:action', a),
  onLog: (cb: (e: ControlEventMap['log:entry']) => void) => on('log:entry', cb),
};

contextBridge.exposeInMainWorld('projectorDesk', api);

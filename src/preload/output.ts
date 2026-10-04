import { contextBridge, ipcRenderer } from 'electron';
import type { OutputApi } from '@shared/bridge';
import type {
  OutputEventChannel,
  OutputEventMap,
  OutputSendChannel,
  OutputSendMap,
} from '@shared/ipc';

function on<K extends OutputEventChannel>(
  channel: K,
  cb: (payload: OutputEventMap[K]) => void,
): () => void {
  const listener = (_e: Electron.IpcRendererEvent, payload: OutputEventMap[K]) => {
    cb(payload);
  };
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

function send<K extends OutputSendChannel>(channel: K, payload: OutputSendMap[K]): void {
  ipcRenderer.send(channel, payload);
}

const api: OutputApi = {
  onTestPattern: (cb) => on('output:test-pattern', cb),
  reportViewport: (v) => {
    send('output:viewport', v);
  },
  onSetSource: (cb) => on('output:set-source', cb),
  onDisplay: (cb) => on('output:display', cb),
  reportSourceStatus: (status) => {
    send('output:source-status', status);
  },
};

contextBridge.exposeInMainWorld('projectorOutput', api);

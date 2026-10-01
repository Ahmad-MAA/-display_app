import { contextBridge, ipcRenderer } from 'electron';
import type { OutputApi } from '@shared/bridge';
import type { OutputEventMap, OutputSendMap } from '@shared/ipc';

const api: OutputApi = {
  onTestPattern: (cb: (info: OutputEventMap['output:test-pattern']) => void) => {
    const listener = (
      _e: Electron.IpcRendererEvent,
      info: OutputEventMap['output:test-pattern'],
    ) => {
      cb(info);
    };
    ipcRenderer.on('output:test-pattern', listener);
    return () => ipcRenderer.removeListener('output:test-pattern', listener);
  },
  reportViewport: (v: OutputSendMap['output:viewport']) => {
    ipcRenderer.send('output:viewport', v);
  },
};

contextBridge.exposeInMainWorld('projectorOutput', api);

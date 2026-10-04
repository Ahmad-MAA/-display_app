import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import type {
  ControlEventChannel,
  ControlEventMap,
  ControlInvokeChannel,
  ControlInvokeMap,
  OutputSendChannel,
  OutputSendMap,
} from '@shared/ipc';

export function handle<K extends ControlInvokeChannel>(
  channel: K,
  allowed: () => WebContents | null,
  fn: (
    ...args: ControlInvokeMap[K]['args']
  ) => ControlInvokeMap[K]['result'] | Promise<ControlInvokeMap[K]['result']>,
): void {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    // Only the Control Panel may drive the app.
    if (event.sender !== allowed()) throw new Error(`IPC ${channel} rejected: unexpected sender`);
    return fn(...(args as ControlInvokeMap[K]['args']));
  });
}

export function onOutput<K extends OutputSendChannel>(
  channel: K,
  allowed: () => WebContents | null,
  fn: (payload: OutputSendMap[K]) => void,
): void {
  ipcMain.on(channel, (event, payload: OutputSendMap[K]) => {
    if (event.sender !== allowed()) return;
    fn(payload);
  });
}

export function sendToControl<K extends ControlEventChannel>(
  wc: WebContents | null,
  channel: K,
  payload: ControlEventMap[K],
): void {
  if (wc && !wc.isDestroyed() && !wc.isCrashed()) wc.send(channel, payload);
}

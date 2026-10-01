import { BrowserWindow, shell } from 'electron';
import { join } from 'node:path';

type Page = 'control' | 'output';

export function preloadPath(page: Page): string {
  return join(__dirname, '../preload', `${page}.js`);
}

export async function loadPage(win: BrowserWindow, page: Page): Promise<void> {
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) await win.loadURL(`${devUrl}/${page}/index.html`);
  else await win.loadFile(join(__dirname, '../renderer', page, 'index.html'));
}

/** No navigation, no popups: renderers only ever show our own pages. */
export function lockDownNavigation(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => {
    e.preventDefault();
  });
}

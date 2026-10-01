import { app, BrowserWindow, screen, type Display } from 'electron';
import type { AppState, PlacementReport } from '@shared/diagnostics';
import { findDisplay, listDisplays, pickTargetDisplay } from './displays';
import { handle, onOutput, sendToControl } from './ipc';
import { getLogFilePath, getLogs, log, onLog } from './log';
import { OutputWindow } from './outputWindow';
import { lockDownNavigation, loadPage, preloadPath } from './windows';

let control: BrowserWindow | null = null;
let output: OutputWindow | null = null;
let targetDisplayId: number | null = null;
let testPattern = false;
let lastPlacement: PlacementReport | null = null;

const controlWc = () => (control && !control.isDestroyed() ? control.webContents : null);
const outputWc = () => (output && !output.win.isDestroyed() ? output.win.webContents : null);

function state(): AppState {
  return {
    displays: listDisplays(),
    primaryDisplayId: screen.getPrimaryDisplay().id,
    targetDisplayId,
    outputVisible: output?.isVisible ?? false,
    testPattern,
    contentProtection: output?.contentProtection ?? null,
    placement: lastPlacement,
  };
}

function pushState(): void {
  sendToControl(controlWc(), 'state:changed', state());
}

function pushTestPattern(display: Display | undefined): void {
  if (!output) return;
  if (testPattern && display) {
    const info = state().displays.find((d) => d.id === display.id);
    output.send('output:test-pattern', info ? { display: info } : null);
  } else {
    output.send('output:test-pattern', null);
  }
}

/** Choose the projector display and (re)place the Output window there. */
async function placeOutput(reason: string): Promise<void> {
  if (!output) return;
  const target = pickTargetDisplay(targetDisplayId);
  if (!target) {
    if (targetDisplayId !== null || output.isVisible) {
      log(
        'warn',
        `No secondary display (${reason}). Projector not detected or set to Duplicate; Output hidden.`,
      );
    }
    targetDisplayId = null;
    output.hide();
    pushState();
    return;
  }
  targetDisplayId = target.id;
  log('info', `Placing Output on display ${target.id} "${target.label || 'unnamed'}" (${reason})`);
  await output.placeOn(target);
  pushTestPattern(target);
  pushState();
}

let displayTimer: NodeJS.Timeout | null = null;
/** Windows fires bursts of display events (esp. on hot-plug); coalesce them. */
function schedulePlacement(reason: string): void {
  if (displayTimer) clearTimeout(displayTimer);
  displayTimer = setTimeout(() => {
    displayTimer = null;
    void placeOutput(reason);
  }, 300);
}

function watchDisplays(): void {
  screen.on('display-added', (_e, d) => {
    log(
      'info',
      `Display added: ${d.id} "${d.label}" ${d.bounds.width}×${d.bounds.height} scale ${d.scaleFactor}`,
    );
    schedulePlacement('display added');
  });
  screen.on('display-removed', (_e, d) => {
    log('warn', `Display removed: ${d.id} "${d.label}"`);
    if (d.id === targetDisplayId) {
      // Hide immediately; don't wait for the debounce.
      output?.hide();
      log('warn', 'Projector display was unplugged mid-session; Output hidden.');
      pushState();
    }
    schedulePlacement('display removed');
  });
  screen.on('display-metrics-changed', (_e, d, changed) => {
    log('info', `Display metrics changed: ${d.id} [${changed.join(', ')}]`);
    schedulePlacement(`metrics changed on ${d.id}`);
  });
}

function createControlWindow(): BrowserWindow {
  // Control Panel lives on the primary monitor, sized to its work area.
  const wa = screen.getPrimaryDisplay().workArea;
  const width = Math.min(1280, wa.width);
  const height = Math.min(860, wa.height);
  const win = new BrowserWindow({
    x: wa.x + Math.round((wa.width - width) / 2),
    y: wa.y + Math.round((wa.height - height) / 2),
    width,
    height,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'ProjectorDesk',
    backgroundColor: '#0b0f17',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath('control'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  lockDownNavigation(win);
  win.once('ready-to-show', () => {
    win.show();
  });
  win.on('closed', () => {
    control = null;
    app.quit();
  });
  void loadPage(win, 'control');
  return win;
}

function registerIpc(): void {
  handle('state:get', controlWc, () => state());
  handle('logs:get', controlWc, () => getLogs());
  handle('output:set-test-pattern', controlWc, (on) => {
    testPattern = on;
    pushTestPattern(targetDisplayId !== null ? findDisplay(targetDisplayId) : undefined);
    pushState();
  });
  handle('output:replace', controlWc, async () => {
    await placeOutput('manual re-place');
  });
  onOutput('output:viewport', outputWc, (v) => output?.setViewport(v));
  onLog((entry) => {
    sendToControl(controlWc(), 'log:entry', entry);
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (control) {
      if (control.isMinimized()) control.restore();
      control.focus();
    }
  });

  void app.whenReady().then(() => {
    log(
      'info',
      `ProjectorDesk ${app.getVersion()} starting; log file: ${getLogFilePath() ?? 'n/a'}`,
    );
    for (const d of listDisplays()) {
      log(
        'info',
        `Display ${d.id} "${d.label}"${d.isPrimary ? ' [primary]' : ''}: bounds ${d.bounds.width}×${d.bounds.height} @ (${d.bounds.x}, ${d.bounds.y}), scale ${d.scaleFactor}, native ${d.nativeSize.width}×${d.nativeSize.height}, ${d.displayFrequency}Hz, colorDepth ${d.colorDepth}, colorSpace ${d.colorSpace}`,
      );
    }
    registerIpc();
    control = createControlWindow();
    output = new OutputWindow((report) => {
      lastPlacement = report;
      pushState();
    });
    watchDisplays();
    void placeOutput('startup');
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('before-quit', () => {
    output?.destroy();
  });
}

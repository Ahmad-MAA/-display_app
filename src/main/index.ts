import { app, BrowserWindow, dialog, screen, type Display } from 'electron';
import type { AppState, PlacementReport } from '@shared/diagnostics';
import { DEFAULT_CONTROLS, type HotkeyStatus, type PresenterAction } from '@shared/controls';
import { DEFAULT_DISPLAY, FILL_MODES, nextFillMode } from '@shared/geometry';
import { IDLE_PROJECTION, type ProjectResult } from '@shared/projection';
import { resolveTarget } from '@shared/targeting';
import { extendDisplays } from './displaySwitch';
import { findDisplay, listDisplays } from './displays';
import { handle, onOutput, sendToControl } from './ipc';
import { getLogFilePath, getLogs, log, onLog } from './log';
import { ElectronOutputEngine } from './electronOutputEngine';
import { CoverWatcher } from './coverWatcher';
import { registerHotkeys, unregisterHotkeys } from './hotkeys';
import { recentSessions, recordSession } from './sessionLog';
import { FullscreenFollower } from './fullscreenFollower';
import { OutputWindow } from './outputWindow';
import { hwndOf, ownHwnds, SourceService } from './sources';
import { WindowHelper } from './windowHelper';
import { lockDownNavigation, loadPage, preloadPath } from './windows';

let control: BrowserWindow | null = null;
let output: OutputWindow | null = null;
let sources: SourceService | null = null;
let engine: ElectronOutputEngine | null = null;
let follower: FullscreenFollower | null = null;
let coverWatcher: CoverWatcher | null = null;
let hotkeys: HotkeyStatus[] = [];
/** Emergency hide (Esc / Ctrl+Alt+H): keep the Output hidden until shown again. */
let outputHiddenByUser = false;
let focusCheck: string | null = null;
let windowHelper: WindowHelper | null = null;
let targetDisplayId: number | null = null;
let preferredDisplayId: number | null = null;
let lostDisplayId: number | null = null;
let testPattern = false;
let lastPlacement: PlacementReport | null = null;
let awaitingReplug = false;
let hotplugRecoveries = 0;
let extendSuccesses = 0;
let primarySwaps = 0;

const controlWc = () => (control && !control.isDestroyed() ? control.webContents : null);
const outputWc = () => (output && !output.win.isDestroyed() ? output.win.webContents : null);

function state(): AppState {
  return {
    displays: listDisplays(),
    primaryDisplayId: screen.getPrimaryDisplay().id,
    targetDisplayId,
    preferredDisplayId,
    lostDisplayId,
    outputVisible: output?.isVisible ?? false,
    testPattern,
    contentProtection: output?.contentProtection ?? null,
    placement: lastPlacement,
    hotplugRecoveries,
    extendSuccesses,
    primarySwaps,
    projection: engine?.current ?? IDLE_PROJECTION,
    followFullscreen: follower?.enabled ?? true,
    coveredBy: coverWatcher?.current ?? [],
    display: engine?.currentDisplay ?? DEFAULT_DISPLAY,
    windowHelper: {
      supported: process.platform === 'win32',
      reason: windowHelper?.unavailableReason ?? null,
    },
    controls: engine?.currentControls ?? DEFAULT_CONTROLS,
    stats: engine?.currentStats ?? null,
    cursorHideSupported: engine?.cursorHide ?? null,
    hotkeys,
    outputHiddenByUser,
    sessions: recentSessions(),
    focusCheck,
  };
}

function ourWindows(): BrowserWindow[] {
  return [control, output?.win].filter(
    (w): w is BrowserWindow => w !== null && w !== undefined && !w.isDestroyed(),
  );
}

function pushState(): void {
  coverWatcher?.setActive(output?.isVisible ?? false);
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
  const all = screen.getAllDisplays();
  const targetId = resolveTarget({
    displayIds: all.map((d) => d.id),
    primaryId: screen.getPrimaryDisplay().id,
    preferredId: preferredDisplayId,
    currentId: targetDisplayId,
    lostId: lostDisplayId,
  });
  const target = all.find((d) => d.id === targetId);
  if (!target) {
    if (lostDisplayId !== null) {
      // Waiting for the unplugged projector; keep targetDisplayId for the UI.
    } else if (targetDisplayId !== null || output.isVisible) {
      log(
        'warn',
        `No secondary display (${reason}). Projector not detected or set to Duplicate; Output hidden.`,
      );
      targetDisplayId = null;
    }
    output.hide();
    pushState();
    return;
  }
  if (lostDisplayId === target.id) lostDisplayId = null;
  targetDisplayId = target.id;
  if (outputHiddenByUser) {
    output.hide();
    pushState();
    return;
  }
  log('info', `Placing Output on display ${target.id} "${target.label || 'unnamed'}" (${reason})`);
  await output.placeOn(target);
  if (awaitingReplug && lastPlacement?.ok && lastPlacement.targetDisplayId === target.id) {
    awaitingReplug = false;
    hotplugRecoveries++;
    log('info', `Projector reconnected; Output restored on "${target.label || target.id}"`);
  }
  pushTestPattern(target);
  pushState();
  // The "projector screen" flag on screen sources depends on the target.
  if (control?.isFocused()) void sources?.refresh();
}

let lastPrimaryId: number | null = null;

/** Keep the Control Panel on the primary; if the user swaps primaries, follow it. */
function keepControlOnPrimary(): void {
  const primary = screen.getPrimaryDisplay();
  const prev = lastPrimaryId;
  lastPrimaryId = primary.id;
  if (prev === null || prev === primary.id || !control || control.isDestroyed()) return;
  const wa = primary.workArea;
  const [w = 1280, h = 860] = control.getSize();
  const width = Math.min(w, wa.width);
  const height = Math.min(h, wa.height);
  if (control.isMaximized()) control.unmaximize();
  control.setBounds({
    x: wa.x + Math.round((wa.width - width) / 2),
    y: wa.y + Math.round((wa.height - height) / 2),
    width,
    height,
  });
  primarySwaps++;
  log('info', `Primary display changed (${prev} → ${primary.id}); Control Panel moved to it`);
}

let displayTimer: NodeJS.Timeout | null = null;
/** Windows fires bursts of display events (esp. on hot-plug); coalesce them. */
function schedulePlacement(reason: string): void {
  output?.markStale();
  if (displayTimer) clearTimeout(displayTimer);
  displayTimer = setTimeout(() => {
    displayTimer = null;
    keepControlOnPrimary();
    void placeOutput(reason);
  }, 300);
}

function watchDisplays(): void {
  screen.on('display-added', (_e, d) => {
    log(
      'info',
      `Display added: ${d.id} "${d.label}" ${d.bounds.width}×${d.bounds.height} scale ${d.scaleFactor}`,
    );
    if (lostDisplayId !== null && d.id !== lostDisplayId) {
      // A different display was plugged in: treat it as the new projector.
      log('info', `New display ${d.id} replaces unplugged projector ${lostDisplayId}`);
      lostDisplayId = null;
    }
    schedulePlacement('display added');
  });
  screen.on('display-removed', (_e, d) => {
    log('warn', `Display removed: ${d.id} "${d.label}"`);
    if (d.id === targetDisplayId) {
      // Hide immediately; don't wait for the debounce.
      output?.hide();
      awaitingReplug = true;
      lostDisplayId = d.id;
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
  // Enumerate sources every 2 s only while the presenter is looking at the panel.
  win.on('focus', () => {
    sources?.startPolling();
  });
  win.on('blur', () => {
    sources?.stopPolling();
  });
  win.on('closed', () => {
    control = null;
    app.quit();
  });
  loadPage(win, 'control').catch((err: unknown) => {
    log('error', `Control Panel failed to load: ${String(err)}`);
    dialog.showErrorBox('ProjectorDesk', `The Control Panel failed to load:\n${String(err)}`);
  });
  return win;
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Put the Control Panel back in front after something else grabbed activation. */
function returnFocusToControl(): void {
  if (!control || control.isDestroyed()) return;
  const refocus = () => {
    if (control && !control.isDestroyed() && !control.isFocused()) {
      control.moveTop();
      control.focus();
    }
  };
  refocus();
  // A restore animation can re-activate the window shortly after ShowWindow returns.
  setTimeout(refocus, 150);
}

/** Next / previous source in the grid's order (windows, then screens). */
async function stepSource(dir: 1 | -1): Promise<void> {
  if (!sources || !engine) return;
  // The list only auto-refreshes while the panel is focused; a hotkey from another app needs fresh data.
  const list = (await sources.refresh()).sources.filter(
    (x) => !(x.isProjectorScreen && !output?.contentProtection.ok),
  );
  const ordered = [
    ...list.filter((x) => x.descriptor.kind === 'window'),
    ...list.filter((x) => x.descriptor.kind === 'screen'),
  ];
  if (ordered.length === 0) return;
  const cur = engine.current.source?.sourceId;
  const i = ordered.findIndex((x) => x.descriptor.sourceId === cur);
  const next = ordered[i < 0 ? 0 : (i + dir + ordered.length) % ordered.length];
  if (next) await project(next.descriptor.sourceId);
}

function setOutputHidden(hidden: boolean): void {
  outputHiddenByUser = hidden;
  log(
    hidden ? 'warn' : 'info',
    hidden ? 'Output hidden by presenter (emergency hide)' : 'Output shown again',
  );
  if (hidden) {
    output?.hide();
    pushState();
  } else {
    void placeOutput('presenter un-hid the Output');
  }
}

/**
 * Is the projected window acting as if it had keyboard focus while another app is in front?
 * Reads Windows' foreground window and GetGUIThreadInfo for the projected window's thread.
 * ProjectorDesk itself only moves focus after restoring a minimized card (back to the panel).
 */
async function runFocusCheck(): Promise<void> {
  const src = engine?.current.source;
  const hwnd = src?.kind === 'window' ? src.hwnd : null;
  let msg: string;
  if (!hwnd || !windowHelper?.available) {
    msg = hwnd ? 'window helper unavailable' : 'project a window first';
  } else {
    const f = await windowHelper.focus(hwnd);
    if (!f) {
      msg = 'helper query failed';
    } else {
      const str = (k: string): string | null => {
        const v = f[k];
        return typeof v === 'string' ? v : null;
      };
      const fg = f['targetIsForeground'] === true;
      const caret = str('caretHwnd');
      msg =
        `projected "${src?.title ?? '?'}" is ${fg ? '' : 'NOT '}the foreground window ` +
        `(foreground: "${str('foregroundTitle') ?? '?'}" / ${str('foregroundProcess') ?? '?'}); ` +
        `its thread: active=${str('threadActiveHwnd') ?? 'none'}, focus=${str('threadFocusHwnd') ?? 'none'}, ` +
        `system caret=${caret ? (f['caretBlinking'] === true ? `${caret} (blinking)` : `${caret} (hidden)`) : 'none'}. ` +
        (fg
          ? 'Windows considers the projected app ACTIVE: it really has focus.'
          : caret && f['caretBlinking'] === true
            ? 'Windows does not give it focus, but its thread keeps a blinking system caret: the app shows the caret itself.'
            : 'Windows does not give it focus; any caret seen is drawn by the app itself, not caused by ProjectorDesk.');
    }
  }
  focusCheck = `${new Date().toLocaleTimeString()}: ${msg}`;
  log('info', `Focus check: ${msg}`);
  pushState();
}

/** One entry point for buttons, Control Panel keys and global hotkeys. */
function runAction(a: PresenterAction): void {
  if (!engine) return;
  const c = engine.currentControls;
  switch (a) {
    case 'blank':
      engine.blank(!c.blank);
      break;
    case 'freeze':
      engine.freeze(!c.freeze);
      break;
    case 'cursor':
      engine.setCursor(!c.cursor);
      break;
    case 'stats':
      engine.setStatsOverlay(!c.statsOverlay);
      break;
    case 'fill-cycle':
      engine.setFillMode(nextFillMode(engine.currentDisplay.fillMode));
      break;
    case 'next':
      void stepSource(1);
      break;
    case 'prev':
      void stepSource(-1);
      break;
    case 'hide-output':
      setOutputHidden(!outputHiddenByUser);
      break;
  }
}

/** Control Panel picked a source (only its id crosses IPC). */
async function project(sourceId: string | null): Promise<ProjectResult> {
  if (!engine || !sources) return { ok: false, message: 'Not ready yet.' };
  if (sourceId === null) {
    engine.setSource(null);
    follower?.onProjected(null);
    return { ok: true, message: null };
  }
  const find = () => sources?.latest.sources.find((s) => s.descriptor.sourceId === sourceId);
  let src = find();
  if (!src) {
    await sources.refresh();
    src = find();
  }
  if (!src) {
    return { ok: false, message: 'That source is no longer available; it may have been closed.' };
  }
  const d = src.descriptor;
  const cp = output?.contentProtection;
  if (d.kind === 'screen' && src.isProjectorScreen && !cp?.ok) {
    return {
      ok: false,
      message:
        'Blocked: capture exclusion is unavailable, so projecting the projector’s own screen would mirror the Output into itself.',
    };
  }
  if (src.minimized && d.hwnd) {
    engine.markRestoring(d);
    log('info', `Restoring minimized window "${d.title}" without activating it`);
    const r = await sources.restoreWindow(d.hwnd);
    if (r.activated) log('info', 'Window had to be activated to restore maximized; focus returned');
    returnFocusToControl();
    if (!r.restored) {
      const message = `Couldn’t restore “${d.title}”. Restore it from the taskbar, then pick it again.`;
      engine.fail(d, message);
      return { ok: false, message };
    }
    await delay(250); // let the restore animation finish so the first frames aren't mid-animation
  }
  engine.setSource(d);
  follower?.onProjected(d);
  void sources.refresh();
  return {
    ok: true,
    message: src.isProjectorScreen
      ? 'You’re projecting the projector’s own screen. The Output window is excluded from capture, so there’s no mirror, but the audience sees whatever else is on that screen.'
      : null,
  };
}

function registerIpc(): void {
  handle('state:get', controlWc, () => state());
  handle('logs:get', controlWc, () => getLogs());
  handle('output:set-test-pattern', controlWc, (on) => {
    testPattern = on;
    pushTestPattern(targetDisplayId !== null ? findDisplay(targetDisplayId) : undefined);
    pushState();
  });
  handle('displays:set-target', controlWc, async (id) => {
    const display = id === null ? null : findDisplay(id);
    if (id !== null && (!display || display.id === screen.getPrimaryDisplay().id)) {
      log('warn', `Ignoring target ${id}: not a connected secondary display`);
      return;
    }
    preferredDisplayId = id;
    lostDisplayId = null;
    log('info', id === null ? 'Projector display: automatic' : `Projector display set to ${id}`);
    await placeOutput('user changed projector display');
  });
  handle('displays:extend', controlWc, async () => {
    const result = await extendDisplays();
    await placeOutput('after DisplaySwitch /extend');
    if (result.ok && output?.isVisible) extendSuccesses++;
    pushState();
    return result;
  });
  handle('sources:get', controlWc, async () => {
    if (!sources) throw new Error('not ready');
    return sources.latest.sources.length > 0 ? sources.latest : sources.refresh();
  });
  handle('sources:refresh', controlWc, async () => {
    if (!sources) throw new Error('not ready');
    return sources.refresh();
  });
  handle('output:project', controlWc, (sourceId) => project(sourceId));
  handle('output:set-fill-mode', controlWc, (mode) => {
    // Validate at the IPC boundary even though the type says FillMode.
    if (!FILL_MODES.includes(mode)) return;
    engine?.setFillMode(mode);
  });
  handle('output:set-crop', controlWc, (crop) => {
    engine?.setCrop(crop);
  });
  handle('diagnostics:focus-check', controlWc, (delaySeconds) => {
    const ms = Math.min(Math.max(Number.isFinite(delaySeconds) ? delaySeconds : 0, 0), 30) * 1000;
    focusCheck = `checking in ${ms / 1000} s: switch to the app you're typing in…`;
    pushState();
    setTimeout(() => void runFocusCheck(), ms);
  });
  handle('output:action', controlWc, (a) => {
    runAction(a);
  });
  onOutput('output:stats', outputWc, (r) => {
    engine?.handleStats(r);
  });
  handle('output:set-follow', controlWc, (on) => {
    follower?.setEnabled(on);
    pushState();
  });
  onOutput('output:source-status', outputWc, (st) => {
    engine?.handleStatus(st);
    if (st.state === 'error' && engine?.current.source?.kind === 'window') {
      void follower?.diagnose(`capture error ${st.errorName ?? ''}`);
    }
    if (st.state === 'ended') void sources?.refresh();
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
    lastPrimaryId = screen.getPrimaryDisplay().id;
    output = new OutputWindow((report) => {
      lastPlacement = report;
      pushState();
    });
    windowHelper = new WindowHelper({ scriptDir: app.getPath('userData') });
    hotkeys = registerHotkeys(runAction);
    windowHelper.onUnavailable = () => {
      pushState();
    };
    engine = new ElectronOutputEngine(output, controlWc, () => {
      pushState();
    });
    engine.refreshRate = () =>
      (targetDisplayId !== null ? findDisplay(targetDisplayId)?.displayFrequency : undefined) || 60;
    engine.onSession = (s) => {
      recordSession(s);
      pushState();
    };
    follower = new FullscreenFollower(windowHelper, engine, (monitor) => {
      // Helper rects are physical pixels; Electron displays are DIPs.
      const dip = process.platform === 'win32' ? screen.screenToDipRect(null, monitor) : monitor;
      const display = screen.getDisplayMatching(dip);
      const src = sources?.latest.sources.find(
        (x) => x.descriptor.kind === 'screen' && x.descriptor.displayId === String(display.id),
      );
      if (!src) return null;
      // Never fall back to the projector's own screen without capture exclusion.
      if (src.isProjectorScreen && !output?.contentProtection.ok) return null;
      return { descriptor: src.descriptor, label: src.displayLabel ?? src.descriptor.title };
    });
    coverWatcher = new CoverWatcher(
      windowHelper,
      () => (output && !output.win.isDestroyed() ? hwndOf(output.win) : null),
      () => ownHwnds(ourWindows()),
      () => {
        pushState();
      },
    );
    sources = new SourceService(
      {
        ownHwnds: () => ownHwnds(ourWindows()),
        projectorDisplayId: () => (output?.isVisible ? targetDisplayId : null),
        displayLabel: (id) => listDisplays().find((d) => String(d.id) === id)?.label ?? null,
      },
      windowHelper,
      (list) => {
        sendToControl(controlWc(), 'sources:changed', list);
      },
    );
    if (control.isFocused()) sources.startPolling();
    watchDisplays();
    void placeOutput('startup');
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('will-quit', () => {
    unregisterHotkeys();
  });

  app.on('before-quit', () => {
    engine?.shutdown();
    sources?.dispose();
    coverWatcher?.dispose();
    windowHelper?.dispose();
    output?.destroy();
  });
}

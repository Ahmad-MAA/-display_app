import type { DisplayInfo, Rect } from './displays';
import type { HotkeyStatus, PresenterControls } from './controls';
import type { CoveringWindow } from './covering';
import type { OutputDisplay } from './geometry';
import type { EngineStats } from './outputEngine';
import type { ProjectionInfo } from './projection';
import type { Settings, SourceRef } from './settings';
import type { SessionSummary } from './stats';

export interface ContentProtectionStatus {
  platform: string;
  /** e.g. "10.0.19045" on Windows. */
  osVersion: string;
  /** Windows build number, or null when not on Windows. */
  windowsBuild: number | null;
  /** setContentProtection(true) was called on the Output window before it was shown. */
  requested: boolean;
  /** BrowserWindow.isContentProtected() after the call. */
  reportedByElectron: boolean;
  /**
   * The OS removes the window from capture entirely (WDA_EXCLUDEFROMCAPTURE,
   * Windows 10 2004 / build 19041+). Older Windows only blacks it out, which still
   * produces a recursive (black) mirror when capturing the projector screen.
   */
  osSupportsExclusion: boolean;
  /** Overall verdict: true only if the Output window is fully excluded from capture. */
  ok: boolean;
  message: string;
}

/** What the Output renderer itself sees, used to cross-check placement in physical pixels. */
export interface OutputViewport {
  innerWidth: number;
  innerHeight: number;
  devicePixelRatio: number;
  screenWidth: number;
  screenHeight: number;
}

export interface PlacementReport {
  at: string;
  targetDisplayId: number;
  targetLabel: string;
  expected: Rect;
  /** getBounds() after the final placement step. */
  actual: Rect;
  /** Display Electron thinks the window is on after placement. */
  matchedDisplayId: number;
  fullScreen: boolean;
  /** Number of setBounds attempts needed before the bounds matched. */
  attempts: number;
  /** A mismatch was detected and corrected at least once. */
  corrected: boolean;
  /** Scale factors involved, to make mixed-DPI cases obvious in reports. */
  targetScaleFactor: number;
  primaryScaleFactor: number;
  mixedDpi: boolean;
  viewport: OutputViewport | null;
  ok: boolean;
  problems: string[];
}

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  at: string;
  level: LogLevel;
  message: string;
}

export interface ExtendResult {
  ok: boolean;
  displayCount: number;
  message: string;
}

/** Full state pushed to the Control Panel whenever something changes. */
export interface AppState {
  displays: DisplayInfo[];
  primaryDisplayId: number;
  targetDisplayId: number | null;
  /** User override from the dropdown; null = automatic (first non-primary). */
  preferredDisplayId: number | null;
  /** Projector that was unplugged mid-session; Output stays hidden until it returns. */
  lostDisplayId: number | null;
  outputVisible: boolean;
  testPattern: boolean;
  contentProtection: ContentProtectionStatus | null;
  placement: PlacementReport | null;
  /** Times this session the projector was unplugged and Output was restored correctly on replug. */
  hotplugRecoveries: number;
  /** Successful "Switch to Extend" (DisplaySwitch.exe) runs this session. */
  extendSuccesses: number;
  /** Times the user made another monitor primary and the Control Panel followed. */
  primarySwaps: number;
  projection: ProjectionInfo;
  /** Follow the projected app's separate full-screen window (WMP, VLC, slide shows). */
  followFullscreen: boolean;
  /** Other apps' windows above the Output on the projector display (empty = fine). */
  coveredBy: CoveringWindow[];
  /** Fill mode + crop currently applied on the Output. */
  display: OutputDisplay;
  /**
   * The hidden PowerShell window helper (process names, minimized windows, Follow full
   * screen, covering warning). `reason` is set when it isn't working.
   */
  windowHelper: { supported: boolean; reason: string | null };
  controls: PresenterControls;
  /** null until the Output reports stats for the current capture. */
  stats: EngineStats | null;
  /**
   * Whether hiding the cursor actually took effect: null = unknown/not requested,
   * false = the capture ignored it (Chromium limitation; the native engine can do it).
   */
  cursorHideSupported: boolean | null;
  hotkeys: HotkeyStatus[];
  /** Emergency hide (Esc / Ctrl+Alt+H): Output window hidden until shown again. */
  outputHiddenByUser: boolean;
  /** Most recent projection sessions, newest first. */
  sessions: SessionSummary[];
  /** Result of the last "is the projected window focused?" check. */
  focusCheck: string | null;
  settings: Settings;
  /** "Resume last projection?": the saved source is open again (sourceId to project). */
  resumeOffer: { ref: SourceRef; sourceId: string } | null;
  /** Unexpected failure the presenter should know about (details in the log); null = none. */
  appError: string | null;
}

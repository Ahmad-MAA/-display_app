# ProjectorDesk architecture

> Step 1 draft. The full Phase 2 migration plan is written in build step 8.

## Processes and windows

| Piece         | Location                                   | Role                                                                                                    |
| ------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Main process  | `src/main/`                                | Display detection, window placement, content protection, IPC, (later) capture permission handler        |
| Control Panel | `src/renderer/control/` (React + Tailwind) | Presenter UI on the primary monitor                                                                     |
| Output window | `src/renderer/output/` (plain TS)          | Black full-screen surface on the projector; captures the source directly                                |
| Preloads      | `src/preload/{control,output}.ts`          | Narrow `contextBridge` APIs; `contextIsolation` on, `nodeIntegration` off, sandboxed                    |
| Shared        | `src/shared/`                              | IPC channel map (`ipc.ts`), bridge API types (`bridge.ts`), `OutputEngine` contract (`outputEngine.ts`) |

Each renderer gets its own preload with only the calls it needs. The main process rejects invoke calls from any sender other than the Control Panel.

## Display placement (mixed DPI)

`src/main/outputWindow.ts`:

1. Leave full screen if needed. `setBounds(target.bounds)` uses the target display's DIP bounds, never `workArea`.
2. Read back `getBounds()`. On mismatch, log it and call `setBounds` again, up to 3 times. Windows can scale the size by the DPI ratio when a window first crosses monitors with different scale factors.
3. `showInactive()`, then `setFullScreen(true)`. Verify the bounds and `screen.getDisplayMatching()` again. If either is wrong, leave full screen, set the bounds again and re-enter.
4. The Output renderer reports `innerWidth/innerHeight/devicePixelRatio`. Main cross-checks these against the display's DIP size and scale factor, which catches a window rendered at the wrong DPI.

Target selection is a pure function (`src/shared/targeting.ts`, unit-tested): user override →
current target → first non-primary; the primary is never a target. After the target is
unplugged the Output stays hidden until that display returns, a new display is added, or the
user picks one. If the user makes another monitor primary, the Control Panel moves to it.
"Switch to Extend" runs `DisplaySwitch.exe /extend` (`src/main/displaySwitch.ts`) and polls for
the second display.

Display events (`display-added`, `display-removed`, `display-metrics-changed`) are coalesced over 300 ms, and placements are serialized. If the target display is removed, the Output window hides immediately.

## Source enumeration

`src/main/sources.ts` calls `desktopCapturer.getSources({ types: ['window','screen'],
thumbnailSize: 320×180, fetchWindowIcons: true })`. It polls every 2 s only while the Control Panel
is focused (focus/blur on the window), also refreshes on demand, and coalesces overlapping
calls. Thumbnails are sent as JPEG data URLs; icons as PNG.

- **Own windows excluded** by HWND, from `BrowserWindow.getMediaSourceId()` of the Control Panel
  and Output windows.
- **Minimized windows**: Electron's `getSources()` omits them on Windows (seen on hardware), so
  they'd vanish from the grid. The window helper enumerates minimized top-level app windows
  (`EnumWindows` + `IsIconic`; skips owned, tool and cloaked windows) in parallel with
  `getSources()`. `mergeMinimized()` flags/append them with their last-seen thumbnail (a per-HWND
  memo, pruned when the window disappears) so they stay visible and pickable, greyed out.
- **Blank thumbnails** (`isEmpty()` or a sampled all-black bitmap, `isBlankBitmap`) on a window
  that isn't minimized mean protected (DRM) video or a window that isn't drawing.
- **Process names**: Electron doesn't expose them, but `SourceDescriptor.processName` needs them
  for favourites and for a native engine. `src/main/windowHelper.ts` keeps one hidden PowerShell
  process (script in `windowHelper.ps1.ts`) that P/Invokes `GetWindowThreadProcessId` and
  answers JSON requests line by line; names are cached per HWND. If PowerShell is unavailable the helper disables itself, logs
  once, and names fall back to null. No native Node module is involved.
- Screen sources map `display_id` to our display list for labels and to flag the projector screen.

## Routing a source to the projector

Only the source **id** crosses IPC: Control Panel → `output:project(sourceId)` → main looks the
source up in the latest enumeration → `ElectronOutputEngine.setSource(descriptor)` →
`output:set-source { token, source }` to the Output window.

- The Output window calls `getDisplayMedia({ video: { frameRate: 60 }, audio: false })`. main's
  `session.setDisplayMediaRequestHandler` answers with the current source, and only for the
  Output window and the Control Panel (identified with `webContents.fromFrame`). Anything else is
  denied. Permission requests/checks are deny-by-default (display-capture, media, clipboard
  write, fullscreen allowed for our two pages only).
- Switching (`src/renderer/output/capture.ts`): fade video to black (150 ms CSS transition) →
  stop old tracks → start new capture → fade in on the first frame
  (`requestVideoFrameCallback`). Requests are serialized; a superseded request's tracks are
  stopped. A `token` on every request/status pair discards stale results.
- Track `ended` → black + `source-status: ended` → main marks the projection "Source closed".
  `getDisplayMedia` failures map to presenter-facing messages (`describeCaptureError`).
- Every 2 s the Output samples a 160×90 copy of the frame (every pixel checked, so a mostly-black
  terminal with some text isn't flagged); all-black → "minimized or protected" hint in the
  Control Panel.
- **Minimized sources**: main asks the window helper to restore the HWND with
  `SW_SHOWNOACTIVATE` (or `SW_SHOWMAXIMIZED` when it was maximized, which activates) and returns
  focus to the Control Panel (`moveTop` + `focus`, again after 150 ms), then starts capture.
- **"On Projector" preview**: the Control Panel makes its own low-res capture
  (≤480×270, ≤10 fps) of the same source, restarted whenever the projection token changes.
- Projecting the projector's own screen is refused when capture exclusion is unavailable, and
  allowed with an explanatory notice when it is.

## Fill modes and crop

`ElectronOutputEngine.setFillMode()` / `setCrop()` send `output:display { fillMode, crop }` to the
Output window (`src/renderer/output/display.ts`). Geometry lives in `src/shared/geometry.ts`
(pure, unit-tested) so a native engine can reuse the exact rules.

- **Crop is source-normalized** (`CropRect`, 0..1 of the frame): independent of capture
  resolution, the same for every engine. `normalizeCrop()` clamps, fixes negative drags, rejects
  non-finite values (it crosses IPC) and turns ≈full-frame into null.
- **No crop**: CSS `object-fit` on the `<video>` (fit→contain, fill→cover, stretch→fill).
- **Crop**: a `<canvas>` above the video draws only the crop region on every new frame
  (`requestVideoFrameCallback`), positioned by `placeImage(cropW, cropH, viewport, fillMode)`; the
  canvas is sized in device pixels.
- Video and canvas live in one `#stage` element, which is what fades through black on switches.
- A crop is cleared when a new source is picked; the fill mode persists (saved to settings in
  step 7). Hotkey M (fill-mode cycle) arrives in step 6.
- The crop editor (Control Panel) uses its own ≤1280×720, 10 fps capture of the same source and
  maps pointer positions through the video's contain-fitted content box.

## Presenter controls, hotkeys, stats (step 6)

- One dispatcher, `runAction()` in `src/main/index.ts`, serves buttons (`output:action`),
  Control Panel keys (`localAction()` in `src/shared/controls.ts`) and global hotkeys
  (`src/main/hotkeys.ts`, `globalShortcut`, registered at startup, unregistered on `will-quit`).
  Registration failures are reported per hotkey in AppState.
- Engine: `blank()` and `freeze()` and the stats overlay are `output:controls` messages (blank =
  black overlay above `#stage`, capture continues; freeze = `video.pause()`, reset on every new
  capture). `setCursor()` is a capture constraint (`cursor: 'always' | 'never'`), so it restarts
  the capture; the Output reports `getSettings().cursor` so the panel can say when Chromium
  ignored it.
- Stats (`src/renderer/output/controls.ts`, math in `src/shared/stats.ts`): per frame from
  `requestVideoFrameCallback`; dropped = gaps in `presentedFrames`; latency =
  `expectedDisplayTime − captureTime`; processing = `processingDuration` (fallback
  `presentationTime − captureTime`). Reported to main once a second with the capture token.
- Sessions: the engine summarizes each capture when it ends; `evaluateSession()` flags median
  latency > one frame at the projector's refresh rate or > 2% drops. `src/main/sessionLog.ts`
  appends to `userData/logs/sessions.jsonl` and keeps the last 10 for the Diagnostics tab.
- Next/previous source re-enumerates first (the list only auto-refreshes while the panel is
  focused) and walks windows then screens in grid order.
- Emergency hide hides the Output window; placement keeps tracking the target but won't show it
  until un-hidden.

## Settings and favorites (step 7)

- `src/shared/settings.ts` holds the schema (`version: 1`) and a tolerant `parseSettings()`:
  any invalid or unknown field falls back to its default, the engine is forced to `electron` in
  Phase 1. `src/main/settingsStore.ts` loads at `ready` (an unparsable file is renamed
  `settings.corrupt-<time>.json`), and writes debounced (500 ms) and atomically (temp file +
  rename); `before-quit` flushes.
- Main derives what to save from AppState in `pushState()` (fill mode, follow, preferred
  display, last projection), so every path that changes state (buttons, keys, global hotkeys,
  engine events) is persisted without extra plumbing.
- Sources are referenced by `{ kind, processName, title, displayId }`, never by Chromium's
  source id or HWND, which change between runs. `matchSource()` ranks exact title > contained
  title > the only window of that process; screens match by display id.
- Hotkeys: `settings:set-hotkeys` validates, re-registers all accelerators (`registerHotkeys()`
  unregisters first and reports duplicates/failures per action) and saves.
- Engine command routing: presenter actions now go through `dispatchCommand()`
  (`src/shared/engineProtocol.ts`), the same function that will decode `\\.\pipe\projectordesk`
  lines for the native engine, so the Phase 1 path exercises the Phase 2 protocol.

## Window helper launch

The helper script is written to `userData/window-helper.ps1` and started with a short
`-EncodedCommand` bootstrap that runs it as a ScriptBlock. Passing the whole script inline broke
once it grew past Windows' 32,767-character command line (`spawn ENAMETOOLONG`), which silently
disabled every helper feature; failures now surface as a Control Panel banner and in Copy report.

## Covering windows

`CoverWatcher` polls the window helper's `covering` op once a second while the Output is visible:
windows above the Output in z-order, visible and not cloaked, covering ≥25% of the projector
monitor (shell surfaces and our own windows filtered by `relevantCovering()`). A set seen twice in a
row raises a red banner naming the window(s); it clears as soon as nothing covers the projector.
Typical cause: a slide show with Presenter View, which is topmost on the second monitor.

## Follow full screen

Window capture (Windows.Graphics.Capture) is bound to one HWND. Apps that present full screen in a
_different_ top-level window (WMP hides its main window; VLC and PowerPoint's slide show open new
ones) therefore lose the content. `FullscreenFollower` (`src/main/fullscreenFollower.ts`):

- While a **window** source is projected and the toggle is on, it polls the window helper's
  `follow` op every 300 ms: the picked window's state plus every visible window of the same
  process whose DWM frame covers its whole monitor and that isn't maximized (so a maximized window
  on a taskbar-less monitor doesn't count). Coordinates are physical; the helper is per-monitor DPI
  aware.
- `chooseFollow()` (pure, unit-tested): picked window itself full screen → keep it (Chrome/Edge);
  another full-screen window of the same process → follow it (PowerPoint `PodiumParent` / Presenter
  View excluded; note WMP's full-screen window is titled `WMPTransition`); else the picked window. Among
  several candidates, real content windows beat overlays (`overlayScore`: transparent > layered >
  tool window > no-activate rank last), so a player's click-through full-screen controls bar isn't
  captured instead of the video. `Stabilizer` needs the same decision twice (~600 ms) so
  enter/exit animations don't flap.
- The engine keeps two descriptors: `projection.source` (what the presenter picked, shown in the UI)
  and `effective` (what's captured). `followTo()` / `followBack()` switch `effective` with the
  normal fade; the display-media handler always grants `effective`.
- If the followed window's capture errors, or stays black for two consecutive checks (~2 s; a
  single black frame while entering full screen is normal), it falls back once to that monitor's
  **screen** source (physical rect → `screenToDipRect` →
  display → screen source); never to the projector's own screen without capture exclusion.
  "Ended" from a followed window is not "Source closed": the next polls switch back.
- Every decision, switch, and capture error logs a `Follow:` line (candidates with their style
  flags; all top-level windows of the app via the `inspect` op). Copy report includes the last 30
  as a "Follow full screen trace", whatever their log level.

## Recursive-mirror prevention

`setContentProtection(true)` is called on the Output window right after construction, before it is ever shown (`src/main/contentProtection.ts`). Startup verifies both `isContentProtected()` and that the OS build is 19041 or newer, since only `WDA_EXCLUDEFROMCAPTURE` removes the window from capture. Otherwise the Control Panel shows a persistent warning. Later steps disable "Entire Screen" for the projector display in that case.

## OutputEngine contract

`src/shared/outputEngine.ts` defines `OutputEngine`, the source descriptor (sourceId + HWND/display id + process name + title) and the versioned JSON envelope (`{ v, seq, msg }`). Phase 2 can carry the same messages over `\\.\pipe\projectordesk`. All methods are implemented by `ElectronOutputEngine`; presenter actions are routed through `dispatchCommand()` so the wire format is exercised in Phase 1.

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
- Every 2 s the Output samples a 64×36 copy of the frame; all-black → "minimized or protected"
  hint in the Control Panel.
- **Minimized sources**: main asks the window helper to restore the HWND with
  `SW_SHOWNOACTIVATE` (or `SW_SHOWMAXIMIZED` when it was maximized, which activates) and returns
  focus to the Control Panel (`moveTop` + `focus`, again after 150 ms), then starts capture.
- **"On Projector" preview**: the Control Panel makes its own low-res capture
  (≤480×270, ≤10 fps) of the same source, restarted whenever the projection token changes.
- Projecting the projector's own screen is refused when capture exclusion is unavailable, and
  allowed with an explanatory notice when it is.

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
  View excluded); else the picked window. `Stabilizer` needs the same decision twice (~600 ms) so
  enter/exit animations don't flap.
- The engine keeps two descriptors: `projection.source` (what the presenter picked, shown in the UI)
  and `effective` (what's captured). `followTo()` / `followBack()` switch `effective` with the
  normal fade; the display-media handler always grants `effective`.
- If the followed window's capture errors or is black (exclusive/independent-flip presentation),
  it falls back once to that monitor's **screen** source (physical rect → `screenToDipRect` →
  display → screen source); never to the projector's own screen without capture exclusion.
  "Ended" from a followed window is not "Source closed": the next polls switch back.
- Every switch, and every capture error on a window source, logs all top-level windows of the app
  (`inspect` op) for diagnosing other players.

## Recursive-mirror prevention

`setContentProtection(true)` is called on the Output window right after construction, before it is ever shown (`src/main/contentProtection.ts`). Startup verifies both `isContentProtected()` and that the OS build is 19041 or newer, since only `WDA_EXCLUDEFROMCAPTURE` removes the window from capture. Otherwise the Control Panel shows a persistent warning. Later steps disable "Entire Screen" for the projector display in that case.

## OutputEngine contract

`src/shared/outputEngine.ts` defines `OutputEngine`, the source descriptor (sourceId + HWND/display id + process name + title) and the versioned JSON envelope (`{ v, seq, msg }`). Phase 2 can carry the same messages over `\\.\pipe\projectordesk`. Step 1 wires up only start/stop and placement. The remaining methods arrive in steps 4–7 without changing the contract's shape.

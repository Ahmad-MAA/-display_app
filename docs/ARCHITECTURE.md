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

Display events (`display-added`, `display-removed`, `display-metrics-changed`) are coalesced over 300 ms, and placements are serialized. If the target display is removed, the Output window hides immediately.

## Recursive-mirror prevention

`setContentProtection(true)` is called on the Output window right after construction, before it is ever shown (`src/main/contentProtection.ts`). Startup verifies both `isContentProtected()` and that the OS build is 19041 or newer, since only `WDA_EXCLUDEFROMCAPTURE` removes the window from capture. Otherwise the Control Panel shows a persistent warning. Later steps disable "Entire Screen" for the projector display in that case.

## OutputEngine contract

`src/shared/outputEngine.ts` defines `OutputEngine`, the source descriptor (sourceId + HWND/display id + process name + title) and the versioned JSON envelope (`{ v, seq, msg }`). Phase 2 can carry the same messages over `\\.\pipe\projectordesk`. Step 1 wires up only start/stop and placement. The remaining methods arrive in steps 4–7 without changing the contract's shape.

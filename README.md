# ProjectorDesk

A Windows presenter tool with two windows:

- **Control Panel** on the primary monitor: choose what goes on the projector.
- **Output window**: borderless, full-screen and black, on the projector display (extended mode). It shows only the selected window, letterboxed.

Phase 1 is Electron + TypeScript + React/Tailwind. Phase 2, a native Windows.Graphics.Capture engine, is described in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

> **Status: build step 1 (scaffold) — waiting on the hardware gate.** Display
> placement, mixed-DPI verification, content protection and basic hot-plug
> handling are in place. Source selection and capture come in later steps.

## Setup

Requirements: Windows 10 2004 (build 19041) or newer, Node.js 22+.

```powershell
npm install
npm run dev        # run with hot reload
npm run check      # typecheck + ESLint + Prettier
npm run dist:win   # NSIS installer + portable exe in dist/
```

## Set Windows to Extend

The projector must be an **extended** display, not a duplicate:

1. Press **Win+P**.
2. Choose **Extend**.

If ProjectorDesk sees only one display, it shows "Projector not detected or set to Duplicate."

## Step 1 hardware gate

Run this with a real projector or second monitor. Display-bounds bugs only show up on real hardware with mixed DPI scaling.

1. `npm run dev`. The Output window should go black, full screen, on the secondary display.
2. In the Control Panel, turn on **Test pattern**. On the projector, check that:
   - the red border and all four yellow corners are visible;
   - the circle is round;
   - the "Rendering" line is green: `DIP × DPR` equals the display's native pixel size.
3. The **Output placement** card should say "Covers display exactly". Every mismatch, and every correction the app made, is logged.
4. Repeat for each item in the **Step 1 hardware gate** card and mark Pass/Fail. Marking an item records a snapshot of the current display layout and placement.
   - Primary at 125% or 150%, secondary at 100%, and the reverse.
   - Secondary left of, right of, and above the primary (Settings → System → Display, drag the monitors).
   - Projector at a non-native resolution (e.g. 1024×768 or 1280×800).
   - Unplug and replug the projector while the app runs. Output must hide on unplug and return on replug.
5. Click **Copy report** and paste the Markdown report back into the task.

The log file is at `%APPDATA%\ProjectorDesk\logs\projectordesk.log`.

## Known limits

- Minimized windows cannot be captured. Restore them first.
- DRM-protected content (Netflix, some players) shows as black.
- Phase 1 output is SDR only. HDR sources are tone-mapped.
- Content protection (recursive-mirror prevention) needs Windows 10 2004+. On older builds the app shows a persistent warning.

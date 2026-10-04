# ProjectorDesk

A Windows presenter tool with two windows:

- **Control Panel** on the primary monitor: choose what goes on the projector.
- **Output window**: borderless, full-screen and black, on the projector display (extended mode). It shows only the selected window, letterboxed.

Phase 1 is Electron + TypeScript + React/Tailwind. Phase 2, a native Windows.Graphics.Capture engine, is described in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

> **Status: step 2 complete — display detection, Extend button and hot-plug verified on
> hardware ([`docs/HARDWARE_GATE.md`](docs/HARDWARE_GATE.md)).** Source selection and capture
> come in later steps.

## Setup

Requirements: Windows 10 2004 (build 19041) or newer, Node.js 22.12+ (npm 12 needs Node 22.22.2+).

```powershell
npm install
npm run dev        # run with hot reload
npm run check      # typecheck + ESLint + Prettier
npm run dist:win   # NSIS installer + portable exe in dist/
```

### Install scripts (npm 12+)

npm 12 blocks dependency install scripts unless `package.json` → `allowScripts` lists them:

| Package                     | Decision | Why                                                                                                                                                                        |
| --------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `esbuild` (pinned versions) | allowed  | Vite/electron-vite build tool; postinstall verifies its native binary                                                                                                      |
| `electron-winstaller`       | denied   | Only used by electron-builder's Squirrel.Windows target; we build NSIS + portable                                                                                          |
| `electron`                  | —        | Electron 44 has no install script. The project's own `postinstall` runs `install-electron` (checksum-verified download) so the binary is present right after `npm install` |

Entries are pinned to exact versions. After upgrading a dependency, npm lists any new
unreviewed scripts at the end of the install; review them with `npm install-scripts ls` and
approve with `npm install-scripts approve <pkg>`.

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
   - the "Rendering" line is green: `DIP × DPR` equals the display's native pixel size (within 1–2 px rounding at 125%/150%).
3. The **Output placement** card should say "Covers display exactly". Every mismatch, and every correction the app made, is logged.
4. Repeat for each item in the **Step 1 hardware gate** card and mark Pass/Fail. **Pass only becomes clickable while the current layout actually demonstrates that item** (e.g. the secondary really is left of the primary, and placement is OK). The amber hint under each item says what to change. Marking records a snapshot of the layout as evidence. The unplug/replug item unlocks once the app has seen the projector removed and the Output restored.
   - Primary at 125% or 150%, secondary at 100%, and the reverse.
   - Secondary left of, right of, and above the primary (Settings → System → Display, drag the monitors).
   - Projector at a non-native resolution (e.g. 1024×768 or 1280×800).
   - Unplug and replug the projector while the app runs. Output must hide on unplug and return on replug.
5. Click **Copy report** and paste the Markdown report back into the task.

The log file is at `%APPDATA%\ProjectorDesk\logs\projectordesk.log`.

## Step 2 hardware check

1. **Projector dropdown** (Projector card): lists every display with resolution, scale and colour
   depth/space. "Automatic" picks the first non-primary display; the primary is shown but
   disabled because it hosts the Control Panel.
2. **Switch to Extend**: press Win+P → Duplicate. The banner "Projector not detected or set to
   Duplicate" appears. Click **Switch to Extend**: the app runs `DisplaySwitch.exe /extend`
   (falls back to `DisplaySwitch.exe 3`), waits for the second display and re-places the Output.
3. **Main-display swap**: Settings → Display → select the projector → "Make this my main
   display". The Control Panel follows the new primary and the Output moves to the other
   screen. Swap back afterwards.
4. **Unplug / replug**: Output hides immediately with a "Projector disconnected" banner, and
   returns on the same display when it is plugged back in. A _different_ display plugged in is
   treated as the new projector; a display that was already connected is never used silently.

Mark the three step-2 items in **Hardware checks** (Pass unlocks only after the app has seen the
event), then **Copy report**.

## Known limits

- Minimized windows cannot be captured. Restore them first.
- DRM-protected content (Netflix, some players) shows as black.
- Phase 1 output is SDR only. HDR sources are tone-mapped.
- Content protection (recursive-mirror prevention) needs Windows 10 2004+. On older builds the app shows a persistent warning.

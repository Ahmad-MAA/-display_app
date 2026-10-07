# ProjectorDesk

A Windows presenter tool: put exactly one window (or screen) on the projector, and nothing else.

- **Control Panel** on your laptop screen: pick what the audience sees, blank or freeze it, switch
  sources.
- **Output** on the projector: borderless, full screen, black. It shows only the selected window,
  scaled to fit. Notifications, other apps and the Control Panel never appear on it.

Phase 1 (this repository) is Electron + TypeScript + React/Tailwind. Phase 2, a native
Windows.Graphics.Capture engine for sub-frame latency, HDR and cursor hiding, is planned in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#phase-2-native-output-engine).

> **Status: Phase 1 complete (build steps 1–8), verified on hardware** (Windows 11, 125 % laptop
> panel + 1080p monitor). Open item: the builds are unsigned (see [Code signing](#code-signing)).
> Results: [`docs/HARDWARE_GATE.md`](docs/HARDWARE_GATE.md).

## Install

Requirements: Windows 10 version 2004 (build 19041) or newer, 64-bit.

Two builds (see [Building the installer](#building-the-installer)):

- **`ProjectorDesk-Setup-<version>.exe`**: installs for the current user (no admin needed), adds
  Start menu and desktop shortcuts, uninstalls from Settings → Apps.
- **`ProjectorDesk-<version>-portable.exe`**: runs without installing, e.g. from a USB stick.

**Unsigned builds.** Until releases are [code-signed](#code-signing), Windows may refuse to run
them:

- **SmartScreen** says "Windows protected your PC": click **More info → Run anyway**.
- **Smart App Control** (Windows 11) and some **OEM or antivirus security** tools can block an
  unsigned app **outright**, with no "Run anyway" option ("publisher couldn't be verified"). Seen
  in testing: Smart App Control first blocked both the portable exe and the installed app; it
  later cleared that installed build, but every new build is a new executable and can be
  blocked again. Don't turn Smart App Control off
  to get around it (on many Windows versions it can't be turned back on without reinstalling
  Windows); sign the builds instead.

Settings, favorites and logs live in `%APPDATA%\ProjectorDesk` and survive upgrades and
uninstalling.

## Quick start

1. Connect the projector and press **Win+P → Extend**. (Duplicate mirrors your whole screen,
   which is what ProjectorDesk avoids. If only one display is active, the Control Panel offers
   **Switch to Extend**.)
2. Start ProjectorDesk. The projector goes black: that's the Output, waiting.
3. In **Sources**, click a window. It appears on the projector; **Now projecting** shows a live
   preview of exactly what the audience sees.
4. Click another card to switch (a short fade through black), or **Stop** to go black.

## Using ProjectorDesk

### Sources

- **Windows** lists every app window with a live thumbnail, icon and app name; **Screens** lists
  whole displays. The list refreshes every 2 s while the Control Panel is in front. Type in the
  filter box to narrow by title or app.
- **Minimized windows** stay in the list, greyed out. Picking one restores it without taking
  focus from the Control Panel, then projects it.
- **Closing the projected window** turns the projector black and the panel says "Source closed".
- **Projecting the projector's own screen** is safe: the Output is excluded from capture, so there
  is no endless mirror.

### Fill modes and crop

In _Now projecting_:

- **Fit** (default): the whole picture, black bars where its shape differs from the projector.
- **Fill**: fills the projector, trimming the edges that don't fit.
- **Stretch**: fills the projector, distorting the shape.
- **Crop…**: drag over a larger live view of the source to pick the region the audience sees, then
  **Apply crop**. The region keeps its shape and is placed by the fill mode. **Clear crop** shows
  the whole picture again. A crop belongs to one source; picking another clears it.

### Presenter controls and hotkeys

| Action                                        | In the Control Panel | From any app (global)    |
| --------------------------------------------- | -------------------- | ------------------------ |
| Blank: projector black, capture keeps running | **B**                | **Ctrl+Alt+B**           |
| Freeze the current frame                      | **F**                | **Ctrl+Alt+F**           |
| Fill mode Fit → Fill → Stretch                | **M**                | **Ctrl+Alt+M**           |
| Stats overlay on the projector                | **S**                | **Ctrl+Alt+S**           |
| Show / hide the mouse cursor¹                 | **C**                | **Ctrl+Alt+C**           |
| Next / previous source                        | **Ctrl+→ / Ctrl+←**  | **Ctrl+Alt+PgDn / PgUp** |
| Emergency hide / show the Output              | **Esc**              | **Ctrl+Alt+H**           |

¹ Not possible in Phase 1; see [Known limits](#known-limits).

- The same toggles are buttons in _Now projecting_.
- **Global hotkeys don't take focus**, so a video player stays in its own full screen while you
  switch sources. (Windows Media Player leaves full screen when you click the Control Panel.)
- Change them under **Settings → Global hotkeys**. Each needs Ctrl, Alt or Win, so it can't
  steal a letter from the app you're typing in. Avoid Ctrl+Alt+arrows: many Intel graphics
  drivers rotate the screen on them. If another app already owns a combination, Settings says so
  and the panel key / button still works.
- **Stats** shows delivered fps, dropped frames and capture-to-display latency, measured on the
  Output.

### Follow full screen (video players, slide shows)

Windows Media Player, VLC and PowerPoint's slide show go full screen in a **separate** window. With
**Follow full screen** on (the default), ProjectorDesk switches to that window and back when you
exit; the panel says "Following full screen".

| App                                                | What happens when you go full screen                     |
| -------------------------------------------------- | -------------------------------------------------------- |
| Windows Media Player, VLC, PowerPoint slide show   | capture follows the full-screen window, then comes back  |
| Chrome / Edge (YouTube etc.)                       | the same window goes full screen; capture just continues |
| A full-screen window that can't be window-captured | falls back to capturing the whole screen it's on         |

PowerPoint's Presenter View is never followed, only the slide show.

### Slide shows (WPS Office, PowerPoint): play them on Monitor 1

With **Presenter View** on, WPS and PowerPoint put the slide show **always-on-top on the second
monitor**, which is the projector. It covers ProjectorDesk's Output, and picking another source
seems to do nothing until the slide show ends. ProjectorDesk shows a red **"Another window is
covering the projector"** warning when this happens.

Let ProjectorDesk put the slides on the projector instead:

- **WPS Office**: Slide Show → Set Up Show → _Show on_: **Monitor 1** (your laptop screen), and
  turn **Presenter View off**.
- **PowerPoint**: Slide Show tab → _Monitor_: **Primary Monitor**, and untick **Use Presenter
  View**.
- Start the slide show, then pick the presentation window in ProjectorDesk. Follow full screen
  switches to the slide-show window automatically.

### Settings, favorites and resume

Everything is saved automatically to `%APPDATA%\ProjectorDesk\settings.json`:

- the projector you picked in the **Projector** dropdown, the fill mode, Follow full screen and
  the global hotkeys;
- **Favorites**: ☆ on any card pins it to the Favorites bar. Window ids change every time an app
  restarts, so favorites are matched by app and title (a title that contains the saved one, or the
  only window of that app, also matches). A favorite whose app isn't open is greyed out.
- **Resume last projection**: on the next start, if what was on the projector is open again, a
  banner offers to project it. Nothing is projected until you click **Resume**.

A damaged settings file is set aside as `settings.corrupt-<time>.json` and defaults are used.

### Displays

- **Projector dropdown**: "Automatic" uses the first display that isn't your main one. The Output
  follows display changes: unplugging the projector hides it, plugging it back in restores it,
  and making another display the main one swaps the windows.
- Mixed scaling (e.g. laptop at 125 %, projector at 100 %) is handled: the Output covers the
  projector exactly. **Test pattern** draws a border, corner marks and a circle on the projector
  to check this.

## Troubleshooting

| You see                                      | Meaning / what to do                                                                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Projector not detected or set to Duplicate" | Only one display is active. Win+P → Extend, or click **Switch to Extend**.                                                                        |
| "Projector disconnected"                     | The Output is hidden and comes back when the display returns. **Use another display** picks a different one.                                      |
| "Another window is covering the projector"   | An always-on-top window (usually a slide show) is on the projector. See [Slide shows](#slide-shows-wps-office-powerpoint-play-them-on-monitor-1). |
| "Output hidden"                              | Emergency hide is on (Esc / Ctrl+Alt+H). **Show Output** brings it back.                                                                          |
| "Recursive-mirror protection unavailable"    | Windows older than 10 2004: projecting the projector's own screen would mirror endlessly, so that screen is disabled.                             |
| "Window helper unavailable"                  | PowerShell couldn't start (e.g. blocked by policy). Projection works; app names, minimized windows and follow are missing.                        |
| "Something went wrong"                       | An unexpected error, or a crashed page that was reloaded automatically. Details are in the log; **Dismiss** closes it.                            |
| The projector shows black for a video        | DRM-protected content (Netflix, some players) captures as black. Nothing to fix on our side.                                                      |

- **Log**: Diagnostics → Log, or `%APPDATA%\ProjectorDesk\logs\projectordesk.log`.
- **Copy report** (top right) copies a Markdown report with displays, placement, sources, the
  follow trace and recent warnings. Paste it into a bug report.
- **Crashes**: if the Output's page crashes it is reloaded and the projection restarts by itself;
  if the Control Panel's page crashes it is reloaded and the projector is unaffected. After three
  crashes in a minute ProjectorDesk stops retrying and asks you to restart it.

## Known limits

Phase 1 limits; the native engine (Phase 2) removes the first three.

- **The mouse cursor is always captured.** Chromium ignores "hide cursor", so the C toggle
  reports "can't hide (Phase 1)". A side effect: when the pointer rests over a text box it
  becomes an I-beam, and Windows hides and shows it while you type, so on the projector it
  looks like a **blinking text caret** in the projected app. It is the pointer, not keyboard
  focus. Move the pointer off the projected window's text areas (or over the Control Panel).
- **Latency**: capture-to-display measured on hardware is ~25 ms median (≈1.5 frames at 60 Hz),
  above the one-frame target. Every projection session is recorded in
  `%APPDATA%\ProjectorDesk\logs\sessions.jsonl` as evidence for the native engine.
- **SDR only**: HDR sources are tone-mapped; a banner says so when an HDR display is present.
- A window that is always-on-top on the projector (a slide show with Presenter View) covers the
  Output. ProjectorDesk warns but can't push it away.
- Restoring a minimized window that was maximized brings it to the front on your laptop screen
  (Windows can only re-maximize by activating it); the Control Panel takes focus back
  immediately.
- DRM-protected video captures as black.
- Projecting the projector's own screen needs Windows 10 2004+ (capture exclusion).
- **Unsigned builds can be blocked by Smart App Control.** On a Windows 11 PC with Smart App
  Control on, the installed app and the portable exe were blocked outright ("publisher couldn't
  be verified", no "Run anyway"). Smart App Control later cleared the installed 0.1.0 build on
  the test PC, but each new unsigned build or executable is judged afresh and may be blocked
  again. Until the builds are [code-signed](#code-signing), run from
  source with `npm run dev` on such PCs (see [Development](#development)).

## Development

Requirements: Node.js 22.12+ (npm 12 needs Node 22.22.2+). Builds run on Windows; the app only
works on Windows.

```powershell
npm install
npm run dev        # run with hot reload
npm run check      # typecheck (strict) + ESLint + Prettier + unit tests
npm run dist:win   # NSIS installer + portable exe in dist/
```

### Install scripts (npm 12+)

npm 12 blocks dependency install scripts unless `package.json` → `allowScripts` lists them:

| Package                     | Decision | Why                                                                                                                                                                        |
| --------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `esbuild` (pinned versions) | allowed  | Vite/electron-vite build tool; postinstall verifies its native binary                                                                                                      |
| `electron-winstaller`       | denied   | Only used by electron-builder's Squirrel.Windows target; we build NSIS + portable                                                                                          |
| `electron`                  | —        | Electron 44 has no install script. The project's own `postinstall` runs `install-electron` (checksum-verified download) so the binary is present right after `npm install` |

Entries are pinned to exact versions. After upgrading a dependency, npm lists any new unreviewed
scripts at the end of the install; review them with `npm install-scripts ls` and approve with
`npm install-scripts approve <pkg>`.

### Building the installer

`npm run dist:win` on Windows produces in `dist/`:

- `ProjectorDesk-Setup-<version>.exe` (NSIS, per-user, choose folder, shortcuts);
- `ProjectorDesk-<version>-portable.exe`;
- `win-unpacked/` (the app folder, for quick testing).

Configuration is in `electron-builder.yml`; the icon is `resources/icon.ico`. There are no native
modules and no runtime npm dependencies: the package contains only the compiled `out/` folder.
Building the NSIS installer on Linux/macOS needs Wine (including 32-bit Wine on Linux); signing
(below) needs Windows.

### Code signing

Unsigned builds can be blocked outright (see [Install](#install)). The recommended route is
**Azure Trusted Signing** (Microsoft's managed code-signing service; newer Azure documentation may
call it _Artifact Signing_), which electron-builder supports natively through
`win.azureSignOptions`. Its certificates are trusted by Windows, SmartScreen and Smart App
Control, and there is no hardware token to manage.

**One-time Azure setup** (Azure portal; check Microsoft's current eligibility rules first:
organizations need a verifiable business history, and individual developers are accepted only
in some countries):

1. In your subscription, register the resource provider **Microsoft.CodeSigning**.
2. Create a **Trusted Signing account** (pick a region and the Basic tier). Note its **account
   name** and **endpoint**, e.g. `https://eus.codesigning.azure.net/` for East US.
3. In the account, complete **Identity validation** (Public Trust) for your organization or
   yourself. This takes from hours to days.
4. Create a **Certificate profile** of type _Public Trust_ linked to that validation. Note its
   **name**. Its subject CN is the publisher name Windows will show.
5. In **Microsoft Entra ID → App registrations**, register an app (e.g. `projectordesk-signing`)
   and create a **client secret**. Note the tenant ID, client (application) ID and the secret.
6. On the Trusted Signing account, **Access control (IAM) → Add role assignment →
   "Trusted Signing Certificate Profile Signer"** for that app registration.

**Configure the build.** Add to `electron-builder.yml` under `win:` (none of these values are
secret):

```yaml
win:
  azureSignOptions:
    publisherName: Your Name or Company # exactly the certificate's CN
    endpoint: https://eus.codesigning.azure.net/
    codeSigningAccountName: your-account-name
    certificateProfileName: your-profile-name
```

Then build on Windows with the credentials in the environment. Never commit them; in CI use
repository secrets:

```powershell
$env:AZURE_TENANT_ID = "<tenant id>"
$env:AZURE_CLIENT_ID = "<app registration client id>"
$env:AZURE_CLIENT_SECRET = "<client secret>"
npm run dist:win
```

electron-builder installs the `TrustedSigning` PowerShell module on first use and signs the app
exe, the installer, its uninstaller and the portable exe, with a SHA-256 RFC 3161 timestamp
(`http://timestamp.acs.microsoft.com`). Trusted Signing certificates live only a few days. The
timestamp keeps signatures valid after the certificate expires, so don't disable it.

**Check the result:** right-click the exe → Properties → **Digital Signatures**, or

```powershell
Get-AuthenticodeSignature .\dist\ProjectorDesk-Setup-0.1.0.exe | Format-List Status, SignerCertificate
```

`Status` must be `Valid`. SmartScreen reputation still builds up over the first downloads, but
the "publisher couldn't be verified" block goes away.

Alternative: a conventional OV/EV certificate works through electron-builder's
`win.signtoolOptions` (or `CSC_LINK` / `CSC_KEY_PASSWORD` for a `.pfx`). Since 2023 these keys
must be on a hardware token or cloud HSM, which is why Trusted Signing is simpler here.

### Project layout

| Path                   | What                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `src/main/`            | Electron main process: windows, placement, capture routing, window helper, settings |
| `src/preload/`         | Sandboxed preloads exposing the typed APIs                                          |
| `src/renderer/control` | Control Panel (React)                                                               |
| `src/renderer/output`  | Output page (plain TS: video, crop canvas, blank/freeze, stats)                     |
| `src/shared/`          | Pure, unit-tested logic and the IPC / OutputEngine contracts                        |
| `docs/`                | Architecture, Phase 2 plan, hardware verification results                           |

### Hardware verification

Display, DPI and capture bugs only show on real hardware. **Diagnostics → Hardware checks**
lists every check with what to do; **Pass** unlocks only while the live layout actually
demonstrates the item, and records a snapshot as evidence. **Copy report** includes the
checklist. Results so far: [`docs/HARDWARE_GATE.md`](docs/HARDWARE_GATE.md).

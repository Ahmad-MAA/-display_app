# Step 1 hardware gate — results

Hardware: Windows 11 build 26300, internal 1920×1200 panel (primary) + ASUS VA27EHE
1920×1080 (secondary). Content protection: `isContentProtected=true`, build ≥ 19041 → OK.

Consolidated from three report rounds (2026-10-04). Final full-screen bounds were exact
(`expected == actual`, matched display correct) in every case below.

| Check                              | Result | Evidence                                                                             |
| ---------------------------------- | ------ | ------------------------------------------------------------------------------------ |
| Primary 125/150 %, secondary 100 % | PASS   | P 1280×800 ×1.5, S 1920×1080 ×1 @ (1280, 82) → output exact                          |
| Primary 100 %, secondary 125/150 % | PASS   | P ×1, S 1280×721 ×1.5 @ (1920, 116) → output exact (report 1)                        |
| Secondary LEFT of primary          | PASS   | placement @ (−1920, 92), P ×1.25 → no placement error (report 3 log)¹                |
| Secondary RIGHT of primary         | PASS   | @ (1920, 116) and @ (1536, 97) → output exact                                        |
| Secondary ABOVE primary            | PASS   | S 1920×1080 @ (98, −1080), P ×1.25 → output exact                                    |
| Non-native projector resolution    | PASS   | 1024×641 and 820×616 DIP @ 125 % (≈1280×800 / 1024×768 px) → settled (report 1 log)  |
| Unplug / replug while running      | PASS   | removed → Output hidden → re-added → restored exact (report 1); re-verify in step 2² |

¹ The checklist snapshot for this item was overwritten when Pass was clicked again in a
different layout (fixed: re-clicking a result no longer replaces its evidence).
² Hot-plug code gained stale-viewport suppression after report 1; step 2 (hot-plug
handling) re-tests it.

## Issues found and fixed

- Windowed read-back off by 1–2 DIP at fractional scales (rounding) → tolerance using the
  larger of the source/target monitor's scale; full-screen check stays exact.
- Spurious "wrong DPI" warnings during scale/resolution changes → viewport checks suspended
  until re-placement settles.
- Test pattern false MISMATCH at 150 % → rounding tolerance.
- Checklist accepted Pass without matching layout → Pass gated on live layout.
- Re-clicking Pass overwrote evidence → no-op.

# Step 2 hardware check — results

Same hardware, 2026-10-04. Primary at 125 %, ASUS at 100 %. Log shows no placement
warnings at all after the step-1 rounding fixes.

| Check                                                          | Result | Evidence                                                    |
| -------------------------------------------------------------- | ------ | ----------------------------------------------------------- |
| Duplicate → "Switch to Extend" → Output returns                | PASS   | `extendSuccesses > 0`; Output exact @ (98, −1080)           |
| Projector made main display → Control Panel / Output swap      | PASS   | `primarySwaps > 0`; swapped back, Output exact @ (1536, 97) |
| Unplug / replug (re-test with step-2 code)                     | PASS   | 4 unplug → replug cycles, each hidden then restored exactly |
| Step-1 regressions (primary 150 %, right, non-native 1280×800) | PASS   | Output exact in each                                        |

Not testable with two displays: choosing between several projectors in the dropdown.

# Step 3 hardware check — results

Same hardware, 2026-10-04.

| Check                                                                                 | Result           | Evidence                                                                                                                                                                       |
| ------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Windows tab: thumbnails, icons, process names; ProjectorDesk not listed               | PASS             | 11 windows, 11/11 with process name (e.g. `olk`, `msedge`, `Code`, `ApplicationFrameHost` for Settings)                                                                        |
| Minimized window stays, greyed, with restore hint; restore brings live thumbnail back | PASS (after fix) | First run FAILED: Electron omits minimized windows. Fixed via window helper (`EnumWindows` + `IsIconic`); re-test listed 3 minimized windows incl. one minimized before launch |
| Screens tab: both screens, projector one marked                                       | PASS             | `Screen 2 · ASUS VA27EHE · projector`                                                                                                                                          |
| New app appears within ~2 s; filter narrows                                           | PASS             | —                                                                                                                                                                              |

# Step 4 hardware check — results

Same hardware, 2026-10-04. All five checks PASS: window projection without distortion and live
preview; switch with fade through black; minimized card restores without stealing focus
(including a window that was maximized before minimizing: focus handed back); closing the
projected window → "Source closed"; projecting the ASUS (projector) screen → **no recursive
mirror**.

Issue found: **Windows Media Player full screen** showed only the window frame, and picking WMP
while in full screen failed with `NotReadableError`. WMP hides its main window and plays full
screen in a separate window, which window capture doesn't follow. Fix: "Follow full screen"
(see ARCHITECTURE.md). Awaiting re-test with WMP, VLC, Chrome/YouTube and PowerPoint.

# Follow full screen — results

Same hardware, 2026-10-04.

| Check                                                              | Result   | Notes                                                                                           |
| ------------------------------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------- |
| Windows Media Player full screen followed, back on exit            | PASS     | Log shows the follower briefly locking onto WMP's transient `WMPTransition` window; now skipped |
| Chrome/Edge YouTube full screen                                    | PASS     | Same window, no follow needed                                                                   |
| PowerPoint-style slide show follows (WPS, slide show on Monitor 1) | PASS     | —                                                                                               |
| VLC                                                                | untested | —                                                                                               |

Findings:

- WMP leaves its own full screen when it loses focus (clicking the Control Panel). ProjectorDesk
  only moves focus after restoring a minimized card; accepted as WMP behaviour. Step 6 hotkeys
  must switch sources without taking focus.
- WPS slide show with Presenter View is topmost on the projector and covers the Output. Added a
  "covering the projector" warning; workaround documented (slide show on Monitor 1, Presenter View off).
- Restoring a minimized-while-maximized window shows it maximized in front (expected: activation
  is required to re-maximize).

# Step 5 hardware check — results

Same hardware, 2026-10-04. Fill modes, crop reset on source switch and the terminal black-frame
fix PASS (crop editor itself untested).

**Covering warning FAILED**, and the report exposed why: `Window helper unavailable (could not
start PowerShell: Error: spawn ENAMETOOLONG)`. The helper script was passed with
`-EncodedCommand` (35,412 chars), over Windows' 32,767-character command-line limit after the
follow/covering code was added. Everything helper-based was silently off in that build (process
names "0 with process name", minimized windows, Follow full screen, covering warning).
Fix: script written to userData and run via a short ScriptBlock bootstrap (<2,000 chars);
helper failures now show a Control Panel banner and appear in Copy report. Re-test needed.

# Step 6 hardware check — results

Same hardware, 2026-10-04. Window helper fix PASS (process names back), covering warning PASS,
B / F / S / M / Esc PASS, global hotkeys PASS (Ctrl+Alt+PgDn/PgUp switched sources while WMP stayed
full screen).

- **C (hide cursor) FAIL**: log `cursor: always`. Chromium accepts `cursor: 'never'` but draws the
  cursor anyway; no Phase 1 workaround. The button now reports this instead of toggling.
- **WMP Follow full screen regressed** (blank / stuck frame). The report only carried warnings,
  so the follower's decisions weren't visible. Changes: candidates ranked so transparent/layered
  overlays (a player's full-screen controls bar) lose to the real video window; screen fallback
  needs black to persist ~2 s; every follower step is logged with `Follow:` and included in Copy
  report. Re-test needed.
- **Blinking caret in the projected app while typing elsewhere**: ProjectorDesk only moves focus
  after restoring a minimized card. Added Diagnostics → "Check focus in 5 s" (foreground window +
  GetGUIThreadInfo of the projected window's thread) to show whether Windows gives it focus.
- Sessions: median latency ~25 ms (≈1.5 frames) on every session → above the one-frame budget.
  That's the Phase 2 evidence; it's now logged once as a warning, sessions < 10 s are ignored.
- Rapid Esc presses raced a placement ("not in full-screen mode" error); a hide now cancels an
  in-flight placement and keeps the Output hidden.
- Stats were bogus while the Output was hidden (no compositing → huge "drops"); now discarded,
  and counters restart when it's visible again.

# Step 6 re-test

- Cursor: PASS (button reports "can't hide (Phase 1)").
- **Follow full screen with WMP: FAIL, root cause found.** The report's "Follow full screen trace"
  was empty: the follower never committed a decision, i.e. it saw no full-screen window it was
  willing to follow. Cause: an earlier change skipped windows titled `WMPTransition`, assuming a
  transient animation window. That was a misreading of the earlier log: `WMPTransition` **is**
  WMP's full-screen video window (its "capture ended" lines were the exits from full screen).
  The skip is removed; the follower now logs every change in what it sees (followed or not), so
  an empty trace can't hide a rejected candidate again. Re-test needed.
- Caret focus check: untested.

# Step 7 (settings, favorites, configurable hotkeys)

Container end-to-end run (Linux, Xvfb): Fill + a favorite + Blank rebound to Ctrl+Alt+J were
written to `settings.json`; after a restart Fill, the favorite, the hotkey and the Resume banner
were all back, Resume projected the window, and Ctrl+Alt+J blanked from outside the panel.
Closing the Control Panel quits the app within ~2 s. Hardware: the "Step 7" items, pending.

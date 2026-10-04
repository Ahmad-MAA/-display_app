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

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

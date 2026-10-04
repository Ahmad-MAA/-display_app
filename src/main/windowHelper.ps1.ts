/**
 * Script run by the hidden PowerShell helper (see windowHelper.ts).
 *
 * Must work in Windows PowerShell 5.1, whose Add-Type compiles C# 5: no inline `out var`,
 * no string interpolation, no `?.`, no expression-bodied members.
 *
 * Protocol: one JSON request per stdin line, one JSON response per stdout line, in order.
 *   {"op":"names","hwnds":["123",...]}  → {"ok":true,"result":{"123":"POWERPNT"|null}}
 *   {"op":"minimized"}                  → {"ok":true,"result":[{"hwnd":"123","title":"…","processName":"…"}]}
 *   {"op":"restore","hwnd":"123"}       → {"ok":true,"result":{"restored":true,"activated":false}}
 * Failures → {"ok":false,"error":"…"}
 */
export const WINDOW_HELPER_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public class PdWindow {
  public string hwnd { get; set; }
  public string title { get; set; }
  public string processName { get; set; }
}

public class PdRestoreResult {
  public bool restored { get; set; }
  public bool activated { get; set; }
}

public static class PdWin {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hWnd, int index);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int max);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out int value, int size);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] static extern bool GetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT placement);

  [StructLayout(LayoutKind.Sequential)]
  struct POINT { public int x; public int y; }
  [StructLayout(LayoutKind.Sequential)]
  struct RECT { public int left; public int top; public int right; public int bottom; }
  [StructLayout(LayoutKind.Sequential)]
  struct WINDOWPLACEMENT {
    public int length; public int flags; public int showCmd;
    public POINT minPosition; public POINT maxPosition; public RECT normalPosition;
  }

  const int SW_SHOWMAXIMIZED = 3;
  const int SW_SHOWNOACTIVATE = 4;
  const int WPF_RESTORETOMAXIMIZED = 2;

  const uint GW_OWNER = 4;
  const int GWL_EXSTYLE = -20;
  const int WS_EX_TOOLWINDOW = 0x80;
  const int DWMWA_CLOAKED = 14;

  public static string ProcessName(IntPtr hWnd) {
    uint pid;
    GetWindowThreadProcessId(hWnd, out pid);
    if (pid == 0) return null;
    try { return Process.GetProcessById((int)pid).ProcessName; } catch { return null; }
  }

  static string Title(IntPtr hWnd) {
    int len = GetWindowTextLength(hWnd);
    if (len <= 0) return "";
    StringBuilder sb = new StringBuilder(len + 1);
    GetWindowText(hWnd, sb, sb.Capacity);
    return sb.ToString();
  }

  // Restore a minimized window WITHOUT activating it, so the Control Panel keeps focus.
  // SW_SHOWNOACTIVATE brings it back at its normal size. A window that was maximized
  // before minimizing can only return to maximized via SW_SHOWMAXIMIZED, which activates
  // it; 'activated' tells the caller to hand focus straight back to the Control Panel.
  public static PdRestoreResult Restore(IntPtr h) {
    PdRestoreResult r = new PdRestoreResult();
    if (!IsWindow(h)) { r.restored = false; return r; }
    if (!IsIconic(h)) { r.restored = true; return r; }
    WINDOWPLACEMENT wp = new WINDOWPLACEMENT();
    wp.length = Marshal.SizeOf(typeof(WINDOWPLACEMENT));
    bool toMax = GetWindowPlacement(h, ref wp) && (wp.flags & WPF_RESTORETOMAXIMIZED) != 0;
    ShowWindow(h, toMax ? SW_SHOWMAXIMIZED : SW_SHOWNOACTIVATE);
    r.activated = toMax;
    // ShowWindow returns before the restore animation finishes; wait for it (max 1.5 s).
    for (int i = 0; i < 30 && IsIconic(h); i++) System.Threading.Thread.Sleep(50);
    r.restored = !IsIconic(h);
    return r;
  }

  // Top-level, titled, minimized app windows: the ones a user would expect to see
  // in Alt+Tab. Owned windows, tool windows and cloaked windows are skipped.
  public static List<PdWindow> Minimized() {
    List<PdWindow> list = new List<PdWindow>();
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h) || !IsIconic(h)) return true;
      if (GetWindow(h, GW_OWNER) != IntPtr.Zero) return true;
      if ((GetWindowLong(h, GWL_EXSTYLE) & WS_EX_TOOLWINDOW) != 0) return true;
      int cloaked;
      if (DwmGetWindowAttribute(h, DWMWA_CLOAKED, out cloaked, 4) == 0 && cloaked != 0) return true;
      string title = Title(h);
      if (title.Length == 0) return true;
      PdWindow w = new PdWindow();
      w.hwnd = h.ToInt64().ToString();
      w.title = title;
      w.processName = ProcessName(h);
      list.Add(w);
      return true;
    }, IntPtr.Zero);
    return list;
  }
}
"@
[Console]::Out.WriteLine('READY')
[Console]::Out.Flush()
while ($null -ne ($line = [Console]::In.ReadLine())) {
  try {
    $req = ConvertFrom-Json -InputObject $line
    if ($req.op -eq 'names') {
      $out = @{}
      foreach ($h in @($req.hwnds)) {
        $name = $null
        try { $name = [PdWin]::ProcessName([IntPtr][long]$h) } catch { $name = $null }
        $out[[string]$h] = $name
      }
      $resp = @{ ok = $true; result = $out }
    } elseif ($req.op -eq 'restore') {
      $resp = @{ ok = $true; result = [PdWin]::Restore([IntPtr][long]$req.hwnd) }
    } elseif ($req.op -eq 'minimized') {
      $resp = @{ ok = $true; result = @([PdWin]::Minimized()) }
    } else {
      $resp = @{ ok = $false; error = ('unknown op ' + $req.op) }
    }
  } catch {
    $resp = @{ ok = $false; error = $_.Exception.Message }
  }
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject $resp -Compress -Depth 5))
  [Console]::Out.Flush()
}
`;

using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.Graphics.Gdi;
using Windows.Win32.UI.WindowsAndMessaging;

namespace ProjectorDesk.Engine;

/// <summary>
/// The engine's output surface: a borderless black popup on the projector. No taskbar button,
/// never activated, and excluded from screen capture before it is first shown.
/// </summary>
[SupportedOSPlatform("windows10.0.19041.0")]
internal sealed unsafe class EngineWindow
{
    /// <summary>WDA_EXCLUDEFROMCAPTURE (Windows 10 2004+): the window is left out of every capture.</summary>
    public const uint ExcludeFromCapture = 0x11;

    private const string ClassName = "ProjectorDesk.Engine.Output";
    private static readonly HWND HwndTopmost = new(-1);
    private static readonly HWND HwndTop = new(0);

    // Kept in a static field so the GC never collects the delegate Windows calls back into.
    private static readonly WNDPROC WndProcDelegate = WndProc;

    public HWND Handle { get; }

    private EngineWindow(HWND handle) => Handle = handle;

    public static EngineWindow Create(bool topmost)
    {
        var instance = PInvoke.GetModuleHandle((PCWSTR)null);
        fixed (char* className = ClassName)
        fixed (char* title = "ProjectorDesk Engine")
        {
            var wc = new WNDCLASSEXW
            {
                cbSize = (uint)Marshal.SizeOf<WNDCLASSEXW>(),
                lpfnWndProc = WndProcDelegate,
                hInstance = (HINSTANCE)instance.Value,
                hbrBackground = (HBRUSH)PInvoke.GetStockObject(GET_STOCK_OBJECT_FLAGS.BLACK_BRUSH).Value,
                hCursor = PInvoke.LoadCursor(default, PInvoke.IDC_ARROW),
                lpszClassName = className,
            };
            if (PInvoke.RegisterClassEx(in wc) == 0)
                throw new Win32Exception("RegisterClassEx");

            var exStyle = WINDOW_EX_STYLE.WS_EX_TOOLWINDOW | WINDOW_EX_STYLE.WS_EX_NOACTIVATE;
            if (topmost)
                exStyle |= WINDOW_EX_STYLE.WS_EX_TOPMOST;
            // Created hidden (no WS_VISIBLE): capture exclusion must be in place before it shows.
            var hwnd = PInvoke.CreateWindowEx(exStyle, className, title, WINDOW_STYLE.WS_POPUP, 0, 0, 0, 0,
                default, default, (HINSTANCE)instance.Value, null);
            if (hwnd.IsNull)
                throw new Win32Exception("CreateWindowEx");
            return new EngineWindow(hwnd);
        }
    }

    /// <summary>Sets WDA_EXCLUDEFROMCAPTURE and reads it back.</summary>
    public AffinityReport ExcludeFromScreenCapture()
    {
        var set = PInvoke.SetWindowDisplayAffinity(Handle, (WINDOW_DISPLAY_AFFINITY)ExcludeFromCapture);
        uint actual = 0;
        var read = PInvoke.GetWindowDisplayAffinity(Handle, &actual);
        var verified = set && read && actual == ExcludeFromCapture;
        var actualText = read ? $"0x{actual:X2}" : $"unreadable (error {Marshal.GetLastPInvokeError()})";
        return new AffinityReport("WDA_EXCLUDEFROMCAPTURE (0x11)", actualText, verified);
    }

    /// <summary>Shows the window over the target rectangle without activating it, then reads back where it ended up.</summary>
    public PlacementResult ShowOn(PixelRect target, bool topmost)
    {
        var ok = PInvoke.SetWindowPos(Handle, topmost ? HwndTopmost : HwndTop, target.X, target.Y, target.Width, target.Height,
            SET_WINDOW_POS_FLAGS.SWP_SHOWWINDOW | SET_WINDOW_POS_FLAGS.SWP_NOACTIVATE);
        if (!ok)
            throw new Win32Exception("SetWindowPos");

        if (!PInvoke.GetWindowRect(Handle, out var r))
            throw new Win32Exception("GetWindowRect");
        var monitor = PInvoke.MonitorFromWindow(Handle, MONITOR_FROM_FLAGS.MONITOR_DEFAULTTONEAREST);
        var info = new MONITORINFO { cbSize = (uint)sizeof(MONITORINFO) };
        if (!PInvoke.GetMonitorInfo(monitor, ref info))
            throw new Win32Exception("GetMonitorInfo");
        var m = info.rcMonitor;
        return Placement.Evaluate(target, new PixelRect(r.left, r.top, r.right - r.left, r.bottom - r.top),
            new PixelRect(m.left, m.top, m.right - m.left, m.bottom - m.top));
    }

    public void RequestClose() => PInvoke.PostMessage(Handle, PInvoke.WM_CLOSE, default, default);

    /// <summary>Standard message loop; returns when the window has been destroyed.</summary>
    public static void RunMessageLoop()
    {
        while (PInvoke.GetMessage(out var msg, default, 0, 0) > 0)
        {
            PInvoke.TranslateMessage(in msg);
            PInvoke.DispatchMessage(in msg);
        }
    }

    private static LRESULT WndProc(HWND hwnd, uint msg, WPARAM wParam, LPARAM lParam)
    {
        switch (msg)
        {
            case PInvoke.WM_DPICHANGED:
                // The placement is ours (the target display's exact bounds); ignore the rect
                // Windows suggests when the window lands on a monitor with another scale.
                return new LRESULT(0);
            case PInvoke.WM_DESTROY:
                PInvoke.PostQuitMessage(0);
                return new LRESULT(0);
            default:
                return PInvoke.DefWindowProc(hwnd, msg, wParam, lParam);
        }
    }
}

internal sealed class Win32Exception(string call)
    : Exception($"{call} failed (error {Marshal.GetLastPInvokeError()})");

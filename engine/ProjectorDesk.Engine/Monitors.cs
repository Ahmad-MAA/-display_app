using System.Globalization;
using System.Runtime.CompilerServices;
using System.Runtime.Versioning;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.Graphics.Gdi;

namespace ProjectorDesk.Engine;

internal sealed record MonitorInfo(int Index, string Device, PixelRect Bounds, bool Primary)
{
    public string Type => "monitor";
}

/// <summary>Monitors in physical pixels (the process is per-monitor DPI aware v2).</summary>
[SupportedOSPlatform("windows10.0.19041.0")]
internal static unsafe class Monitors
{
    public static IReadOnlyList<MonitorInfo> Enumerate()
    {
        var list = new List<MonitorInfo>();
        PInvoke.EnumDisplayMonitors(default, (RECT?)null, (hmon, _, _, _) =>
        {
            var info = new MONITORINFOEXW();
            info.monitorInfo.cbSize = (uint)sizeof(MONITORINFOEXW);
            if (PInvoke.GetMonitorInfo(hmon, ref Unsafe.As<MONITORINFOEXW, MONITORINFO>(ref info)))
            {
                var r = info.monitorInfo.rcMonitor;
                list.Add(new MonitorInfo(list.Count + 1, info.szDevice.ToString(),
                    new PixelRect(r.left, r.top, r.right - r.left, r.bottom - r.top),
                    (info.monitorInfo.dwFlags & PInvoke.MONITORINFOF_PRIMARY) != 0));
            }
            return true;
        }, default);
        return list;
    }

    /// <summary>Resolves --monitor secondary|primary|N.</summary>
    public static MonitorInfo Select(string selector)
    {
        var all = Enumerate();
        MonitorInfo? m = selector switch
        {
            "primary" => all.FirstOrDefault(x => x.Primary),
            "secondary" => all.FirstOrDefault(x => !x.Primary),
            _ => all.FirstOrDefault(x => x.Index == int.Parse(selector, CultureInfo.InvariantCulture)),
        };
        return m ?? throw new ArgumentException(selector == "secondary"
            ? "Only one monitor is active: connect the projector and set Windows to Extend (Win+P)."
            : $"No monitor '{selector}'. Run with --list-monitors to see them.");
    }
}

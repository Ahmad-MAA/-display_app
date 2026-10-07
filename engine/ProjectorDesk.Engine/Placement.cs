namespace ProjectorDesk.Engine;

internal sealed record PlacementResult(
    PixelRect Requested,
    PixelRect Actual,
    PixelRect Monitor,
    bool Exact,
    IReadOnlyList<string> Problems,
    IReadOnlyList<string> Notes);

/// <summary>
/// Phase 1's full-screen rule in physical pixels: the window must cover the monitor it is on
/// exactly, and that monitor must be the one the app asked for. The engine snaps to the monitor
/// containing the requested rectangle, so a rounding difference in Electron's DIP→pixel
/// conversion is a note, not a failure; landing on another monitor is a failure.
/// </summary>
internal static class Placement
{
    public static PlacementResult Evaluate(PixelRect requested, PixelRect actual, PixelRect monitor)
    {
        var problems = new List<string>();
        var notes = new List<string>();
        if (actual != monitor)
            problems.Add($"window is {actual}, its monitor is {monitor}");
        if (!Overlaps(requested, monitor))
            problems.Add($"window is on monitor {monitor}, not on the requested {requested}");
        else if (requested != monitor)
            notes.Add($"requested {requested}, snapped to the monitor's exact bounds {monitor}");
        return new PlacementResult(requested, actual, monitor, problems.Count == 0, problems, notes);
    }

    /// <summary>True when the monitor holds the larger part of the requested rectangle.</summary>
    private static bool Overlaps(PixelRect requested, PixelRect monitor)
    {
        long w = Math.Min(requested.X + requested.Width, monitor.X + monitor.Width) - Math.Max(requested.X, monitor.X);
        long h = Math.Min(requested.Y + requested.Height, monitor.Y + monitor.Height) - Math.Max(requested.Y, monitor.Y);
        if (w <= 0 || h <= 0)
            return false;
        return w * h * 2 > (long)requested.Width * requested.Height;
    }
}

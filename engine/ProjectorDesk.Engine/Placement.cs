namespace ProjectorDesk.Engine;

internal sealed record PlacementResult(PixelRect Requested, PixelRect Actual, PixelRect Monitor, bool Exact, IReadOnlyList<string> Problems);

/// <summary>
/// Same rule as Phase 1's full-screen check: the window must cover the target display exactly,
/// and Windows must consider it to be on that display. Physical pixels, so no rounding slack.
/// </summary>
internal static class Placement
{
    public static PlacementResult Evaluate(PixelRect requested, PixelRect actual, PixelRect monitor)
    {
        var problems = new List<string>();
        if (actual != requested)
            problems.Add($"window is {actual}, expected {requested}");
        if (monitor != requested)
            problems.Add($"window's monitor is {monitor}, expected {requested}");
        return new PlacementResult(requested, actual, monitor, problems.Count == 0, problems);
    }
}

namespace ProjectorDesk.Engine.Tests;

[TestClass]
public sealed class PlacementTests
{
    private static readonly PixelRect Projector = new(1920, 67, 1920, 1080);

    [TestMethod]
    public void ExactWhenWindowAndMonitorMatch()
    {
        var r = Placement.Evaluate(Projector, Projector, Projector);
        Assert.IsTrue(r.Exact);
        Assert.IsEmpty(r.Problems);
        Assert.IsEmpty(r.Notes);
    }

    [TestMethod]
    public void ReportsWrongSize()
    {
        // The classic mixed-DPI failure: Windows rescales the window by the DPI ratio.
        var r = Placement.Evaluate(Projector, Projector with { Width = 1536, Height = 864 }, Projector);
        Assert.IsFalse(r.Exact);
        Assert.IsTrue(r.Problems.Any(p => p.Contains("1536×864")));
    }

    [TestMethod]
    public void ReportsWrongMonitor()
    {
        var laptop = new PixelRect(0, 0, 1920, 1200);
        var r = Placement.Evaluate(Projector, laptop, laptop);
        Assert.IsFalse(r.Exact);
        Assert.HasCount(1, r.Problems);
        Assert.Contains("not on the requested", r.Problems[0]);
    }

    [TestMethod]
    public void SnapsSmallDifferencesAsANote()
    {
        // Electron's DIP→pixel conversion one pixel off: still the right monitor, exact cover.
        var requested = Projector with { Y = 68 };
        var r = Placement.Evaluate(requested, Projector, Projector);
        Assert.IsTrue(r.Exact);
        Assert.HasCount(1, r.Notes);
    }
}

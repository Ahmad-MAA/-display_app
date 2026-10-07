using System.Text.Json;

namespace ProjectorDesk.Engine.Tests;

[TestClass]
public sealed class EngineOutputTests
{
    [TestMethod]
    public void MessagesAreCamelCaseWithType()
    {
        var json = EngineOutput.Serialize(new ProbeMessage("direct3d11", true, "ok"));
        using var doc = JsonDocument.Parse(json);
        Assert.AreEqual("probe", doc.RootElement.GetProperty("type").GetString());
        Assert.AreEqual("direct3d11", doc.RootElement.GetProperty("name").GetString());
        Assert.IsTrue(doc.RootElement.GetProperty("ok").GetBoolean());
    }

    [TestMethod]
    public void ReadyCarriesAffinityAndPlacement()
    {
        var p = new PixelRect(0, 0, 1280, 800);
        var json = EngineOutput.Serialize(new ReadyMessage("per-monitor v2",
            new AffinityReport("WDA_EXCLUDEFROMCAPTURE (0x11)", "0x11", true), Placement.Evaluate(p, p, p)));
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        Assert.AreEqual("ready", root.GetProperty("type").GetString());
        Assert.IsTrue(root.GetProperty("affinity").GetProperty("verified").GetBoolean());
        Assert.IsTrue(root.GetProperty("placement").GetProperty("exact").GetBoolean());
        Assert.AreEqual(1280, root.GetProperty("placement").GetProperty("actual").GetProperty("width").GetInt32());
    }

    [TestMethod]
    public void NullFieldsAreOmitted()
    {
        var json = EngineOutput.Serialize(new ErrorMessage("arguments", "bad", null));
        Assert.DoesNotContain("hresult", json);
    }
}

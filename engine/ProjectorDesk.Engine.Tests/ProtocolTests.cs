using System.Text.Json;

namespace ProjectorDesk.Engine.Tests;

[TestClass]
public sealed class ProtocolTests
{
    [TestMethod]
    public void DecodesStartWithBounds()
    {
        var cmd = Protocol.Decode("""{"v":1,"seq":3,"msg":{"type":"start","targetDisplayId":47307338,"bounds":{"x":1920,"y":67,"width":1920,"height":1080},"topmost":true}}""");
        var start = (StartCommand)cmd;
        Assert.AreEqual(47307338L, start.TargetDisplayId);
        Assert.AreEqual(new PixelRect(1920, 67, 1920, 1080), start.Bounds);
        Assert.IsTrue(start.Topmost);
    }

    [TestMethod]
    public void DecodesSimpleCommands()
    {
        Assert.IsInstanceOfType<StopCommand>(Protocol.Decode("""{"v":1,"seq":1,"msg":{"type":"stop"}}"""));
        Assert.IsInstanceOfType<ShutdownCommand>(Protocol.Decode("""{"v":1,"seq":2,"msg":{"type":"shutdown"}}"""));
        var u = (UnsupportedCommand)Protocol.Decode("""{"v":1,"seq":2,"msg":{"type":"setSource","source":null}}""");
        Assert.AreEqual("setSource", u.Type);
    }

    [TestMethod]
    [DataRow("""{"v":2,"seq":1,"msg":{"type":"stop"}}""", "protocol version 2")]
    [DataRow("""{"seq":1,"msg":{"type":"stop"}}""", "protocol version missing")]
    [DataRow("""{"v":1,"seq":1,"msg":{}}""", "msg.type")]
    [DataRow("""not json""", "not JSON")]
    [DataRow("""{"v":1,"seq":1,"msg":{"type":"start","bounds":{"x":0,"y":0,"width":0,"height":5}}}""", "positive size")]
    public void RejectsBadEnvelopes(string line, string expected)
    {
        var ex = Assert.ThrowsExactly<ProtocolException>(() => Protocol.Decode(line));
        Assert.Contains(expected, ex.Message);
    }

    [TestMethod]
    public void EncodesEventsInEnvelope()
    {
        var p = new PixelRect(0, 0, 1280, 800);
        var json = Protocol.Encode(7, new PlacedEvent(Placement.Evaluate(p, p, p),
            new AffinityReport("WDA_EXCLUDEFROMCAPTURE (0x11)", "0x11", true), "per-monitor v2"));
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        Assert.AreEqual(Protocol.Version, root.GetProperty("v").GetInt32());
        Assert.AreEqual(7, root.GetProperty("seq").GetInt64());
        var msg = root.GetProperty("msg");
        Assert.AreEqual("placed", msg.GetProperty("type").GetString());
        Assert.IsTrue(msg.GetProperty("placement").GetProperty("exact").GetBoolean());
        Assert.AreEqual(1280, msg.GetProperty("placement").GetProperty("monitor").GetProperty("width").GetInt32());
        Assert.IsTrue(msg.GetProperty("affinity").GetProperty("verified").GetBoolean());
    }

    [TestMethod]
    public void EncodesErrorShapeExpectedByTheApp()
    {
        using var doc = JsonDocument.Parse(Protocol.Encode(1, new ErrorEvent(new EngineErrorInfo("internal", "x"))));
        var err = doc.RootElement.GetProperty("msg").GetProperty("error");
        Assert.AreEqual("internal", err.GetProperty("code").GetString());
        Assert.AreEqual("x", err.GetProperty("message").GetString());
    }
}

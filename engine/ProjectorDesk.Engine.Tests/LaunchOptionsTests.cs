namespace ProjectorDesk.Engine.Tests;

[TestClass]
public sealed class LaunchOptionsTests
{
    [TestMethod]
    public void ParsesRectWindow()
    {
        var o = LaunchOptions.Parse(["--x", "-1920", "--y", "54", "--width", "1920", "--height", "1080", "--topmost"]);
        Assert.AreEqual(LaunchMode.Window, o.Mode);
        Assert.AreEqual(new PixelRect(-1920, 54, 1920, 1080), o.Target);
        Assert.IsTrue(o.Topmost);
    }

    [TestMethod]
    public void ParsesMonitorWindow()
    {
        var o = LaunchOptions.Parse(["--monitor", "secondary", "--topmost"]);
        Assert.AreEqual(LaunchMode.Window, o.Mode);
        Assert.AreEqual("secondary", o.Monitor);
        Assert.IsNull(o.Target);
        Assert.AreEqual(LaunchMode.Window, LaunchOptions.Parse(["--monitor", "2"]).Mode);
    }

    [TestMethod]
    public void ParsesOtherModes()
    {
        Assert.AreEqual(LaunchMode.SelfTest, LaunchOptions.Parse(["--self-test"]).Mode);
        Assert.AreEqual(LaunchMode.ListMonitors, LaunchOptions.Parse(["--list-monitors"]).Mode);
        var pipe = LaunchOptions.Parse(["--pipe", "projectordesk-1", "--token", "abc"]);
        Assert.AreEqual(LaunchMode.Pipe, pipe.Mode);
        Assert.AreEqual("projectordesk-1", pipe.Pipe);
        Assert.AreEqual("abc", pipe.Token);
    }

    [TestMethod]
    [DataRow(new string[0], "Nothing to do")]
    [DataRow(new[] { "--x", "0", "--y", "0", "--width", "100" }, "together")]
    [DataRow(new[] { "--x", "0", "--y", "0", "--width", "0", "--height", "10" }, "positive")]
    [DataRow(new[] { "--x", "abc" }, "integer")]
    [DataRow(new[] { "--width" }, "needs a value")]
    [DataRow(new[] { "--monitor", "--topmost" }, "needs a value")]
    [DataRow(new[] { "--monitor", "left" }, "'secondary', 'primary'")]
    [DataRow(new[] { "--monitor", "secondary", "--x", "0", "--y", "0", "--width", "1", "--height", "1" }, "not both")]
    [DataRow(new[] { "--pipe", "p" }, "together")]
    [DataRow(new[] { "--self-test", "--list-monitors" }, "Choose one")]
    [DataRow(new[] { "--fullscreen" }, "Unknown argument")]
    public void RejectsBadArguments(string[] args, string expected)
    {
        var ex = Assert.ThrowsExactly<ArgumentException>(() => LaunchOptions.Parse(args));
        Assert.Contains(expected, ex.Message);
    }
}

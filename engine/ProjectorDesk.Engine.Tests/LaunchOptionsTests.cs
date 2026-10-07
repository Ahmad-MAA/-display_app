namespace ProjectorDesk.Engine.Tests;

[TestClass]
public sealed class LaunchOptionsTests
{
    [TestMethod]
    public void ParsesTargetAndFlags()
    {
        var o = LaunchOptions.Parse(["--x", "-1920", "--y", "54", "--width", "1920", "--height", "1080", "--topmost"]);
        Assert.AreEqual(new PixelRect(-1920, 54, 1920, 1080), o.Target);
        Assert.IsTrue(o.Topmost);
        Assert.IsFalse(o.SelfTest);
    }

    [TestMethod]
    public void SelfTestNeedsNoTarget()
    {
        var o = LaunchOptions.Parse(["--self-test"]);
        Assert.IsTrue(o.SelfTest);
        Assert.IsNull(o.Target);
    }

    [TestMethod]
    [DataRow(new string[0], "required")]
    [DataRow(new[] { "--x", "0", "--y", "0", "--width", "100" }, "together")]
    [DataRow(new[] { "--x", "0", "--y", "0", "--width", "0", "--height", "10" }, "positive")]
    [DataRow(new[] { "--x", "abc" }, "integer")]
    [DataRow(new[] { "--width" }, "needs a value")]
    [DataRow(new[] { "--fullscreen" }, "Unknown argument")]
    public void RejectsBadArguments(string[] args, string expected)
    {
        var ex = Assert.ThrowsExactly<ArgumentException>(() => LaunchOptions.Parse(args));
        Assert.Contains(expected, ex.Message);
    }
}

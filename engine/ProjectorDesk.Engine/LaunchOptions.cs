using System.Globalization;

namespace ProjectorDesk.Engine;

/// <summary>A rectangle in physical (device) pixels, as Windows reports monitor bounds.</summary>
internal readonly record struct PixelRect(int X, int Y, int Width, int Height)
{
    public override string ToString() =>
        string.Create(CultureInfo.InvariantCulture, $"{Width}×{Height} @ ({X}, {Y})");
}

/// <summary>
/// Command line. <c>--x --y --width --height</c>: the target display's bounds in physical
/// pixels (Electron's <c>screen.dipToScreenRect</c>). <c>--topmost</c>: stay above other
/// windows (the P2.0 test window must cover Phase 1's Output). <c>--self-test</c>: report and
/// exit without opening a window (CI, and checking that the runtime can load us at all).
/// </summary>
internal sealed record LaunchOptions(PixelRect? Target, bool Topmost, bool SelfTest)
{
    public static LaunchOptions Parse(IReadOnlyList<string> args)
    {
        int? x = null, y = null, width = null, height = null;
        var topmost = false;
        var selfTest = false;
        for (var i = 0; i < args.Count; i++)
        {
            var a = args[i];
            switch (a)
            {
                case "--topmost":
                    topmost = true;
                    break;
                case "--self-test":
                    selfTest = true;
                    break;
                case "--x":
                    x = ReadInt(args, ref i, a);
                    break;
                case "--y":
                    y = ReadInt(args, ref i, a);
                    break;
                case "--width":
                    width = ReadInt(args, ref i, a);
                    break;
                case "--height":
                    height = ReadInt(args, ref i, a);
                    break;
                default:
                    throw new ArgumentException($"Unknown argument '{a}'.");
            }
        }

        PixelRect? target = null;
        int?[] parts = [x, y, width, height];
        if (parts.Any(p => p is not null))
        {
            if (parts.Any(p => p is null))
                throw new ArgumentException("--x, --y, --width and --height must be given together.");
            if (width <= 0 || height <= 0)
                throw new ArgumentException("--width and --height must be positive.");
            target = new PixelRect(x!.Value, y!.Value, width!.Value, height!.Value);
        }
        if (!selfTest && target is null)
            throw new ArgumentException("A target rectangle (--x --y --width --height) is required.");
        return new LaunchOptions(target, topmost, selfTest);
    }

    private static int ReadInt(IReadOnlyList<string> args, ref int i, string name)
    {
        if (i + 1 >= args.Count)
            throw new ArgumentException($"{name} needs a value.");
        i++;
        if (!int.TryParse(args[i], NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var v))
            throw new ArgumentException($"{name} must be an integer, got '{args[i]}'.");
        return v;
    }
}

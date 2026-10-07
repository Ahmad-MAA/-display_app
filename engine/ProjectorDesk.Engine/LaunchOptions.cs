using System.Globalization;

namespace ProjectorDesk.Engine;

/// <summary>A rectangle in physical (device) pixels, as Windows reports monitor bounds.</summary>
internal readonly record struct PixelRect(int X, int Y, int Width, int Height)
{
    public override string ToString() =>
        string.Create(CultureInfo.InvariantCulture, $"{Width}×{Height} @ ({X}, {Y})");
}

internal enum LaunchMode
{
    /// <summary>Report and exit without a window (CI; checks the runtime can load us).</summary>
    SelfTest,
    /// <summary>Print the monitors in physical pixels and exit.</summary>
    ListMonitors,
    /// <summary>Standalone test window (no Electron): stays until "quit" or end of stdin.</summary>
    Window,
    /// <summary>Driven by the Electron main process over the named pipe.</summary>
    Pipe,
}

/// <summary>
/// Command line.
/// <list type="bullet">
/// <item><c>--self-test</c></item>
/// <item><c>--list-monitors</c></item>
/// <item><c>--monitor secondary|primary|N</c> or <c>--x --y --width --height</c> (physical pixels), optional <c>--topmost</c>: standalone test window</item>
/// <item><c>--pipe NAME --token TOKEN</c>: engine mode</item>
/// </list>
/// </summary>
internal sealed record LaunchOptions(
    LaunchMode Mode,
    PixelRect? Target,
    string? Monitor,
    bool Topmost,
    string? Pipe,
    string? Token)
{
    public bool SelfTest => Mode == LaunchMode.SelfTest;

    public static LaunchOptions Parse(IReadOnlyList<string> args)
    {
        int? x = null, y = null, width = null, height = null;
        string? monitor = null, pipe = null, token = null;
        bool topmost = false, selfTest = false, listMonitors = false;
        for (var i = 0; i < args.Count; i++)
        {
            var a = args[i];
            switch (a)
            {
                case "--topmost": topmost = true; break;
                case "--self-test": selfTest = true; break;
                case "--list-monitors": listMonitors = true; break;
                case "--monitor": monitor = ReadString(args, ref i, a); break;
                case "--pipe": pipe = ReadString(args, ref i, a); break;
                case "--token": token = ReadString(args, ref i, a); break;
                case "--x": x = ReadInt(args, ref i, a); break;
                case "--y": y = ReadInt(args, ref i, a); break;
                case "--width": width = ReadInt(args, ref i, a); break;
                case "--height": height = ReadInt(args, ref i, a); break;
                default: throw new ArgumentException($"Unknown argument '{a}'.");
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
        if (monitor is not null && target is not null)
            throw new ArgumentException("Use either --monitor or --x/--y/--width/--height, not both.");
        if (monitor is not null && monitor is not ("secondary" or "primary") && !int.TryParse(monitor, NumberStyles.None, CultureInfo.InvariantCulture, out _))
            throw new ArgumentException("--monitor must be 'secondary', 'primary' or a monitor number from --list-monitors.");
        if ((pipe is null) != (token is null))
            throw new ArgumentException("--pipe and --token must be given together.");

        var modes = new List<LaunchMode>();
        if (selfTest) modes.Add(LaunchMode.SelfTest);
        if (listMonitors) modes.Add(LaunchMode.ListMonitors);
        if (pipe is not null) modes.Add(LaunchMode.Pipe);
        if (target is not null || monitor is not null) modes.Add(LaunchMode.Window);
        if (modes.Count == 0)
            throw new ArgumentException("Nothing to do: use --monitor secondary (test window), --list-monitors, --self-test or --pipe.");
        if (modes.Count > 1)
            throw new ArgumentException($"Choose one of: {string.Join(", ", modes.Select(m => m.ToString()))}.");
        return new LaunchOptions(modes[0], target, monitor, topmost, pipe, token);
    }

    private static string ReadString(IReadOnlyList<string> args, ref int i, string name)
    {
        if (i + 1 >= args.Count || args[i + 1].StartsWith("--", StringComparison.Ordinal))
            throw new ArgumentException($"{name} needs a value.");
        i++;
        return args[i];
    }

    private static int ReadInt(IReadOnlyList<string> args, ref int i, string name)
    {
        var s = ReadString(args, ref i, name);
        if (!int.TryParse(s, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var v))
            throw new ArgumentException($"{name} must be an integer, got '{s}'.");
        return v;
    }
}

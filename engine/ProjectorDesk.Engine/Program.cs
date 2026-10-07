using System.Reflection;
using System.Runtime.InteropServices;
using Windows.Win32;
using Windows.Win32.UI.HiDpi;

namespace ProjectorDesk.Engine;

internal static class Program
{
    private const int ExitOk = 0;
    private const int ExitBadArguments = 2;
    private const int ExitFailed = 3;

    [STAThread]
    private static int Main(string[] args)
    {
        LaunchOptions options;
        try
        {
            options = LaunchOptions.Parse(args);
        }
        catch (ArgumentException ex)
        {
            EngineOutput.Write(new ErrorMessage("arguments", ex.Message, null));
            return ExitBadArguments;
        }

        var version = typeof(Program).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "0.0.0";
        EngineOutput.Write(new HelloMessage("ProjectorDesk.Engine", version, EngineOutput.ReportVersion,
            RuntimeInformation.FrameworkDescription, RuntimeInformation.OSDescription, options.SelfTest));

        if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 19041))
        {
            if (options.SelfTest)
                return ExitOk;
            EngineOutput.Write(new ErrorMessage("platform", "The native engine needs Windows 10 version 2004 (build 19041) or newer.", null));
            return ExitFailed;
        }

        try
        {
            return RunOnWindows(options);
        }
        catch (Exception ex)
        {
            EngineOutput.Write(new ErrorMessage("window", ex.Message, $"0x{ex.HResult:X8}"));
            return ExitFailed;
        }
    }

    [System.Runtime.Versioning.SupportedOSPlatform("windows10.0.19041.0")]
    private static int RunOnWindows(LaunchOptions options)
    {
        // Before any window exists: physical-pixel coordinates everywhere, no DPI virtualization.
        PInvoke.SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT.DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        var awareness = PInvoke.GetAwarenessFromDpiAwarenessContext(PInvoke.GetThreadDpiAwarenessContext());
        var dpiAwareness = awareness == DPI_AWARENESS.DPI_AWARENESS_PER_MONITOR_AWARE
            ? "per-monitor v2"
            : $"{awareness} (expected per-monitor v2)";

        Probes.RunAll();
        if (options.SelfTest)
            return ExitOk;

        var target = options.Target!.Value;
        var window = EngineWindow.Create(options.Topmost);
        var affinity = window.ExcludeFromScreenCapture();
        var placement = window.ShowOn(target, options.Topmost);
        EngineOutput.Write(new ReadyMessage(dpiAwareness, affinity, placement));

        // The parent closing our stdin (it quit or crashed) or sending "quit" closes the window.
        var stdin = new Thread(() =>
        {
            string? line;
            while ((line = Console.In.ReadLine()) is not null && line.Trim() != "quit")
            {
            }
            window.RequestClose();
        })
        { IsBackground = true, Name = "stdin" };
        stdin.Start();

        EngineWindow.RunMessageLoop();
        EngineOutput.Write(new ByeMessage("closed"));
        return ExitOk;
    }
}

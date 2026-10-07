using System.Collections.Concurrent;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using Windows.Win32;
using Windows.Win32.UI.HiDpi;

namespace ProjectorDesk.Engine;

internal static class Program
{
    private const int ExitOk = 0;
    private const int ExitBadArguments = 2;
    private const int ExitFailed = 3;
    private const int ExitNoPipe = 4;

    private static readonly TimeSpan PipeConnectTimeout = TimeSpan.FromSeconds(10);
    private const uint HeartbeatMs = 1000;

    private static string EngineVersion =>
        typeof(Program).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "0.0.0";

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

        return options.Mode == LaunchMode.Pipe ? RunPipe(options) : RunStandalone(options);
    }

    // ── Standalone: self-test, monitor list, test window (stdout JSON lines) ──────────────

    private static int RunStandalone(LaunchOptions options)
    {
        EngineOutput.Write(new HelloMessage("ProjectorDesk.Engine", EngineVersion, EngineOutput.ReportVersion,
            RuntimeInformation.FrameworkDescription, RuntimeInformation.OSDescription, options.SelfTest));

        if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 19041))
        {
            if (options.SelfTest)
                return ExitOk;
            EngineOutput.Write(new ErrorMessage("platform", PlatformMessage, null));
            return ExitFailed;
        }

        try
        {
            return RunStandaloneOnWindows(options);
        }
        catch (ArgumentException ex)
        {
            EngineOutput.Write(new ErrorMessage("monitor", ex.Message, null));
            return ExitBadArguments;
        }
        catch (Exception ex)
        {
            EngineOutput.Write(new ErrorMessage("window", ex.Message, $"0x{ex.HResult:X8}"));
            return ExitFailed;
        }
    }

    private const string PlatformMessage = "The native engine needs Windows 10 version 2004 (build 19041) or newer.";

    [SupportedOSPlatform("windows10.0.19041.0")]
    private static string BecomePerMonitorAware()
    {
        // Before any window exists: physical-pixel coordinates everywhere, no DPI virtualization.
        PInvoke.SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT.DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        var awareness = PInvoke.GetAwarenessFromDpiAwarenessContext(PInvoke.GetThreadDpiAwarenessContext());
        return awareness == DPI_AWARENESS.DPI_AWARENESS_PER_MONITOR_AWARE
            ? "per-monitor v2"
            : $"{awareness} (expected per-monitor v2)";
    }

    [SupportedOSPlatform("windows10.0.19041.0")]
    private static int RunStandaloneOnWindows(LaunchOptions options)
    {
        var dpiAwareness = BecomePerMonitorAware();

        if (options.Mode == LaunchMode.ListMonitors)
        {
            foreach (var m in Monitors.Enumerate())
                EngineOutput.Write(m);
            return ExitOk;
        }

        Probes.RunAll(p => EngineOutput.Write(new ProbeMessage(p.Name, p.Ok, p.Detail)));
        if (options.SelfTest)
            return ExitOk;

        var target = options.Target ?? Monitors.Select(options.Monitor!).Bounds;
        var window = EngineWindow.Create(options.Topmost);
        var affinity = window.ExcludeFromScreenCapture();
        if (!affinity.Verified)
        {
            // Never show an output window that screen capture can see: projecting the projector
            // screen would mirror endlessly.
            EngineOutput.Write(new ErrorMessage("capture-exclusion", $"WDA_EXCLUDEFROMCAPTURE could not be set (affinity {affinity.Actual}); not showing the window.", null));
            return ExitFailed;
        }
        var placement = window.ShowOn(target, options.Topmost);
        EngineOutput.Write(new ReadyMessage(dpiAwareness, affinity, placement));

        // "quit" or the end of stdin (the console closed, Ctrl+Z) closes the window.
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

    // ── Engine mode: driven by the app over the named pipe ───────────────────────────────

    private static int RunPipe(LaunchOptions options)
    {
        PipeChannel channel;
        try
        {
            channel = PipeChannel.Connect(options.Pipe!, PipeConnectTimeout);
        }
        catch (Exception ex)
        {
            // Nobody to tell but stderr: the app shows it (and falls back) when we exit.
            Console.Error.WriteLine($"Could not connect to pipe '{options.Pipe}': {ex.Message}");
            return ExitNoPipe;
        }

        using (channel)
        {
            channel.Send(new HelloEvent(Protocol.Version, "ProjectorDesk.Engine", EngineVersion,
                RuntimeInformation.FrameworkDescription, RuntimeInformation.OSDescription, options.Token!));

            if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 19041))
            {
                channel.Send(new ErrorEvent(new EngineErrorInfo("platform", PlatformMessage)));
                return ExitFailed;
            }
            try
            {
                return RunPipeOnWindows(channel);
            }
            catch (Exception ex)
            {
                channel.Send(new ErrorEvent(new EngineErrorInfo("internal", $"{ex.GetType().Name}: {ex.Message}")));
                return ExitFailed;
            }
        }
    }

    [SupportedOSPlatform("windows10.0.19041.0")]
    private static int RunPipeOnWindows(PipeChannel channel)
    {
        var dpiAwareness = BecomePerMonitorAware();
        Probes.RunAll(p => channel.Send(new ProbeEvent(p.Name, p.Ok, p.Detail)));

        var window = EngineWindow.Create(topmost: false);
        var affinity = window.ExcludeFromScreenCapture();
        if (!affinity.Verified)
            channel.Send(new ErrorEvent(new EngineErrorInfo("content-protection-unsupported",
                $"WDA_EXCLUDEFROMCAPTURE could not be set (affinity {affinity.Actual}); the engine will not show its window.")));

        var queue = new ConcurrentQueue<EngineCommand>();
        EngineWindow.OnAppMessage = () =>
        {
            while (queue.TryDequeue(out var cmd))
                Handle(cmd);
        };
        EngineWindow.OnHeartbeat = () => channel.Send(new HeartbeatEvent());

        void Handle(EngineCommand cmd)
        {
            switch (cmd)
            {
                case StartCommand { Bounds: null }:
                    channel.Send(new ErrorEvent(new EngineErrorInfo("display-not-found", "start needs bounds (physical pixels of the target display).")));
                    break;
                case StartCommand { Bounds: { } bounds } start:
                    if (!affinity.Verified)
                    {
                        channel.Send(new ErrorEvent(new EngineErrorInfo("content-protection-unsupported", "Capture exclusion is not available; refusing to show the output.")));
                        break;
                    }
                    channel.Send(new PlacedEvent(window.ShowOn(bounds, start.Topmost), affinity, dpiAwareness));
                    break;
                case StopCommand:
                    window.Hide();
                    break;
                case ShutdownCommand:
                    window.RequestClose();
                    break;
                case UnsupportedCommand u:
                    channel.Send(new ErrorEvent(new EngineErrorInfo("internal", $"Command '{u.Type}' is not implemented in this engine build yet.")));
                    break;
            }
        }

        channel.StartReading(
            cmd =>
            {
                queue.Enqueue(cmd);
                window.PostWork();
            },
            bad => channel.Send(new ErrorEvent(new EngineErrorInfo("protocol-mismatch", bad))),
            // The app closed the pipe (quit or crashed): don't leave a black window behind.
            window.RequestClose);
        window.StartHeartbeat(HeartbeatMs);
        channel.Send(new HeartbeatEvent());

        EngineWindow.RunMessageLoop();
        return ExitOk;
    }
}

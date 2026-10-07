using System.Runtime.CompilerServices;
using System.Runtime.Versioning;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;

namespace ProjectorDesk.Engine;

internal sealed record ProbeResult(string Name, bool Ok, string Detail);

/// <summary>
/// Loads each Phase 2 dependency once, in its own method, so a load failure (for example
/// Smart App Control refusing an assembly) is reported as that probe's failure instead of
/// taking the engine down. Assemblies load when the JIT compiles the method that uses them,
/// hence NoInlining.
/// </summary>
[SupportedOSPlatform("windows10.0.19041.0")]
internal static class Probes
{
    public static void RunAll(Action<ProbeResult> report)
    {
        report(Run("windows-graphics-capture", ProbeGraphicsCapture));
        report(Run("direct3d11", ProbeDirect3D11));
    }

    private static ProbeResult Run(string name, Func<string> probe)
    {
        try
        {
            return new ProbeResult(name, true, probe());
        }
        catch (Exception ex)
        {
            return new ProbeResult(name, false, $"{ex.GetType().Name} (0x{ex.HResult:X8}): {ex.Message}");
        }
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static string ProbeGraphicsCapture() =>
        Windows.Graphics.Capture.GraphicsCaptureSession.IsSupported()
            ? "GraphicsCaptureSession.IsSupported() = true"
            : throw new PlatformNotSupportedException("GraphicsCaptureSession.IsSupported() = false");

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static string ProbeDirect3D11()
    {
        FeatureLevel[] levels = [FeatureLevel.Level_11_1, FeatureLevel.Level_11_0];
        var driver = DriverType.Hardware;
        var hr = D3D11.D3D11CreateDevice(null, driver, DeviceCreationFlags.BgraSupport, levels, out ID3D11Device? device);
        if (hr.Failure)
        {
            // No GPU (CI runners, some VMs): WARP still proves the assemblies load.
            driver = DriverType.Warp;
            D3D11.D3D11CreateDevice(null, driver, DeviceCreationFlags.BgraSupport, levels, out device).CheckError();
        }
        using (device)
        {
            using var dxgiDevice = device!.QueryInterface<IDXGIDevice>();
            using var adapter = dxgiDevice.GetAdapter();
            return $"{driver} device, feature level {device.FeatureLevel}, adapter \"{adapter.Description.Description}\"";
        }
    }
}

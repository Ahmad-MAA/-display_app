using System.Text.Json;
using System.Text.Json.Serialization;

namespace ProjectorDesk.Engine;

/// <summary>
/// P2.0 reports to the Electron main process as JSON lines on stdout. P2.1 replaces this with
/// the versioned OutputEngine envelopes over the named pipe.
/// </summary>
internal static class EngineOutput
{
    public const int ReportVersion = 1;

    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private static readonly Lock Gate = new();

    public static string Serialize(object message) => JsonSerializer.Serialize(message, message.GetType(), Options);

    public static void Write(object message)
    {
        var line = Serialize(message);
        lock (Gate)
        {
            Console.Out.WriteLine(line);
            Console.Out.Flush();
        }
    }
}

internal sealed record HelloMessage(string Engine, string Version, int Report, string Runtime, string Os, bool SelfTest)
{
    public string Type => "hello";
}

internal sealed record ProbeMessage(string Name, bool Ok, string Detail)
{
    public string Type => "probe";
}

internal sealed record AffinityReport(string Requested, string Actual, bool Verified);

internal sealed record ReadyMessage(string DpiAwareness, AffinityReport Affinity, PlacementResult Placement)
{
    public string Type => "ready";
}

internal sealed record ErrorMessage(string Stage, string Message, string? Hresult)
{
    public string Type => "error";
}

internal sealed record ByeMessage(string Reason)
{
    public string Type => "bye";
}

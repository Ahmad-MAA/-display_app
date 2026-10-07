using System.Text.Json;
using System.Text.Json.Serialization;

namespace ProjectorDesk.Engine;

/// <summary>
/// The OutputEngine wire format shared with src/shared/outputEngine.ts: one JSON envelope
/// <c>{ v, seq, msg }</c> per line over the named pipe. v is the protocol version; both sides
/// refuse envelopes of another version.
/// </summary>
internal static class Protocol
{
    public const int Version = 1;

    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static string Encode(long seq, object msg) =>
        JsonSerializer.Serialize(new Envelope(Version, seq, msg), Options);

    /// <summary>Parses one line into a command. Throws <see cref="ProtocolException"/> on anything malformed.</summary>
    public static EngineCommand Decode(string line)
    {
        JsonElement root;
        try
        {
            root = JsonDocument.Parse(line).RootElement;
        }
        catch (JsonException ex)
        {
            throw new ProtocolException($"not JSON: {ex.Message}");
        }
        if (root.ValueKind != JsonValueKind.Object)
            throw new ProtocolException("envelope is not an object");
        if (!root.TryGetProperty("v", out var v) || v.ValueKind != JsonValueKind.Number || v.GetInt32() != Version)
            throw new ProtocolException($"protocol version {(root.TryGetProperty("v", out var vv) ? vv.ToString() : "missing")} not supported (engine speaks {Version})");
        if (!root.TryGetProperty("msg", out var msg) || msg.ValueKind != JsonValueKind.Object ||
            !msg.TryGetProperty("type", out var type) || type.ValueKind != JsonValueKind.String)
            throw new ProtocolException("missing msg.type");

        return type.GetString() switch
        {
            "start" => new StartCommand(
                msg.TryGetProperty("targetDisplayId", out var id) && id.ValueKind == JsonValueKind.Number ? id.GetInt64() : null,
                msg.TryGetProperty("bounds", out var b) && b.ValueKind == JsonValueKind.Object ? ReadRect(b) : null,
                msg.TryGetProperty("topmost", out var t) && t.ValueKind == JsonValueKind.True),
            "stop" => new StopCommand(),
            "shutdown" => new ShutdownCommand(),
            var other => new UnsupportedCommand(other ?? "?"),
        };
    }

    private static PixelRect ReadRect(JsonElement e)
    {
        int Get(string name) =>
            e.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.Number
                ? p.GetInt32()
                : throw new ProtocolException($"bounds.{name} missing");
        var r = new PixelRect(Get("x"), Get("y"), Get("width"), Get("height"));
        if (r.Width <= 0 || r.Height <= 0)
            throw new ProtocolException("bounds must have a positive size");
        return r;
    }

    private sealed record Envelope(int V, long Seq, object Msg);
}

internal sealed class ProtocolException(string message) : Exception(message);

internal abstract record EngineCommand;
/// <summary>Show the output on <paramref name="Bounds"/> (physical pixels of the target display).</summary>
internal sealed record StartCommand(long? TargetDisplayId, PixelRect? Bounds, bool Topmost) : EngineCommand;
/// <summary>Hide the output (projector unplugged, emergency hide).</summary>
internal sealed record StopCommand : EngineCommand;
/// <summary>Close the window and exit.</summary>
internal sealed record ShutdownCommand : EngineCommand;
/// <summary>A command this build doesn't implement yet (setSource etc. arrive in P2.2).</summary>
internal sealed record UnsupportedCommand(string Type) : EngineCommand;

internal sealed record HelloEvent(int Protocol, string Engine, string Version, string Runtime, string Os, string Token)
{
    public string Type => "hello";
}

internal sealed record ProbeEvent(string Name, bool Ok, string Detail)
{
    public string Type => "probe";
}

internal sealed record PlacedEvent(PlacementResult Placement, AffinityReport Affinity, string DpiAwareness)
{
    public string Type => "placed";
}

internal sealed record HeartbeatEvent
{
    public string Type => "heartbeat";
}

internal sealed record EngineErrorInfo(string Code, string Message);

internal sealed record ErrorEvent(EngineErrorInfo Error)
{
    public string Type => "error";
}

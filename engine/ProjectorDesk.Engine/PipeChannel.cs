using System.IO.Pipes;
using System.Text;

namespace ProjectorDesk.Engine;

/// <summary>
/// Client end of the named pipe the Electron main process listens on. Commands are read on a
/// background thread; events can be sent from any thread.
/// </summary>
internal sealed class PipeChannel : IDisposable
{
    private readonly NamedPipeClientStream _stream;
    private readonly StreamReader _reader;
    private readonly StreamWriter _writer;
    private readonly Lock _gate = new();
    private long _seq;
    private bool _broken;

    private PipeChannel(NamedPipeClientStream stream)
    {
        _stream = stream;
        var utf8 = new UTF8Encoding(false);
        _reader = new StreamReader(stream, utf8);
        _writer = new StreamWriter(stream, utf8) { AutoFlush = true, NewLine = "\n" };
    }

    public static PipeChannel Connect(string name, TimeSpan timeout)
    {
        var stream = new NamedPipeClientStream(".", name, PipeDirection.InOut, PipeOptions.None);
        stream.Connect((int)timeout.TotalMilliseconds);
        return new PipeChannel(stream);
    }

    /// <summary>Sends one event; false once the pipe is gone (the app quit or crashed).</summary>
    public bool Send(object msg)
    {
        lock (_gate)
        {
            if (_broken)
                return false;
            try
            {
                _writer.WriteLine(Protocol.Encode(++_seq, msg));
                return true;
            }
            catch (IOException)
            {
                _broken = true;
                return false;
            }
            catch (ObjectDisposedException)
            {
                _broken = true;
                return false;
            }
        }
    }

    /// <summary>Reads commands until the pipe closes, then calls <paramref name="onClosed"/>.</summary>
    public void StartReading(Action<EngineCommand> onCommand, Action<string> onBadLine, Action onClosed)
    {
        var thread = new Thread(() =>
        {
            try
            {
                string? line;
                while ((line = _reader.ReadLine()) is not null)
                {
                    if (line.Length == 0)
                        continue;
                    try
                    {
                        onCommand(Protocol.Decode(line));
                    }
                    catch (ProtocolException ex)
                    {
                        onBadLine(ex.Message);
                    }
                }
            }
            catch (IOException)
            {
            }
            catch (ObjectDisposedException)
            {
            }
            onClosed();
        })
        { IsBackground = true, Name = "pipe-reader" };
        thread.Start();
    }

    public void Dispose()
    {
        _stream.Dispose();
    }
}

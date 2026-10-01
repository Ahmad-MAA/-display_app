import { useEffect, useState } from 'react';
import type { AppState, LogEntry } from '@shared/diagnostics';

const api = window.projectorDesk;

export function useAppState(): AppState | null {
  const [state, setState] = useState<AppState | null>(null);
  useEffect(() => {
    let alive = true;
    void api.getState().then((s) => {
      if (alive) setState(s);
    });
    const off = api.onState(setState);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return state;
}

export function useLogs(): LogEntry[] {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  useEffect(() => {
    let alive = true;
    void api.getLogs().then((l) => {
      if (alive) setLogs(l);
    });
    const off = api.onLog((e) => {
      setLogs((prev) => [...prev.slice(-299), e]);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);
  return logs;
}

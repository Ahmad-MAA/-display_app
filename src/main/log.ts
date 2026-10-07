import { app } from 'electron';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { LogEntry, LogLevel } from '@shared/diagnostics';

const MAX_ENTRIES = 300;
const entries: LogEntry[] = [];
const listeners = new Set<(e: LogEntry) => void>();
let logFile: string | null = null;

function file(): string | null {
  if (logFile) return logFile;
  try {
    const dir = join(app.getPath('userData'), 'logs');
    mkdirSync(dir, { recursive: true });
    logFile = join(dir, 'projectordesk.log');
  } catch {
    logFile = null;
  }
  return logFile;
}

export function log(level: LogLevel, message: string): void {
  const entry: LogEntry = { at: new Date().toISOString(), level, message };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();
  const line = `${entry.at} [${level.toUpperCase()}] ${message}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
  const f = file();
  if (f) {
    try {
      appendFileSync(f, line + '\n');
    } catch {
      /* logging must never crash the app */
    }
  }
  for (const l of listeners) l(entry);
}

export function getLogs(): LogEntry[] {
  return [...entries];
}

export function onLog(cb: (e: LogEntry) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getLogFilePath(): string | null {
  return file();
}

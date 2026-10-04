import { app } from 'electron';
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessionSummary } from '@shared/stats';
import { log } from './log';

const KEEP = 10;
const recent: SessionSummary[] = [];

/**
 * Every projection session is summarized; sessions over one frame of median latency or with
 * >2% dropped frames are the evidence for the Phase 2 native engine. One JSON object per line
 * in userData/logs/sessions.jsonl.
 */
export function recordSession(s: SessionSummary): void {
  recent.unshift(s);
  if (recent.length > KEEP) recent.pop();
  const summary = `"${s.source}" ${s.durationS}s @ ${s.refreshRate} Hz: ${s.frames} frames, ${s.dropPercent.toFixed(1)}% dropped, median latency ${s.medianLatencyMs?.toFixed(1) ?? 'n/a'} ms`;
  if (s.needsNativeEngine)
    log('warn', `Session needs the native engine: ${summary} (${s.reasons.join('; ')})`);
  else log('info', `Session OK: ${summary}`);
  const dir = join(app.getPath('userData'), 'logs');
  void mkdir(dir, { recursive: true })
    .then(() => appendFile(join(dir, 'sessions.jsonl'), JSON.stringify(s) + '\n'))
    .catch((err: unknown) => {
      log('warn', `Could not write sessions.jsonl: ${String(err)}`);
    });
}

export function recentSessions(): SessionSummary[] {
  return [...recent];
}

import { app } from 'electron';
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessionSummary } from '@shared/stats';
import { log } from './log';

const KEEP = 10;
/** Shorter sessions (quick source flicking) say nothing about sustained performance. */
const MIN_SECONDS = 10;
const MIN_FRAMES = 120;
const recent: SessionSummary[] = [];
let warned = false;

/**
 * Every projection session is summarized; sessions over one frame of median latency or with
 * >2% dropped frames are the evidence for the Phase 2 native engine. One JSON object per line
 * in userData/logs/sessions.jsonl.
 */
export function recordSession(s: SessionSummary): void {
  if (s.durationS < MIN_SECONDS || s.frames < MIN_FRAMES) return;
  recent.unshift(s);
  if (recent.length > KEEP) recent.pop();
  const summary = `"${s.source}" ${s.durationS}s @ ${s.refreshRate} Hz: ${s.frames} frames, ${s.dropPercent.toFixed(1)}% dropped, median latency ${s.medianLatencyMs?.toFixed(1) ?? 'n/a'} ms`;
  if (s.needsNativeEngine) {
    log('info', `Session over the Phase 1 budget: ${summary} (${s.reasons.join('; ')})`);
    if (!warned) {
      warned = true;
      log(
        'warn',
        `Phase 1 capture is over the one-frame latency / 2% drop budget (${s.reasons.join('; ')}). Recorded in sessions.jsonl as evidence for the native engine; further sessions are logged as info.`,
      );
    }
  } else {
    log('info', `Session OK: ${summary}`);
  }
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

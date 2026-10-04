/**
 * Frame statistics for the Output (step 6) and the "do we need the native engine?" verdict.
 * Pure so the same math can be unit-tested and reused by a Phase 2 engine.
 */
import type { EngineStats } from './outputEngine';

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? null) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

/** Per-frame data from requestVideoFrameCallback (fields optional across Chromium versions). */
export interface FrameSample {
  /** rVFC `now` (ms, performance.now timebase). */
  now: number;
  presentedFrames: number;
  /** ms: expectedDisplayTime − captureTime, when the browser exposes captureTime. */
  latencyMs: number | null;
  /** ms: processingDuration, or presentationTime − captureTime as a fallback. */
  processingMs: number | null;
}

/**
 * Rolling accumulator. Dropped frames = gaps in `presentedFrames` (frames the compositor
 * never showed). Static sources deliver few frames, which is not counted as dropping.
 */
export class FrameStats {
  private times: number[] = [];
  private latencies: number[] = [];
  private processing: number[] = [];
  private lastPresented: number | null = null;
  total = 0;
  dropped = 0;

  constructor(private readonly window = 120) {}

  add(f: FrameSample): void {
    if (this.lastPresented !== null && f.presentedFrames > this.lastPresented + 1) {
      this.dropped += f.presentedFrames - this.lastPresented - 1;
    }
    this.lastPresented = f.presentedFrames;
    this.total++;
    this.times.push(f.now);
    if (f.latencyMs !== null && f.latencyMs >= 0 && f.latencyMs < 5000) {
      this.latencies.push(f.latencyMs);
      if (this.latencies.length > this.window) this.latencies.shift();
    }
    if (f.processingMs !== null && f.processingMs >= 0 && f.processingMs < 5000) {
      this.processing.push(f.processingMs);
      if (this.processing.length > this.window) this.processing.shift();
    }
  }

  /** Frames presented in the last second before `now`. */
  fps(now: number): number {
    this.times = this.times.filter((t) => now - t <= 1000);
    return this.times.length;
  }

  snapshot(now: number, size: { width: number; height: number }, refreshRate: number): EngineStats {
    return {
      deliveredFps: this.fps(now),
      droppedFrames: this.dropped,
      totalFrames: this.total + this.dropped,
      medianLatencyMs: median(this.latencies),
      medianProcessingMs: median(this.processing),
      sourceWidth: size.width,
      sourceHeight: size.height,
      refreshRate,
    };
  }

  reset(): void {
    this.times = [];
    this.latencies = [];
    this.processing = [];
    this.lastPresented = null;
    this.total = 0;
    this.dropped = 0;
  }
}

/** One projection, summarized when it ends. Appended to logs/sessions.jsonl. */
export interface SessionSummary {
  startedAt: string;
  endedAt: string;
  durationS: number;
  source: string;
  sourceKind: 'window' | 'screen';
  refreshRate: number;
  frames: number;
  droppedFrames: number;
  dropPercent: number;
  medianLatencyMs: number | null;
  /** True when this session is evidence for the Phase 2 native engine. */
  needsNativeEngine: boolean;
  reasons: string[];
}

/**
 * Phase 2 trigger (spec): median latency above one frame at the display's refresh rate,
 * or more than 2% dropped frames.
 */
export function evaluateSession(
  frames: number,
  dropped: number,
  medianLatencyMs: number | null,
  refreshRate: number,
): { dropPercent: number; needsNativeEngine: boolean; reasons: string[] } {
  const all = frames + dropped;
  const dropPercent = all > 0 ? (dropped / all) * 100 : 0;
  const frameMs = refreshRate > 0 ? 1000 / refreshRate : 1000 / 60;
  const reasons: string[] = [];
  if (medianLatencyMs !== null && medianLatencyMs > frameMs) {
    reasons.push(
      `median latency ${medianLatencyMs.toFixed(1)} ms > one frame (${frameMs.toFixed(1)} ms @ ${refreshRate} Hz)`,
    );
  }
  if (dropPercent > 2) reasons.push(`${dropPercent.toFixed(1)}% frames dropped (> 2%)`);
  return { dropPercent, needsNativeEngine: reasons.length > 0, reasons };
}

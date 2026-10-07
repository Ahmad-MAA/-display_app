import { describe, expect, it } from 'vitest';
import { evaluateSession, FrameStats, median } from './stats';

describe('median', () => {
  it('handles odd, even and empty', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('FrameStats', () => {
  const frame = (now: number, presentedFrames: number, latencyMs: number | null = 10) => ({
    now,
    presentedFrames,
    latencyMs,
    processingMs: 2,
  });

  it('counts gaps in presentedFrames as dropped frames', () => {
    const s = new FrameStats();
    s.add(frame(0, 1));
    s.add(frame(16, 2));
    s.add(frame(50, 5)); // frames 3 and 4 never presented
    expect(s.dropped).toBe(2);
    expect(s.total).toBe(3);
  });

  it('reports fps over the last second and medians', () => {
    const s = new FrameStats();
    for (let i = 0; i < 90; i++) s.add(frame(i * (1000 / 60), i + 1, i % 2 ? 8 : 12));
    const snap = s.snapshot(1500, { width: 1920, height: 1080 }, 60);
    expect(snap.deliveredFps).toBe(60);
    expect(snap.medianLatencyMs).toBe(10);
    expect(snap.medianProcessingMs).toBe(2);
    expect(snap.droppedFrames).toBe(0);
  });

  it('ignores missing or absurd latency values', () => {
    const s = new FrameStats();
    s.add(frame(0, 1, null));
    s.add(frame(16, 2, -5));
    s.add(frame(32, 3, 99999));
    expect(s.snapshot(40, { width: 1, height: 1 }, 60).medianLatencyMs).toBeNull();
  });
});

describe('evaluateSession', () => {
  it('passes a healthy 60 Hz session', () => {
    expect(evaluateSession(3600, 10, 9, 60)).toMatchObject({ needsNativeEngine: false });
  });
  it('flags latency above one frame', () => {
    const r = evaluateSession(3600, 0, 25, 60);
    expect(r.needsNativeEngine).toBe(true);
    expect(r.reasons[0]).toMatch(/one frame \(16\.7 ms @ 60 Hz\)/);
  });
  it('flags more than 2% dropped frames', () => {
    const r = evaluateSession(900, 100, 5, 60);
    expect(r.dropPercent).toBeCloseTo(10);
    expect(r.needsNativeEngine).toBe(true);
  });
});

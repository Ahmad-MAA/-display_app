import { FrameStats } from '@shared/stats';
import type { OutputControls } from '@shared/ipc';

/**
 * Presenter controls on the Output (step 6):
 * - blank: black overlay above the picture; capture keeps running.
 * - freeze: pause the <video> (the crop canvas stops redrawing with it).
 * - stats: requestVideoFrameCallback metrics, reported to main every second and
 *   optionally drawn as an overlay (hotkey S).
 */
const api = window.projectorOutput;
const video = document.getElementById('video') as HTMLVideoElement;
const blankEl = document.getElementById('blank') as HTMLDivElement;
const statsEl = document.getElementById('stats') as HTMLPreElement;

let controls: OutputControls = {
  blank: false,
  freeze: false,
  statsOverlay: false,
  refreshRate: 60,
  statsEpoch: 0,
};
const stats = new FrameStats();
let token = 0;
let rvfc: number | null = null;

function onFrame(now: number, meta: VideoFrameCallbackMetadata): void {
  const m = meta as VideoFrameCallbackMetadata & { processingDuration?: number };
  const capture = m.captureTime;
  stats.add({
    now,
    presentedFrames: m.presentedFrames,
    latencyMs: capture !== undefined ? m.expectedDisplayTime - capture : null,
    processingMs:
      m.processingDuration !== undefined
        ? m.processingDuration * 1000
        : capture !== undefined
          ? m.presentationTime - capture
          : null,
  });
  rvfc = video.requestVideoFrameCallback(onFrame);
}

function startStats(t: number): void {
  stopStats();
  token = t;
  stats.reset();
  rvfc = video.requestVideoFrameCallback(onFrame);
}

function stopStats(): void {
  if (rvfc !== null) video.cancelVideoFrameCallback(rvfc);
  rvfc = null;
  token = 0;
}

const fmt = (v: number | null, unit: string) => (v === null ? 'n/a' : `${v.toFixed(1)} ${unit}`);

setInterval(() => {
  if (token === 0) {
    statsEl.hidden = true;
    return;
  }
  const snap = stats.snapshot(
    performance.now(),
    { width: video.videoWidth, height: video.videoHeight },
    controls.refreshRate,
  );
  api.reportStats({ token, ...snap });
  statsEl.hidden = !controls.statsOverlay;
  if (controls.statsOverlay) {
    const dropPct = snap.totalFrames ? (snap.droppedFrames / snap.totalFrames) * 100 : 0;
    statsEl.textContent = [
      `${snap.sourceWidth}×${snap.sourceHeight} → ${window.innerWidth * window.devicePixelRatio}×${window.innerHeight * window.devicePixelRatio} @ ${controls.refreshRate} Hz`,
      `delivered ${snap.deliveredFps} fps${controls.freeze ? ' (frozen)' : ''}`,
      `dropped ${snap.droppedFrames}/${snap.totalFrames} (${dropPct.toFixed(1)}%)`,
      `latency ${fmt(snap.medianLatencyMs, 'ms')} · processing ${fmt(snap.medianProcessingMs, 'ms')}`,
      `budget ${(1000 / (controls.refreshRate || 60)).toFixed(1)} ms/frame`,
    ].join('\n');
  }
}, 1000);

function apply(c: OutputControls): void {
  const wasFrozen = controls.freeze;
  if (c.statsEpoch !== controls.statsEpoch) stats.reset();
  controls = c;
  blankEl.classList.toggle('on', c.blank);
  if (c.freeze && !wasFrozen) video.pause();
  if (!c.freeze && wasFrozen) void video.play().catch(() => undefined);
  statsEl.hidden = !c.statsOverlay || token === 0;
}

api.onControls(apply);
window.addEventListener('pd:capture-live', (e) => {
  const t = (e as CustomEvent<{ token: number }>).detail.token;
  startStats(t);
});
window.addEventListener('pd:capture-stop', stopStats);

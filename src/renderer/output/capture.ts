import type { SourceDescriptor } from '@shared/outputEngine';
import type { SourceStatus } from '@shared/projection';
import { isBlankBitmap } from '@shared/sources';

/**
 * Direct capture in the Output window: getDisplayMedia() is answered by main's
 * setDisplayMediaRequestHandler with the chosen source, so frames never cross IPC.
 *
 * Switching: fade to black (150 ms) → stop the old tracks → start the new capture →
 * fade in on its first frame. Requests are serialized; a request superseded while
 * its capture was starting is dropped and its tracks stopped.
 */
const FADE_MS = 150;
const FIRST_FRAME_TIMEOUT_MS = 4000;
const BLANK_CHECK_MS = 2000;

const api = window.projectorOutput;
const video = document.getElementById('video') as HTMLVideoElement;
const probe = document.createElement('canvas');
probe.width = 64;
probe.height = 36;
const probeCtx = probe.getContext('2d', { willReadFrequently: true });

let latestToken = 0;
let stream: MediaStream | null = null;
let liveToken = 0;
let lastBlank: boolean | null = null;
let chain: Promise<void> = Promise.resolve();

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function report(s: Partial<SourceStatus> & Pick<SourceStatus, 'token' | 'state'>): void {
  api.reportSourceStatus({
    errorName: null,
    message: null,
    width: null,
    height: null,
    blank: false,
    ...s,
  });
}

async function fadeOut(): Promise<void> {
  if (video.style.opacity === '0') return;
  video.style.opacity = '0';
  await sleep(FADE_MS);
}

function fadeIn(): void {
  video.style.opacity = '1';
}

function stopStream(): void {
  if (!stream) return;
  for (const t of stream.getTracks()) t.stop();
  stream = null;
  liveToken = 0;
  video.srcObject = null;
}

function firstFrame(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, FIRST_FRAME_TIMEOUT_MS);
    video.requestVideoFrameCallback(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Sample a tiny copy of the current frame; minimized/protected sources come back black. */
function frameIsBlank(): boolean {
  if (!probeCtx || video.videoWidth === 0) return true;
  probeCtx.drawImage(video, 0, 0, probe.width, probe.height);
  const { data } = probeCtx.getImageData(0, 0, probe.width, probe.height);
  return isBlankBitmap(data, probe.width, probe.height);
}

function liveStatus(token: number, blank: boolean): void {
  const track = stream?.getVideoTracks()[0];
  const settings = track?.getSettings();
  lastBlank = blank;
  report({
    token,
    state: 'live',
    blank,
    width: settings?.width ?? video.videoWidth,
    height: settings?.height ?? video.videoHeight,
  });
}

async function switchTo(token: number, source: SourceDescriptor | null): Promise<void> {
  if (token !== latestToken) return; // superseded before we even started
  await fadeOut();
  stopStream();
  if (!source) {
    report({ token, state: 'idle' });
    return;
  }

  let s: MediaStream;
  try {
    s = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 60, max: 60 } },
      audio: false,
    });
  } catch (err) {
    if (token === latestToken) {
      const e = err as { name?: string; message?: string };
      report({
        token,
        state: 'error',
        errorName: e.name ?? null,
        message: e.message ?? String(err),
      });
    }
    return;
  }
  if (token !== latestToken) {
    for (const t of s.getTracks()) t.stop();
    return;
  }

  stream = s;
  liveToken = token;
  const track = s.getVideoTracks()[0];
  track?.addEventListener('ended', () => {
    if (stream !== s) return;
    // Source window closed (or capture revoked): go black and tell main.
    video.style.opacity = '0';
    stopStream();
    report({ token, state: 'ended' });
  });

  video.srcObject = s;
  await video.play().catch(() => undefined);
  await firstFrame();
  if (token !== latestToken || stream !== s) return;
  fadeIn();
  liveStatus(token, frameIsBlank());
}

api.onSetSource(({ token, source }) => {
  latestToken = token;
  chain = chain
    .then(() => switchTo(token, source))
    .catch((err: unknown) => {
      report({ token, state: 'error', errorName: null, message: String(err) });
    });
});

// While live, re-check for black frames (window minimized mid-presentation, DRM video).
setInterval(() => {
  if (!stream || liveToken === 0 || liveToken !== latestToken) return;
  const blank = frameIsBlank();
  if (blank !== lastBlank) liveStatus(liveToken, blank);
}, BLANK_CHECK_MS);

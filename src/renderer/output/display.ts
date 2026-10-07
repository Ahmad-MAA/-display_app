import { cropToPixels, DEFAULT_DISPLAY, placeImage, type OutputDisplay } from '@shared/geometry';

/**
 * Fill mode + crop on the Output.
 * - No crop: CSS object-fit on the <video> (contain / cover / fill).
 * - Crop: a canvas above the video draws only the crop region on every new video frame
 *   (requestVideoFrameCallback), placed with the same fill-mode rules.
 */
const video = document.getElementById('video') as HTMLVideoElement;
const canvas = document.getElementById('crop') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false });

let display: OutputDisplay = DEFAULT_DISPLAY;
let frameCallback: number | null = null;

function sizeCanvas(): void {
  const w = Math.round(window.innerWidth * window.devicePixelRatio);
  const h = Math.round(window.innerHeight * window.devicePixelRatio);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

function draw(): void {
  const crop = display.crop;
  if (!ctx || !crop) return;
  sizeCanvas();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (video.videoWidth === 0 || video.videoHeight === 0) return;
  const src = cropToPixels(crop, video.videoWidth, video.videoHeight);
  const dst = placeImage(src.width, src.height, canvas.width, canvas.height, display.fillMode);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(video, src.x, src.y, src.width, src.height, dst.x, dst.y, dst.width, dst.height);
}

function loop(): void {
  draw();
  frameCallback = video.requestVideoFrameCallback(loop);
}

function startLoop(): void {
  if (frameCallback !== null) return;
  frameCallback = video.requestVideoFrameCallback(loop);
  draw(); // show the crop immediately, even if the source is static right now
}

function stopLoop(): void {
  if (frameCallback !== null) video.cancelVideoFrameCallback(frameCallback);
  frameCallback = null;
}

export function applyDisplay(d: OutputDisplay): void {
  display = d;
  video.className = d.fillMode;
  if (d.crop) {
    canvas.hidden = false;
    startLoop();
  } else {
    stopLoop();
    canvas.hidden = true;
  }
}

window.projectorOutput.onDisplay(applyDisplay);
window.addEventListener('resize', draw);
// A new capture (source switch) restarts the frame callbacks on the same <video>.
video.addEventListener('loadedmetadata', () => {
  if (display.crop) {
    stopLoop();
    startLoop();
  }
});

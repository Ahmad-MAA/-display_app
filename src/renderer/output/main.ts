import type { TestPatternInfo } from '@shared/ipc';

const api = window.projectorOutput;
const pattern = document.getElementById('pattern') as HTMLDivElement;
let current: TestPatternInfo | null = null;

function reportViewport(): void {
  api.reportViewport({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
  });
}

function el(tag: string, cls: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function renderPattern(): void {
  pattern.replaceChildren();
  if (!current) {
    pattern.hidden = true;
    return;
  }
  const d = current.display;
  const physW = Math.round(window.innerWidth * window.devicePixelRatio);
  const physH = Math.round(window.innerHeight * window.devicePixelRatio);
  const matches = physW === d.nativeSize.width && physH === d.nativeSize.height;

  for (const c of ['tl', 'tr', 'bl', 'br']) pattern.append(el('div', `corner ${c}`));
  pattern.append(el('div', 'circle'));
  const info = el('div', 'info');
  info.append(
    el('div', '', `ProjectorDesk Output — ${d.label}`),
    el(
      'div',
      '',
      `Display bounds: ${d.bounds.width}×${d.bounds.height} DIP @ (${d.bounds.x}, ${d.bounds.y})`,
    ),
    el('div', '', `Scale factor: ${d.scaleFactor}  ·  ${d.displayFrequency} Hz`),
    el('div', '', `Expected: ${d.nativeSize.width}×${d.nativeSize.height} px`),
    el(
      'div',
      matches ? 'ok' : 'bad',
      `Rendering: ${window.innerWidth}×${window.innerHeight} DIP × ${window.devicePixelRatio} = ${physW}×${physH} px ${matches ? '✓' : '✗ MISMATCH'}`,
    ),
    el(
      'div',
      '',
      'All 4 yellow corners and the red border must be visible; the circle must be round.',
    ),
  );
  pattern.append(info);
  pattern.hidden = false;
}

api.onTestPattern((info) => {
  current = info;
  renderPattern();
});

window.addEventListener('resize', () => {
  reportViewport();
  renderPattern();
});
// devicePixelRatio changes when the window moves to a monitor with a different scale.
function watchDpr(): void {
  const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  mq.addEventListener(
    'change',
    () => {
      reportViewport();
      renderPattern();
      watchDpr();
    },
    { once: true },
  );
}
watchDpr();
reportViewport();

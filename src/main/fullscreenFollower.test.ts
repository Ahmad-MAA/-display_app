import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WinInfo } from '@shared/follow';
import type { SourceDescriptor } from '@shared/outputEngine';
import type { FollowInfo } from '@shared/projection';
import type { ElectronOutputEngine, FollowProblem } from './electronOutputEngine';
import { FullscreenFollower } from './fullscreenFollower';
import type { WindowHelper } from './windowHelper';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/projectordesk-test' } }));

const mon = { x: 0, y: 0, width: 1920, height: 1200 };
const win = (o: Partial<WinInfo>): WinInfo => ({
  hwnd: '1',
  pid: 7,
  processName: 'wmplayer',
  title: 'Windows Media Player Legacy',
  className: 'WMPlayerApp',
  exists: true,
  visible: true,
  minimized: false,
  maximized: false,
  cloaked: false,
  owned: false,
  fullscreen: false,
  rect: { x: 10, y: 10, width: 800, height: 600 },
  monitor: mon,
  ...o,
});
const picked: SourceDescriptor = {
  sourceId: 'window:1:0',
  kind: 'window',
  hwnd: '1',
  displayId: null,
  processName: 'wmplayer',
  title: 'Windows Media Player Legacy',
};
const screenSrc: SourceDescriptor = {
  sourceId: 'screen:0:0',
  kind: 'screen',
  hwnd: null,
  displayId: '3160810304',
  processName: null,
  title: 'Screen 1',
};

function setup() {
  let fullscreen: WinInfo[] = [];
  const helper = {
    available: true,
    follow: vi.fn(() => Promise.resolve({ target: win({}), fullscreen })),
    inspect: vi.fn(() => Promise.resolve([win({})])),
  };
  const calls: string[] = [];
  const engine = {
    onFollowProblem: null as ((p: FollowProblem) => void) | null,
    followTo: vi.fn((d: SourceDescriptor, info: FollowInfo) => {
      calls.push(`to ${d.sourceId} ${info.mode}`);
    }),
    followBack: vi.fn(() => {
      calls.push('back');
    }),
  };
  const follower = new FullscreenFollower(
    helper as unknown as WindowHelper,
    engine as unknown as ElectronOutputEngine,
    () => ({ descriptor: screenSrc, label: 'Display 1' }),
  );
  return {
    follower,
    engine,
    calls,
    setFullscreen: (w: WinInfo[]) => {
      fullscreen = w;
    },
  };
}

/** Advance one poll interval and let the async tick settle. */
async function poll(n = 1) {
  for (let i = 0; i < n; i++) await vi.advanceTimersByTimeAsync(300);
}

describe('FullscreenFollower', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('follows the separate full-screen window, falls back to its screen if black, and returns on exit', async () => {
    const t = setup();
    t.follower.onProjected(picked);
    await poll(2);
    expect(t.calls).toEqual([]); // nothing full screen yet

    t.setFullscreen([win({ hwnd: '2', className: 'WMP Skin Host', fullscreen: true, rect: mon })]);
    await poll(1);
    expect(t.calls).toEqual([]); // one observation is not enough
    await poll(1);
    expect(t.calls).toEqual(['to window:2:0 window']);

    t.engine.onFollowProblem?.('blank');
    expect(t.calls).toEqual(['to window:2:0 window', 'to screen:0:0 screen']);
    t.engine.onFollowProblem?.('blank'); // only one fallback per window
    expect(t.calls).toHaveLength(2);

    t.setFullscreen([]);
    await poll(2);
    expect(t.calls).toEqual(['to window:2:0 window', 'to screen:0:0 screen', 'back']);
  });

  it('ignores "ended" from the followed window (the next polls switch back)', async () => {
    const t = setup();
    t.follower.onProjected(picked);
    t.setFullscreen([win({ hwnd: '2', fullscreen: true })]);
    await poll(2);
    t.engine.onFollowProblem?.('ended');
    expect(t.calls).toEqual(['to window:2:0 window']);
  });

  it('does nothing for screen sources or when disabled', async () => {
    const t = setup();
    t.follower.onProjected(screenSrc);
    t.setFullscreen([win({ hwnd: '2', fullscreen: true })]);
    await poll(3);
    expect(t.calls).toEqual([]);

    t.follower.setEnabled(false);
    t.follower.onProjected(picked);
    await poll(3);
    expect(t.calls).toEqual(['back']); // setEnabled(false) returns to the picked window
  });

  it('turning it off while following goes back to the picked window', async () => {
    const t = setup();
    t.follower.onProjected(picked);
    t.setFullscreen([win({ hwnd: '2', fullscreen: true })]);
    await poll(2);
    t.follower.setEnabled(false);
    expect(t.calls).toEqual(['to window:2:0 window', 'back']);
  });
});

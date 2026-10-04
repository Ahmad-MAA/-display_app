import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, matchSource, parseSettings, type SourceRef } from './settings';
import type { CaptureSource } from './sources';

const src = (
  kind: 'window' | 'screen',
  title: string,
  processName: string | null,
  id: string,
  displayId: string | null = null,
): CaptureSource => ({
  descriptor: {
    sourceId: id,
    kind,
    hwnd: kind === 'window' ? id : null,
    displayId,
    processName,
    title,
  },
  thumbnail: null,
  icon: null,
  thumbnailBlank: false,
  minimized: false,
  isProjectorScreen: false,
  displayLabel: null,
});

describe('parseSettings', () => {
  it('returns defaults for garbage', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('nope')).toEqual(DEFAULT_SETTINGS);
  });
  it('keeps valid fields and drops invalid ones', () => {
    const s = parseSettings({
      preferredDisplayId: 47307338,
      fillMode: 'zoom',
      followFullscreen: false,
      hotkeys: { blank: 'CommandOrControl+Shift+B', freeze: 42 },
      engine: 'native',
      favorites: [
        { id: 'a', kind: 'window', processName: 'POWERPNT', title: 'Deck.pptx', displayId: null },
        { kind: 'window', title: 'no id' },
      ],
      lastProjection: { kind: 'window', processName: 'wmplayer', title: 'Windows Media Player' },
    });
    expect(s.preferredDisplayId).toBe(47307338);
    expect(s.fillMode).toBe('fit');
    expect(s.followFullscreen).toBe(false);
    expect(s.hotkeys.blank).toBe('CommandOrControl+Shift+B');
    expect(s.hotkeys.freeze).toBe(DEFAULT_SETTINGS.hotkeys.freeze);
    expect(s.engine).toBe('electron'); // native is Phase 2
    expect(s.favorites).toHaveLength(1);
    expect(s.lastProjection?.processName).toBe('wmplayer');
  });
});

describe('matchSource', () => {
  const list = [
    src('window', 'Deck.pptx - PowerPoint [Read-Only]', 'POWERPNT', '1'),
    src('window', 'Inbox - Outlook', 'olk', '2'),
    src('window', 'Budget.xlsx - Excel', 'EXCEL', '3'),
    src('window', 'Notes.xlsx - Excel', 'EXCEL', '4'),
    src('screen', 'Screen 2', null, 'screen:1:0', '47307338'),
  ];
  const ref = (o: Partial<SourceRef>): SourceRef => ({
    kind: 'window',
    processName: null,
    title: '',
    displayId: null,
    ...o,
  });

  it('matches by title containment within the same app', () => {
    expect(
      matchSource(list, ref({ processName: 'powerpnt', title: 'Deck.pptx - PowerPoint' }))
        ?.descriptor.sourceId,
    ).toBe('1');
  });
  it('falls back to the only window of that app', () => {
    expect(
      matchSource(list, ref({ processName: 'olk', title: 'Calendar - Outlook' }))?.descriptor
        .sourceId,
    ).toBe('2');
  });
  it('does not guess between several windows of the same app', () => {
    expect(
      matchSource(list, ref({ processName: 'EXCEL', title: 'Forecast.xlsx - Excel' })),
    ).toBeNull();
  });
  it('never matches another app with the same title', () => {
    expect(matchSource(list, ref({ processName: 'chrome', title: 'Inbox - Outlook' }))).toBeNull();
  });
  it('matches screens by display id', () => {
    expect(
      matchSource(list, ref({ kind: 'screen', title: 'Screen 2', displayId: '47307338' }))
        ?.descriptor.sourceId,
    ).toBe('screen:1:0');
  });
});

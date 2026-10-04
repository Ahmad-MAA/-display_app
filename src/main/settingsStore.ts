import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, parseSettings, type Settings } from '@shared/settings';
import { log } from './log';

const SAVE_DELAY_MS = 500;

/**
 * userData/settings.json. Loaded once at startup; every change is written (debounced)
 * via a temp file + rename so a crash mid-write can't leave a half-written file.
 * A corrupt file is kept as settings.corrupt-<time>.json and defaults are used.
 */
export class SettingsStore {
  private value: Settings = DEFAULT_SETTINGS;
  private timer: NodeJS.Timeout | null = null;
  private readonly file: string;

  constructor() {
    const dir = app.getPath('userData');
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'settings.json');
    this.load();
  }

  get current(): Settings {
    return this.value;
  }

  private load(): void {
    if (!existsSync(this.file)) {
      log('info', 'No settings yet; using defaults');
      return;
    }
    try {
      this.value = parseSettings(JSON.parse(readFileSync(this.file, 'utf8')));
      log('info', `Settings loaded (${this.value.favorites.length} favorites)`);
    } catch (err) {
      const backup = join(app.getPath('userData'), `settings.corrupt-${Date.now()}.json`);
      try {
        renameSync(this.file, backup);
      } catch {
        /* keep going with defaults */
      }
      log(
        'warn',
        `Settings file was unreadable (${String(err)}); kept a copy at ${backup} and reset to defaults`,
      );
    }
  }

  /** Merge a change; writes only when something actually changed. */
  update(patch: Partial<Settings>): void {
    const next = { ...this.value, ...patch };
    if (JSON.stringify(next) === JSON.stringify(this.value)) return;
    this.value = next;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.flush();
    }, SAVE_DELAY_MS);
  }

  /** Told once when saving starts failing (e.g. disk full, folder not writable). */
  onSaveError: ((message: string) => void) | null = null;
  private saveFailing = false;

  /** Write now (also called on quit). */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const tmp = `${this.file}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(this.value, null, 2), 'utf8');
      renameSync(tmp, this.file);
      this.saveFailing = false;
    } catch (err) {
      log('warn', `Could not save settings: ${String(err)}`);
      if (!this.saveFailing) this.onSaveError?.(`Settings could not be saved (${String(err)}).`);
      this.saveFailing = true;
    }
  }
}

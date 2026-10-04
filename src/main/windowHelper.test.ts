import { describe, expect, it, vi } from 'vitest';
import { bootstrapCommand, encodePowerShell, MAX_WINDOWS_COMMAND_LINE } from './windowHelper';
import { WINDOW_HELPER_SCRIPT } from './windowHelper.ps1';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/projectordesk-test' } }));

describe('window helper launch', () => {
  it('keeps the PowerShell command line far below the Windows limit, however big the script', () => {
    const path =
      'C:\\Users\\Some Very Long User Name\\AppData\\Roaming\\ProjectorDesk\\window-helper.ps1';
    const arg = encodePowerShell(bootstrapCommand(path));
    expect(arg.length).toBeLessThan(2000);
    // Regression: embedding the script itself (old approach) exceeded the limit.
    expect(encodePowerShell(WINDOW_HELPER_SCRIPT).length).toBeGreaterThan(MAX_WINDOWS_COMMAND_LINE);
  });

  it("escapes apostrophes in the script path (e.g. C:\\Users\\O'Brien)", () => {
    expect(bootstrapCommand("C:\\Users\\O'Brien\\x.ps1")).toBe(
      "& ([ScriptBlock]::Create([IO.File]::ReadAllText('C:\\Users\\O''Brien\\x.ps1')))",
    );
  });

  it('script is plain ASCII (safe for Windows PowerShell 5.1 file reading)', () => {
    expect([...WINDOW_HELPER_SCRIPT].every((c) => c.charCodeAt(0) < 128)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { parseEngineLine, parseNetCoreRuntimes, pickRuntime } from './nativeEngine';

const LIST = `Microsoft.AspNetCore.App 8.0.11 [C:\\Program Files\\dotnet\\shared\\Microsoft.AspNetCore.App]
Microsoft.NETCore.App 8.0.11 [C:\\Program Files\\dotnet\\shared\\Microsoft.NETCore.App]
Microsoft.NETCore.App 10.0.0-rc.2.25502.107 [C:\\Program Files\\dotnet\\shared\\Microsoft.NETCore.App]
Microsoft.NETCore.App 10.0.12 [C:\\Program Files\\dotnet\\shared\\Microsoft.NETCore.App]
Microsoft.WindowsDesktop.App 10.0.12 [C:\\Program Files\\dotnet\\shared\\Microsoft.WindowsDesktop.App]
`;

describe('dotnet runtimes', () => {
  it('lists only Microsoft.NETCore.App versions', () => {
    expect(parseNetCoreRuntimes(LIST)).toEqual(['8.0.11', '10.0.0-rc.2.25502.107', '10.0.12']);
  });

  it('picks the newest runtime of the major version, releases over previews', () => {
    expect(pickRuntime(parseNetCoreRuntimes(LIST))).toBe('10.0.12');
    expect(pickRuntime(['10.0.0-rc.2', '10.0.0'])).toBe('10.0.0');
    expect(pickRuntime(['10.0.9', '10.0.10'])).toBe('10.0.10');
  });

  it('returns null without .NET 10', () => {
    expect(pickRuntime(['8.0.11', '9.0.3'])).toBeNull();
    expect(pickRuntime(parseNetCoreRuntimes(''))).toBeNull();
  });
});

describe('parseEngineLine', () => {
  it('parses known reports', () => {
    expect(parseEngineLine('{"type":"probe","name":"direct3d11","ok":true,"detail":"x"}')).toEqual({
      type: 'probe',
      name: 'direct3d11',
      ok: true,
      detail: 'x',
    });
  });

  it('ignores noise, bad JSON and unknown types', () => {
    expect(parseEngineLine('Unhandled exception. System.IO.FileLoadException')).toBeNull();
    expect(parseEngineLine('{"type":')).toBeNull();
    expect(parseEngineLine('{"type":"telemetry"}')).toBeNull();
    expect(parseEngineLine('[1,2]')).toBeNull();
  });
});

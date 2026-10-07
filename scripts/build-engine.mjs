// Builds the Phase 2 native engine (engine/ProjectorDesk.Engine) into build/engine/.
// Runs before `npm run dev`. Without the .NET SDK it warns and carries on, so Phase 1
// development doesn't depend on .NET; the Native engine card then says the engine is missing.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const strict = process.argv.includes('--strict');
const project = join(root, 'engine', 'ProjectorDesk.Engine', 'ProjectorDesk.Engine.csproj');
const out = join(root, 'build', 'engine');

const r = spawnSync(
  'dotnet',
  ['build', project, '-c', 'Release', '-o', out, '--nologo', '-v', 'q'],
  {
    stdio: 'inherit',
    env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' },
  },
);

if (r.error) {
  const msg = `Native engine not built: the .NET SDK was not found (${r.error.message}). Install the .NET 10 SDK to build it.`;
  if (strict) {
    console.error(msg);
    process.exit(1);
  }
  console.warn(`\n⚠ ${msg}\n`);
  process.exit(0);
}
if (r.status !== 0) {
  const msg = `Native engine build failed (exit code ${r.status}).`;
  if (strict) {
    console.error(msg);
    process.exit(r.status ?? 1);
  }
  console.warn(`\n⚠ ${msg} Phase 1 still runs; the Native engine card will report it.\n`);
  process.exit(0);
}
console.log(`Native engine built into ${out}`);

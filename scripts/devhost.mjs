// Dev host: run `npm run dev` inside an installed ProjectorDesk build that Smart App Control
// has already cleared, instead of node_modules' unsigned electron.exe (which SAC may block).
//
//   npm run devhost:install   copy the loader into <install>/resources/app
//   npm run dev:host          build the engine, then electron-vite dev using the installed exe
//                             (extra Electron flags: npm run dev:host -- -- --flag)
//   npm run devhost:remove    delete the loader (the installed app is exactly as before)
//
// Install folder: --dir <path>, or PROJECTORDESK_HOST_DIR, or the installer's default
// %LOCALAPPDATA%\Programs\ProjectorDesk.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const command = args[0];
const dirFlag = args.indexOf('--dir');
// --dir must come before a `--` separator.
const installDir =
  (dirFlag >= 0 ? args[dirFlag + 1] : undefined) ??
  process.env.PROJECTORDESK_HOST_DIR ??
  join(process.env.LOCALAPPDATA ?? '', 'Programs', 'ProjectorDesk');
const exe = join(installDir, process.platform === 'win32' ? 'ProjectorDesk.exe' : 'ProjectorDesk');
const loaderDir = join(installDir, 'resources', 'app');

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

function requireInstall() {
  if (!existsSync(exe)) {
    fail(
      `No installed ProjectorDesk at ${installDir}. Install it with the Setup exe, or pass --dir <folder containing ProjectorDesk.exe>.`,
    );
  }
}

switch (command) {
  case 'install': {
    requireInstall();
    cpSync(join(root, 'scripts', 'devhost'), loaderDir, { recursive: true });
    console.log(`Dev host loader installed in ${loaderDir}.`);
    console.log('Start menu ProjectorDesk still runs the installed app. Now: npm run dev:host');
    break;
  }
  case 'remove': {
    rmSync(loaderDir, { recursive: true, force: true });
    console.log(`Dev host loader removed from ${installDir}.`);
    break;
  }
  case 'run': {
    requireInstall();
    if (!existsSync(join(loaderDir, 'main.js')))
      fail('Dev host loader not installed: run npm run devhost:install first.');
    spawnSync(process.execPath, [join(root, 'scripts', 'build-engine.mjs')], { stdio: 'inherit' });
    console.log(`Running electron-vite dev with ${exe}`);
    // Anything after `--` goes to Electron (electron-vite reads it from its own `--`).
    const sep = args.indexOf('--');
    const electronArgs = sep >= 0 ? ['--', ...args.slice(sep + 1)] : [];
    const child = spawn('npx', ['electron-vite', 'dev', ...electronArgs], {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, ELECTRON_EXEC_PATH: exe },
    });
    child.on('exit', (code) => process.exit(code ?? 0));
    break;
  }
  default:
    fail('Usage: node scripts/devhost.mjs install|run|remove [--dir <install folder>]');
}

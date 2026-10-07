// ProjectorDesk dev host loader, copied into an installed ProjectorDesk's resources/app/ by
// `npm run devhost:install`. Electron loads resources/app before resources/app.asar, so:
//  - started by `npm run dev:host` (electron-vite passes the repo path): run the repo's dev
//    build inside this installed, Smart-App-Control-cleared ProjectorDesk.exe;
//  - started normally (Start menu): run the installed app from app.asar as before.
// Only JavaScript is added: the installed .exe and DLLs are unchanged.
// package.json carries the real app's name, so settings and logs stay in %APPDATA%\ProjectorDesk.
'use strict';
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

function readPackage(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

function runFrom(appPath, pkg) {
  // Same call Electron's own default app makes when given a folder to run.
  if (typeof app.setAppPath === 'function') app.setAppPath(appPath);
  if (pkg.version && typeof app.setVersion === 'function') app.setVersion(pkg.version);
  require(path.join(appPath, pkg.main));
}

const arg = process.argv.slice(1).find((a) => !a.startsWith('-'));
const devRoot = arg ? path.resolve(arg) : null;
const devPackage = devRoot ? readPackage(devRoot) : null;

if (devRoot && devPackage && devPackage.name === 'projectordesk' && devPackage.main) {
  process.env.PROJECTORDESK_DEV_ROOT = devRoot;
  const expected = readPackage(path.join(devRoot, 'node_modules', 'electron'));
  console.log(
    `[dev host] running ${devRoot} inside ${process.execPath} (Electron ${process.versions.electron})`,
  );
  if (expected && expected.version !== process.versions.electron) {
    console.warn(
      `[dev host] WARNING: the project expects Electron ${expected.version}; this host is ${process.versions.electron}.`,
    );
  }
  runFrom(devRoot, devPackage);
} else {
  const asar = path.join(process.resourcesPath, 'app.asar');
  const installed = readPackage(asar);
  if (!installed) throw new Error(`ProjectorDesk dev host: no app found at ${asar}`);
  runFrom(asar, installed);
}

import { formatPixelRect, type NativeEngineStatus } from '@shared/nativeEngine';
import type { AppState, LogEntry, PlacementReport } from '@shared/diagnostics';
import type { SourceList } from '@shared/sources';
import { formatRect } from '@shared/displays';
import { HARDWARE_CHECKS, type CheckId, type CheckResult } from './checklist';

export interface CheckRecord {
  result: CheckResult;
  /** Placement snapshot taken when the result was recorded. */
  snapshot: string | null;
}

export function placementSummary(state: AppState): string {
  const p = state.placement;
  const layout = state.displays
    .map(
      (d) =>
        `${d.isPrimary ? 'P' : 'S'}:${d.bounds.width}x${d.bounds.height}@(${d.bounds.x},${d.bounds.y})x${d.scaleFactor}`,
    )
    .join(' ');
  if (!p) return `${layout} | no placement`;
  return `${layout} | hotplug-recoveries ${state.hotplugRecoveries} | output ${formatRect(p.actual)} ${p.ok ? 'OK' : 'FAIL: ' + p.problems.join('; ')}${p.corrected ? ' (corrected)' : ''}`;
}

function sourcesBlock(list: SourceList | null): string {
  if (!list) return '_Not loaded._';
  if (list.error) return `❌ ${list.error}`;
  const windows = list.sources.filter((s) => s.descriptor.kind === 'window');
  const screens = list.sources.filter((s) => s.descriptor.kind === 'screen');
  const named = windows.filter((s) => s.descriptor.processName !== null).length;
  const rows = list.sources
    .map(
      (s) =>
        `| ${s.descriptor.kind} | ${s.descriptor.title.replace(/\|/g, '/').slice(0, 60)} | ${s.descriptor.processName ?? s.displayLabel ?? '—'} | ${s.descriptor.hwnd ?? s.descriptor.displayId ?? '—'} | ${s.icon ? '✓' : '—'} | ${s.minimized ? 'MINIMIZED' : s.thumbnailBlank ? 'BLANK' : 'ok'}${s.isProjectorScreen ? ' · projector' : ''} |`,
    )
    .join('\n');
  return `${windows.length} windows (${named} with process name, ${windows.filter((s) => s.minimized).length} minimized, ${windows.filter((s) => s.thumbnailBlank && !s.minimized).length} blank), ${screens.length} screens; listed at ${list.at}

| kind | title | process / display | HWND / display id | icon | thumbnail |
|---|---|---|---|---|---|
${rows}`;
}

function placementBlock(p: PlacementReport | null): string {
  if (!p) return '_No placement yet (single display?)._';
  const v = p.viewport;
  return [
    `- Target: ${p.targetLabel} (id ${p.targetDisplayId})`,
    `- Expected: ${formatRect(p.expected)} · Actual: ${formatRect(p.actual)} · Matched display: ${p.matchedDisplayId}`,
    `- Full screen: ${p.fullScreen} · setBounds attempts: ${p.attempts} · corrected: ${p.corrected}`,
    `- Scale: target ${p.targetScaleFactor}, primary ${p.primaryScaleFactor}${p.mixedDpi ? ' (mixed DPI)' : ''}`,
    v
      ? `- Renderer: ${v.innerWidth}×${v.innerHeight} DIP × DPR ${v.devicePixelRatio}`
      : '- Renderer: (no viewport report)',
    `- Result: ${p.ok ? '✅ OK' : '❌ ' + p.problems.join('; ')}`,
  ].join('\n');
}

function nativeBlock(n: NativeEngineStatus): string {
  const lines = [`- state: **${n.state}**: ${n.message}`];
  if (n.runtime)
    lines.push(
      `- .NET ${n.runtime} via \`${n.dotnetPath ?? '?'}\`; engine \`${n.engineDll ?? '?'}\``,
    );
  if (n.engine)
    lines.push(
      `- engine ${n.engine.version}, protocol v${n.engine.protocol}, ${n.engine.runtime}, ${n.engine.os}`,
    );
  for (const p of n.probes) lines.push(`- probe ${p.name}: ${p.ok ? '✅' : '❌'} ${p.detail}`);
  if (n.dpiAwareness) lines.push(`- DPI awareness: ${n.dpiAwareness}`);
  if (n.affinity)
    lines.push(
      `- capture exclusion: ${n.affinity.verified ? '✅ verified' : '❌ NOT verified'} (affinity ${n.affinity.actual})`,
    );
  if (n.placement) {
    const p = n.placement;
    lines.push(
      `- placement: ${p.exact ? '✅ exact' : `❌ ${p.problems.join('; ')}`}; requested ${formatPixelRect(p.requested)}, window ${formatPixelRect(p.actual)}, monitor ${formatPixelRect(p.monitor)} (physical px)${p.notes.length ? `; ${p.notes.join('; ')}` : ''}`,
    );
  }
  if (n.placements)
    lines.push(`- placements: ${n.placements}, back after unplug: ${n.hotplugRecoveries}`);
  if (n.exitCode !== null) lines.push(`- exit code: ${n.exitCode}`);
  if (n.stderr) lines.push('```', n.stderr.trimEnd(), '```');
  return lines.join('\n');
}

export function buildReport(
  state: AppState,
  checks: Record<CheckId, CheckRecord>,
  logs: LogEntry[],
  sources: SourceList | null,
): string {
  const cp = state.contentProtection;
  const displays = state.displays
    .map(
      (d) =>
        `| ${d.id} | ${d.label}${d.isPrimary ? ' (primary)' : ''} | ${formatRect(d.bounds)} | ${d.scaleFactor} | ${d.nativeSize.width}×${d.nativeSize.height} | ${d.displayFrequency} | ${d.colorDepth} | ${d.colorSpace} |`,
    )
    .join('\n');
  const checklist = HARDWARE_CHECKS.map((c) => {
    const r = checks[c.id] ?? { result: 'untested', snapshot: null };
    const box = r.result === 'pass' ? '[x]' : '[ ]';
    const tag = r.result === 'untested' ? 'untested' : r.result.toUpperCase();
    return `- ${box} ${c.label} — **${tag}**${r.snapshot ? `\n  - \`${r.snapshot}\`` : ''}`;
  }).join('\n');
  const warnings = logs
    .filter((l) => l.level !== 'info')
    .slice(-40)
    .map((l) => `${l.at} [${l.level}] ${l.message}`)
    .join('\n');

  return `## ProjectorDesk step 1 hardware report

### Content protection
${cp ? `${cp.ok ? '✅' : '❌'} ${cp.message} (platform ${cp.platform} ${cp.osVersion}, isContentProtected=${cp.reportedByElectron})` : 'n/a'}

### Native engine (Phase 2)
${nativeBlock(state.nativeEngine)}

### Window helper
${state.windowHelper.supported ? (state.windowHelper.reason ? `❌ unavailable: ${state.windowHelper.reason}` : '✅ running (or not needed yet)') : 'n/a (not Windows)'}

### Displays
| id | label | bounds (DIP) | scale | native px | Hz | colorDepth | colorSpace |
|---|---|---|---|---|---|---|---|
${displays}

### Current Output placement
${placementBlock(state.placement)}

### Sources
${sourcesBlock(sources)}

### Hardware gate checklist
${checklist}

### Follow full screen trace (last 30)
\`\`\`
${
  logs
    .filter((l) => l.message.startsWith('Follow:'))
    .slice(-30)
    .map((l) => `${l.at} ${l.message}`)
    .join('\n') || '(none)'
}
\`\`\`

### Focus checks
\`\`\`
${
  logs
    .filter((l) => l.message.startsWith('Focus check:'))
    .slice(-5)
    .map((l) => `${l.at} ${l.message}`)
    .join('\n') || '(none)'
}
\`\`\`

### Warnings / errors (last 40)
\`\`\`
${warnings || '(none)'}
\`\`\`
`;
}

import type { AppState, LogEntry, PlacementReport } from '@shared/diagnostics';
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

export function buildReport(
  state: AppState,
  checks: Record<CheckId, CheckRecord>,
  logs: LogEntry[],
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

### Displays
| id | label | bounds (DIP) | scale | native px | Hz | colorDepth | colorSpace |
|---|---|---|---|---|---|---|---|
${displays}

### Current Output placement
${placementBlock(state.placement)}

### Hardware gate checklist
${checklist}

### Warnings / errors (last 40)
\`\`\`
${warnings || '(none)'}
\`\`\`
`;
}

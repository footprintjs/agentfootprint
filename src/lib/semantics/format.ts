/**
 * semantics/format — rendering one {@link SemanticsReport} for a terminal.
 *
 * Pattern: the tool-lint `format.ts` sibling — pure string building, no IO.
 * Role:    lib/ layer, pure.
 * Emits:   N/A.
 */

import type { SemanticsFinding, SemanticsReport } from './check.js';

function findingLine(f: SemanticsFinding): string {
  const mark = f.severity === 'error' ? '✗' : '⚠';
  const where = f.resultIndex !== undefined ? ` result ${f.resultIndex + 1}` : '';
  return `  ${mark} ${f.tool}${where}  [${f.code}]  field: ${f.field}\n      ${f.message}`;
}

/** Render the report. Every finding names its tool and its field — the two
 *  facts a build log must carry for the fix to be a one-line edit. */
export function formatSemanticsReport(report: SemanticsReport): string {
  const errors = report.findings.filter((f) => f.severity === 'error');
  const warnings = report.findings.filter((f) => f.severity === 'warning');
  const lines: string[] = [
    `check:semantics — ${report.checkedTools} tool${report.checkedTools === 1 ? '' : 's'}, ` +
      `${report.checkedResults} sample result${report.checkedResults === 1 ? '' : 's'}`,
  ];
  if (report.findings.length === 0) {
    lines.push('  ✓ every sampled result honors the semantic vocabulary and its class rules');
  } else {
    for (const f of report.findings) lines.push(findingLine(f));
  }
  lines.push(
    `${report.ok ? 'ok' : 'FAILED'} — ${errors.length} error${errors.length === 1 ? '' : 's'}, ` +
      `${warnings.length} warning${warnings.length === 1 ? '' : 's'}`,
  );
  return lines.join('\n');
}

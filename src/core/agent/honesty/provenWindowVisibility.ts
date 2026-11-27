import { toUtc } from '../../../time/instant.js';
import { retainedStateValue, runKeepsOut } from '../../../redaction/runRedaction.js';
import type { TimeRange } from '../../../time/range.js';

/** Use the exact wording and the native rule that will serve the final text. */
export function provenWindowLine({ from, to }: TimeRange): string {
  return `Window: ${toUtc(from, 'strict') ?? from} to ${toUtc(to, 'strict') ?? to} (end excluded).`;
}

export function canDiscloseProvenWindow(scope: object, range: TimeRange): boolean {
  const line = provenWindowLine(range);
  return (
    !runKeepsOut(scope, 'userMessage') &&
    !runKeepsOut(scope, 'history') &&
    !runKeepsOut(scope, 'findingsLedger') &&
    retainedStateValue(scope, 'finalContent', line) === line
  );
}

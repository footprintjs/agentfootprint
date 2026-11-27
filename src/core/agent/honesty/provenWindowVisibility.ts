import { retainedStateValue, runKeepsOut } from '../../../redaction/runRedaction.js';
import type { TimeRange } from '../../../time/range.js';

/** Use the exact wording and the native rule that will serve the final text. */
export function provenWindowLine({ from, to }: TimeRange): string {
  return `Window: ${from} to ${to} (end excluded).`;
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

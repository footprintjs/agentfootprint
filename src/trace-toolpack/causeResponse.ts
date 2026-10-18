import type { GapCode } from 'foottrace/cause';
import type { TraceCauseOperation } from './causeTypes.js';

const SNAPSHOT_LIMITATION =
  'Snapshot-only records have no engine-written capture/end attestation. This reader cannot prove a root cause from them, even after a normally finished run.';

function interpretationFor(text: string, snapshotOnly: boolean): string {
  return snapshotOnly ? `${text} ${SNAPSHOT_LIMITATION}` : text;
}

/** Fixed wording: no exception messages, state values or provider payloads cross this boundary. */
export function causeGap(tool: TraceCauseOperation, code: GapCode, snapshotOnly = false): string {
  return JSON.stringify({
    tool,
    mode: 'recorded-evidence',
    confidence: 'incomplete',
    gaps: [{ code, evidence: [] }],
    interpretation: interpretationFor(
      'Not sure, because the requested evidence could not be fully read. No root cause is asserted.',
      snapshotOnly,
    ),
  });
}

/** A clipped proof must never leave behind a seemingly supported root or apparently complete empty list. */
export function causeResponse(
  tool: TraceCauseOperation,
  finding: unknown,
  interpretation: string,
  maxChars: number,
  snapshotOnly = false,
): string {
  const text = JSON.stringify({
    tool,
    mode: 'recorded-evidence',
    finding,
    interpretation: interpretationFor(interpretation, snapshotOnly),
  });
  return text.length <= maxChars ? text : causeGap(tool, 'truncated', snapshotOnly);
}

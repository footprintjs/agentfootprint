import type { GapCode } from 'foottrace/cause';
import type { TraceCauseOperation } from './causeTypes.js';

/** Fixed wording: no exception messages, state values or provider payloads cross this boundary. */
export function causeGap(tool: TraceCauseOperation, code: GapCode): string {
  return JSON.stringify({
    tool,
    mode: 'recorded-evidence',
    confidence: 'incomplete',
    gaps: [{ code, evidence: [] }],
    interpretation:
      'Not sure, because the requested evidence could not be fully read. No root cause is asserted.',
  });
}

/** A clipped proof must never leave behind a seemingly supported root or apparently complete empty list. */
export function causeResponse(
  tool: TraceCauseOperation,
  finding: unknown,
  interpretation: string,
  maxChars: number,
): string {
  const text = JSON.stringify({ tool, mode: 'recorded-evidence', finding, interpretation });
  return text.length <= maxChars ? text : causeGap(tool, 'truncated');
}

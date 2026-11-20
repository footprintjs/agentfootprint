import { leastHeld, periodVerdict } from '../../../semantics/coverage/period.js';
import { readCoverageResult } from '../../../semantics/coverage/read.js';
import { readToolResultEnvelope } from '../../../semantics/toolEffects.js';
import { callOutcomeOf } from '../../../semantics/toolOutcome.js';
import { parseMaybeJson } from '../emptiness.js';

/** A replacement proves only the declarations the tool rule actually delivered. */
export function readRewrittenToolResult(value: unknown) {
  const envelope = readToolResultEnvelope(parseMaybeJson(value));
  const content = envelope === undefined ? value : envelope.content;
  const coverage = readCoverageResult(parseMaybeJson(content));
  const periods = coverage?.declared.flatMap(({ period }) =>
    period === undefined ? [] : [periodVerdict(period)],
  );
  const status = envelope?.status;
  return {
    content,
    outcome: callOutcomeOf({ ran: true, clean: true, status }),
    reportedStatus: status === 'partial' || status === 'pending' ? status : undefined,
    period: periods === undefined ? undefined : leastHeld(periods),
  };
}

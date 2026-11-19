import { readCoverageResult } from '../../../semantics/coverage/read.js';
import { periodVerdict, leastHeld } from '../../../semantics/coverage/period.js';
import { readToolResultEnvelope } from '../../../semantics/toolEffects.js';
import { callOutcomeOf } from '../../../semantics/toolOutcome.js';
import { parseMaybeJson } from '../emptiness.js';
import type { TurnResult } from './turnResults.js';

/** Read a rewrite's declarations from its served bytes, without reading the native rows. */
function rewrittenResult(result: TurnResult): {
  readonly result: TurnResult;
  readonly period: ReturnType<typeof leastHeld>;
} {
  const envelope = readToolResultEnvelope(parseMaybeJson(result.content));
  const content = envelope === undefined ? result.content : envelope.content;
  const coverage = readCoverageResult(parseMaybeJson(content));
  const periods = coverage?.declared.flatMap(({ period }) =>
    period === undefined ? [] : [periodVerdict(period)],
  );
  const status = envelope?.status;
  const outcome = callOutcomeOf({ ran: true, clean: true, status });
  const reportedStatus = status === 'partial' || status === 'pending' ? status : undefined;
  return {
    result: {
      index: result.index,
      rewritten: true,
      ...(result.toolCallId !== undefined && { toolCallId: result.toolCallId }),
      ...(result.toolName !== undefined && { toolName: result.toolName }),
      content,
      ...(outcome !== undefined && { outcome }),
      ...(reportedStatus !== undefined && { reportedStatus }),
    },
    period: periods === undefined ? undefined : leastHeld(periods),
  };
}

export function deliveredResults(
  recorded: readonly TurnResult[],
  dispositions: ReadonlyMap<number, 'withheld' | 'rewritten'>,
) {
  let withheld = false;
  const periods: { result: TurnResult; verdict: NonNullable<ReturnType<typeof leastHeld>> }[] = [];
  const results = recorded.flatMap((result) => {
    const disposition = dispositions.get(result.index);
    if (disposition === 'withheld') {
      withheld = true;
      return [];
    }
    if (disposition !== 'rewritten') return [result];
    const projection = rewrittenResult(result);
    if (projection.period !== undefined) periods.push({ result, verdict: projection.period });
    return [projection.result];
  });
  return { results, withheld, periods };
}

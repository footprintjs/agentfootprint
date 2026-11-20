import { readRewrittenToolResult } from '../recordedCalls.js';
import type { TurnResult } from './turnResults.js';

/** Read a rewrite's declarations from its served bytes, without reading the native rows. */
function rewrittenResult(result: TurnResult): {
  readonly result: TurnResult;
  readonly period: ReturnType<typeof readRewrittenToolResult>['period'];
} {
  const { content, outcome, reportedStatus, period } = readRewrittenToolResult(result.content);
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
    period,
  };
}

export function deliveredResults(
  recorded: readonly TurnResult[],
  dispositions: ReadonlyMap<number, 'withheld' | 'rewritten'>,
) {
  const periods: {
    result: TurnResult;
    verdict: NonNullable<ReturnType<typeof readRewrittenToolResult>['period']>;
  }[] = [];
  const results = recorded.flatMap((result) => {
    const disposition = dispositions.get(result.index);
    if (disposition === 'withheld') return [];
    if (disposition !== 'rewritten') return [result];
    const projection = rewrittenResult(result);
    if (projection.period !== undefined) periods.push({ result, verdict: projection.period });
    return [projection.result];
  });
  return { results, periods };
}

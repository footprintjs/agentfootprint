import { readToolSettlements, type HistoryCall } from '../recordedCalls.js';
import type { CoverageRow } from './coverageRows.js';
import { fire, type Gathered } from './gathered.js';
import { historyPointer, statePointer } from './pointer.js';
import { readCallOutcomes } from './resultEvidence.js';
import type { TurnResult } from './turnResults.js';
import type { AssessmentReason } from './types.js';

type Settlements = NonNullable<ReturnType<typeof readToolSettlements>>;

/** Retained messages can place a witness or prove equal-argument recovery. */
export function placeSettledResults(
  settlements: Settlements,
  results: readonly TurnResult[],
  current: readonly HistoryCall[],
) {
  const keyAt = new Map(current.map((call) => [call.index, call.occurrenceKey]));
  const byKey = new Map<string, TurnResult>();
  const byIndex = new Map<number, NonNullable<ReturnType<Settlements['byKey']['get']>>['fact']>();
  const retained = results.flatMap((result) => {
    if (result.batchRefusal) return [result];
    const key = keyAt.get(result.index);
    if (typeof key !== 'string') return [];
    const fact = settlements.byKey.get(key)?.fact;
    if (fact === undefined || fact.delivery === 'withheld') return [];
    const { outcome: old, outcomePath, reportedStatus: _status, ...base } = result;
    const kept: TurnResult = {
      ...base,
      ...(fact.outcome === 'settled' && {
        outcomePath: '/notDispatched/pausedCall/toolCallId' as const,
      }),
      ...(fact.outcome !== undefined &&
        fact.outcome !== 'settled' && {
          outcome: fact.outcome,
          ...(old === fact.outcome && outcomePath !== undefined && { outcomePath }),
        }),
      ...(fact.reportedStatus !== undefined && { reportedStatus: fact.reportedStatus }),
    };
    byKey.set(key, kept);
    byIndex.set(result.index, fact);
    return [kept];
  });
  return { retained, byKey, byIndex };
}

/** Settlement owns the reason. History gives it a location only when the message survives. */
export function readSettledResults(
  settlements: Settlements,
  placed: ReturnType<typeof placeSettledResults>,
  coverage: readonly CoverageRow[],
  recovered: ReadonlySet<number>,
  periodReasons: Readonly<Record<string, AssessmentReason>>,
  g: Gathered,
): void {
  const absenceCalls = new Set(
    coverage.filter((row) => row.kind === 'absence').map((row) => row.occurrenceKey),
  );
  const gapCalls = new Set(coverage.filter((row) => row.gap).map((row) => row.occurrenceKey));
  readCallOutcomes(placed.retained, recovered, g);
  for (const [key, { index, fact }] of settlements.byKey) {
    if (fact.delivery === 'withheld') continue;
    const result = placed.byKey.get(key);
    const at = (field: string) =>
      result === undefined
        ? statePointer('settledToolCalls', index, field)
        : historyPointer(result);
    if (result === undefined) {
      if (fact.outcome !== undefined) fire(g, 'call-not-completed', at('outcome'));
      else if (fact.reportedStatus !== undefined)
        fire(g, 'work-not-finished', at('reportedStatus'));
    }
    if (fact.empty !== undefined && !(fact.empty === 'declared-absent' && absenceCalls.has(key)))
      fire(g, fact.empty, at('empty'));
    if (fact.gap === true && !gapCalls.has(key)) fire(g, 'coverage-gap', at('gap'));
    const period =
      fact.rewrittenPeriod === undefined ? undefined : periodReasons[fact.rewrittenPeriod];
    if (period !== undefined) fire(g, period, at('rewrittenPeriod'));
  }
}

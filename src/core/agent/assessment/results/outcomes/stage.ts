import type { AttemptCategory } from 'footprintjs';
import type { ToolOutputCounts } from '../../../../../provider-contract/toolResultRecord.js';
import {
  historyCallResolver,
  readToolSettlements,
  type HistoryCall,
  type RecordedToolSettlement,
} from '../../../recordedCalls.js';
import { witnessRowIndex } from '../../pointer.js';
import type { AssessmentPointer } from '../../types.js';

export interface OutcomeSettlement {
  readonly index: number;
  readonly fact: Pick<
    RecordedToolSettlement,
    'outcome' | 'failureCategory' | 'reportedStatus' | 'outputCounts'
  >;
}

interface OutcomeDetailRead {
  readonly failureByHistory: ReadonlyMap<number, AttemptCategory>;
  readonly failureFor: (witness: readonly AssessmentPointer[]) => AttemptCategory | undefined;
  readonly countsFor: (witness: readonly AssessmentPointer[]) => ToolOutputCounts | undefined;
}

function atWitness<T>(
  at: AssessmentPointer,
  history: ReadonlyMap<number, T>,
  settlements: ReadonlyMap<number, T>,
): T | undefined {
  if (at.kind === 'history') return history.get(at.index);
  if (at.key !== 'settledToolCalls') return undefined;
  const slot = witnessRowIndex(at.path);
  return slot === undefined ? undefined : settlements.get(slot);
}

/** Read admitted outcome details that the retained record still shows at the same occurrence and slot. */
export function outcomeDetailReader(
  calls: readonly HistoryCall[],
  settlements: ReadonlyMap<string, OutcomeSettlement> | undefined,
  readRetained: () => unknown,
): OutcomeDetailRead {
  const failureByHistory = new Map<number, AttemptCategory>();
  const failureBySettlement = new Map<number, AttemptCategory>();
  const countsByHistory = new Map<number, ToolOutputCounts>();
  const countsBySettlement = new Map<number, ToolOutputCounts>();
  const visible =
    settlements === undefined ? undefined : readToolSettlements(readRetained(), true)?.byKey;
  if (settlements !== undefined && visible !== undefined) {
    let resolve: ReturnType<typeof historyCallResolver> | undefined;
    for (const [key, { index, fact }] of settlements) {
      const row = visible.get(key);
      if (row?.index !== index) continue;
      const category =
        fact.outcome === 'failed' && row.fact.failureCategory === fact.failureCategory
          ? fact.failureCategory
          : undefined;
      const counts = fact.outputCounts;
      const retained = row.fact.outputCounts;
      const measured =
        counts !== undefined &&
        retained !== undefined &&
        counts.kept === retained.kept &&
        counts.total === retained.total &&
        counts.unit === retained.unit &&
        fact.outcome === row.fact.outcome &&
        fact.reportedStatus === row.fact.reportedStatus
          ? retained
          : undefined;
      if (category === undefined && measured === undefined) continue;
      const match = (resolve ??= historyCallResolver(calls))(undefined, undefined, key);
      if (category !== undefined) {
        failureBySettlement.set(index, category);
        if (match.kind === 'matched') failureByHistory.set(match.call.index, category);
      }
      if (measured !== undefined) {
        countsBySettlement.set(index, measured);
        if (match.kind === 'matched') countsByHistory.set(match.call.index, measured);
      }
    }
  }
  return {
    failureByHistory,
    failureFor: (witness) => {
      const categories = new Set<AttemptCategory>();
      for (const at of witness) {
        const category = atWitness(at, failureByHistory, failureBySettlement);
        if (category !== undefined) categories.add(category);
      }
      const [category] = categories;
      return categories.size === 1 ? category : undefined;
    },
    countsFor: (witness) => {
      // One settlement owns a measurement. Two pointers to that row may agree;
      // equal numbers from distinct calls do not describe one measured result.
      let counts: ToolOutputCounts | undefined;
      for (const at of witness) {
        const visibleCounts = atWitness(at, countsByHistory, countsBySettlement);
        if (visibleCounts === undefined || (counts !== undefined && counts !== visibleCounts))
          return undefined;
        counts = visibleCounts;
      }
      return counts;
    },
  };
}

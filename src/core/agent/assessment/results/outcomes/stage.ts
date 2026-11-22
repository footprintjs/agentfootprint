import type { AttemptCategory } from 'footprintjs';
import {
  historyCallResolver,
  readToolSettlements,
  type HistoryCall,
  type RecordedToolSettlement,
} from '../../../recordedCalls.js';
import { witnessRowIndex } from '../../pointer.js';
import type { AssessmentPointer } from '../../types.js';

export interface FailureSettlement {
  readonly index: number;
  readonly fact: Pick<RecordedToolSettlement, 'outcome' | 'failureCategory'>;
}

interface FailureCategoryRead {
  readonly failureByHistory: ReadonlyMap<number, AttemptCategory>;
  readonly failureFor: (witness: readonly AssessmentPointer[]) => AttemptCategory | undefined;
}

/** Read categories only from admitted failures that remain visible at the same occurrence and slot. */
export function failureCategoryReader(
  calls: readonly HistoryCall[],
  settlements: ReadonlyMap<string, FailureSettlement> | undefined,
  readRetained: () => unknown,
): FailureCategoryRead {
  const failureByHistory = new Map<number, AttemptCategory>();
  const failureBySettlement = new Map<number, AttemptCategory>();
  const visible =
    settlements === undefined ? undefined : readToolSettlements(readRetained(), true)?.byKey;
  if (settlements !== undefined && visible !== undefined) {
    const failureByOccurrence = new Map<string, AttemptCategory>();
    for (const [key, { index, fact }] of settlements) {
      const row = visible.get(key);
      if (
        fact.outcome !== 'failed' ||
        fact.failureCategory === undefined ||
        row?.index !== index ||
        row.fact.failureCategory !== fact.failureCategory
      )
        continue;
      failureByOccurrence.set(key, fact.failureCategory);
      failureBySettlement.set(index, fact.failureCategory);
    }
    if (failureByOccurrence.size > 0) {
      const resolve = historyCallResolver(calls);
      for (const [key, category] of failureByOccurrence) {
        const match = resolve(undefined, undefined, key);
        if (match.kind === 'matched') failureByHistory.set(match.call.index, category);
      }
    }
  }
  return {
    failureByHistory,
    failureFor: (witness) => {
      const categories = new Set<AttemptCategory>();
      for (const at of witness) {
        let category: AttemptCategory | undefined;
        if (at.kind === 'history') {
          category = failureByHistory.get(at.index);
        } else if (at.key === 'settledToolCalls') {
          const slot = witnessRowIndex(at.path);
          if (slot !== undefined) category = failureBySettlement.get(slot);
        }
        if (category !== undefined) categories.add(category);
      }
      const [category] = categories;
      return categories.size === 1 ? category : undefined;
    },
  };
}

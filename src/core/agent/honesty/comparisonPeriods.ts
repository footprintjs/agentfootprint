import { readCallOccurrenceKey } from '../../../lib/callOccurrence.js';
import type { DeclaredCoverage } from '../../../semantics/coverage/types.js';
import { readToolSettlements } from '../recordedCalls/settlement.js';

/** Only a positive settlement of this occurrence admits its native period. */
export function returnedNativeOf(settled: unknown, complete: unknown) {
  const settlements = readToolSettlements(settled, complete);
  return (row: object): boolean => {
    const key = readCallOccurrenceKey(row);
    const fact = typeof key === 'string' ? settlements?.byKey.get(key)?.fact : undefined;
    return fact?.execution === 'returned' && fact.delivery === 'native';
  };
}

export function comparisonPeriodAdmission(readSettlement: () => readonly [unknown, unknown]) {
  let native: ReturnType<typeof returnedNativeOf> | undefined;
  return (row: object): boolean => (native ??= returnedNativeOf(...readSettlement()))(row);
}

/** Project public limits. Raw tool observation rows retain their audit meaning. */
export function comparisonCoverageForAnswer(
  declared: readonly DeclaredCoverage[] | undefined,
  ledger: readonly unknown[] | undefined,
  native: (row: DeclaredCoverage) => boolean,
): readonly DeclaredCoverage[] | undefined {
  if (declared === undefined || declared.length === 0 || ledger === undefined) return declared;
  const comparisonKeys = new Set<string>();
  for (const row of ledger) {
    if (row === null || typeof row !== 'object') continue;
    const entry = row as { readonly kind?: unknown; readonly comparison?: unknown };
    const comparison =
      (entry.kind === 'call-window' && entry.comparison !== undefined) ||
      (entry.kind === 'period' && entry.comparison === true);
    if (!comparison) continue;
    const key = readCallOccurrenceKey(entry);
    if (typeof key === 'string') comparisonKeys.add(key);
  }
  if (comparisonKeys.size === 0) return declared;
  return declared.filter((row) => {
    const key = readCallOccurrenceKey(row);
    return typeof key !== 'string' || !comparisonKeys.has(key) || native(row);
  });
}

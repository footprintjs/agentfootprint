import { namedCalls } from '../../../lib/displayName.js';
import { readToolSettlements } from '../recordedCalls.js';
import type { AssessmentPointer, AssessmentReasonSource } from './types.js';

export type EvictedCallOutcomes = Readonly<Record<'refused' | 'failed' | 'settled', number>>;

/** Read outcomes only for settlement rows that the assessment used as witnesses. */
export function evictedCallOutcomes(
  witnesses: readonly AssessmentPointer[] | undefined,
  state: Readonly<Record<string, unknown>> | undefined,
): EvictedCallOutcomes | undefined {
  if (witnesses === undefined || state === undefined) return undefined;
  const indices = new Set<number>();
  for (const witness of witnesses) {
    if (witness.kind !== 'state' || witness.key !== 'settledToolCalls') continue;
    const index = /^\/(0|[1-9]\d*)\/outcome$/.exec(witness.path)?.[1];
    if (index !== undefined) indices.add(Number(index));
  }
  if (indices.size === 0) return undefined;
  const read = (key: string): unknown => Object.getOwnPropertyDescriptor(state, key)?.value;
  const ledger = readToolSettlements(read('settledToolCalls'), read('settledToolCallsComplete'));
  const counts = { refused: 0, failed: 0, settled: 0 };
  for (const { index, fact } of ledger?.byKey.values() ?? []) {
    if (indices.has(index) && fact.outcome !== undefined) counts[fact.outcome]++;
  }
  return counts;
}

/** The committed settlement marker identifies an undispatched sibling. */
export function settledSiblingWitness(witness: AssessmentPointer): boolean {
  return witness.kind === 'history' && witness.path === '/notDispatched/pausedCall/toolCallId';
}

/** Group calls by the outcome the fold recorded. Registered names stay private. */
export function callNotCompletedClause(
  source: AssessmentReasonSource,
  displayNames: ReadonlyMap<string, string>,
  fallback: string,
  settled = 0,
  evicted?: EvictedCallOutcomes,
): string {
  if (source.kind !== 'calls') return fallback;
  let unnamed = source.unnamed ?? 0;
  const clauses = (['refused', 'failed'] as const).flatMap((outcome) => {
    const calls = source.calls.filter((call) => call.outcome === outcome);
    const recorded = evicted?.[outcome] ?? 0;
    const count = calls.length + recorded;
    if (count === 0) return [];
    unnamed -= recorded;
    const who = namedCalls(calls, recorded, (tool) => displayNames.get(tool));
    if (who !== undefined) return [`${who} did not complete (${outcome})`];
    if (outcome === 'failed') return [count === 1 ? 'a call failed' : 'calls failed'];
    return [count === 1 ? 'a call was refused' : 'calls were refused'];
  });
  const evictedSiblings = evicted?.settled ?? 0;
  const siblings = settled + evictedSiblings;
  unnamed -= evictedSiblings;
  if (siblings > 0) clauses.push(siblings === 1 ? 'a call did not run' : 'calls did not run');
  if (clauses.length === 0) return fallback;
  if (unnamed > 0) clauses.push('other calls did not complete');
  return clauses.join(' and ');
}

/** Name only the app's display names, preserving the reported status per group. */
export function unfinishedWorkClause(
  source: AssessmentReasonSource,
  displayNames: ReadonlyMap<string, string>,
  fallback: string,
): string {
  if (source.kind !== 'calls') return fallback;
  let unnamed = source.unnamed ?? 0;
  const clauses = (['partial', 'pending'] as const).flatMap((status) => {
    const calls = source.calls.filter((call) => call.reportedStatus === status);
    if (calls.length === 0) return [];
    const who = namedCalls(calls, 0, (tool) => displayNames.get(tool));
    if (who !== undefined) return [`${who} reported its work as ${status}`];
    unnamed += calls.length;
    return [];
  });
  if (clauses.length === 0) return fallback;
  if (unnamed > 0) clauses.push(fallback);
  return clauses.join(' and ');
}

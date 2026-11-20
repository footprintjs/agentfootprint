import { namedCalls } from '../../../lib/displayName.js';
import type { AssessmentPointer, AssessmentReasonSource } from './types.js';

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
): string {
  if (source.kind !== 'calls') return fallback;
  const clauses = (['refused', 'failed'] as const).flatMap((outcome) => {
    const calls = source.calls.filter((call) => call.outcome === outcome);
    if (calls.length === 0) return [];
    const who = namedCalls(calls, 0, (tool) => displayNames.get(tool));
    if (who !== undefined) return [`${who} did not complete (${outcome})`];
    if (outcome === 'failed') return [calls.length === 1 ? 'a call failed' : 'calls failed'];
    return [calls.length === 1 ? 'a call was refused' : 'calls were refused'];
  });
  if (settled > 0) clauses.push(settled === 1 ? 'a call did not run' : 'calls did not run');
  if (clauses.length === 0) return fallback;
  if (source.unnamed !== undefined) clauses.push('other calls did not complete');
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

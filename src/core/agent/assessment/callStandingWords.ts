import type { DeclaredToolFailureRecord } from '../../../provider-contract/toolResultRecord.js';
import {
  declaredFailureClauses,
  retainedDeclaredFailure,
} from './results/outcomes/declaredFailure.js';
import type { AttemptCategory } from 'footprintjs';
import { namedCalls } from '../../../lib/displayName.js';
import { readToolSettlements } from '../recordedCalls.js';
import type { AssessmentPointer, AssessmentReasonDetail, AssessmentReasonSource } from './types.js';

export type EvictedCallOutcomes = Readonly<Record<'refused' | 'failed' | 'settled', number>> & {
  readonly categories: ReadonlyMap<AttemptCategory, number>;
  readonly declarations?: readonly DeclaredToolFailureRecord[];
};

/** Read outcomes only for settlement rows that the assessment used as witnesses. */
export function evictedCallOutcomes(
  witnesses: readonly AssessmentPointer[] | undefined,
  state: Readonly<Record<string, unknown>> | undefined,
  retainedSettlements?: () => unknown,
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
  const visible =
    retainedSettlements === undefined ? ledger : readToolSettlements(retainedSettlements(), true);
  const categories = new Map<AttemptCategory, number>();
  const declarations: DeclaredToolFailureRecord[] = [];
  const counts = { refused: 0, failed: 0, settled: 0, categories };
  for (const [key, { index, fact }] of ledger?.byKey ?? []) {
    if (!indices.has(index) || fact.outcome === undefined) continue;
    counts[fact.outcome]++;
    const category = fact.failureCategory;
    const served = visible?.byKey.get(key);
    if (fact.outcome === 'failed' && served?.index === index) {
      const declared = retainedDeclaredFailure(fact.declaredFailure, served.fact.declaredFailure);
      if (declared !== undefined) declarations.push(declared);
    }
    if (
      fact.outcome === 'failed' &&
      category !== undefined &&
      served?.index === index &&
      served.fact.failureCategory === category
    ) {
      categories.set(category, (categories.get(category) ?? 0) + 1);
    }
  }
  return declarations.length === 0 ? counts : { ...counts, declarations };
}

/** The committed settlement marker identifies an undispatched sibling. */
export function settledSiblingWitness(witness: AssessmentPointer): boolean {
  return witness.kind === 'history' && witness.path === '/notDispatched/pausedCall/toolCallId';
}

const FAILURE_WORDS = {
  timeout: 'timed out',
  'rate-limited': 'hit a rate limit',
  server: 'failed with a server error',
  network: 'failed with a network error',
  auth: 'failed an access check',
  permanent: 'failed with a non-retryable error',
  unknown: undefined,
} satisfies Readonly<Record<AttemptCategory, string | undefined>>;

type Calls = Extract<AssessmentReasonSource, { kind: 'calls' }>['calls'];

function failedCallClauses(
  calls: Calls,
  displayNames: ReadonlyMap<string, string>,
  evicted: EvictedCallOutcomes | undefined,
): string[] {
  const words = (tool: string) => displayNames.get(tool);
  const declarations = evicted?.declarations ?? [];
  const clauses = declaredFailureClauses(calls, declarations, words);
  let recorded = (evicted?.failed ?? 0) - declarations.length;
  const classifiedCalls = calls.filter((call) => call.declaredFailure === undefined);
  for (const category of Object.keys(FAILURE_WORDS) as AttemptCategory[]) {
    const phrase = FAILURE_WORDS[category];
    if (phrase === undefined) continue;
    const classified = classifiedCalls.filter((call) => call.category === category);
    const count = evicted?.categories.get(category) ?? 0;
    if (classified.length + count === 0) continue;
    recorded -= count;
    const who =
      namedCalls(classified, count, words) ??
      (classified.length + count === 1 ? 'a call' : 'calls');
    clauses.push(`${who} ${phrase}`);
  }
  const unknown = classifiedCalls.filter(
    (call) => call.category === undefined || call.category === 'unknown',
  );
  const count = unknown.length + recorded;
  if (count > 0) {
    const who = namedCalls(unknown, recorded, words);
    clauses.push(
      who === undefined
        ? count === 1
          ? 'a call failed'
          : 'calls failed'
        : `${who} did not complete (failed)`,
    );
  }
  return clauses;
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
    if (outcome === 'failed') return failedCallClauses(calls, displayNames, evicted);
    const who = namedCalls(calls, recorded, (tool) => displayNames.get(tool));
    if (who !== undefined) return [`${who} did not complete (${outcome})`];
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

/** Add the recorded printed-output measurement to its call's warning. */
export function withPrintedOutputCounts(
  clause: string,
  counts: AssessmentReasonDetail['counts'],
): string {
  if (counts === undefined || !('kept' in counts) || counts.unit !== 'characters') return clause;
  const amount = counts.total === undefined ? counts.kept : `${counts.kept} of ${counts.total}`;
  return `${clause} (kept ${amount} printed characters)`;
}

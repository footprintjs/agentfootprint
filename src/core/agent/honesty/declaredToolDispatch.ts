import type { TypedScope } from 'footprintjs';
import {
  declaredFailures,
  type DeclaredDispatch,
  type DeclaredSettlement,
} from 'footprintjs/declared-attempts';
import type { LLMMessage } from '../../../provider-contract/types.js';
import type { DeclaredToolFailureRecord } from '../../../provider-contract/toolResultRecord.js';
import { readCallOccurrenceKey } from '../../../lib/callOccurrence.js';
import { policyInForce, retainedStateValue } from '../../../redaction/runRedaction.js';
import { MAX_RECORDED_ADVICE_CHARS } from '../../../semantics/coverage/items.js';
import {
  recordedDeclaredToolFailure,
  readDeclaredToolFailure,
} from '../recordedCalls/declaredFailure.js';
import type { AgentState } from '../types.js';
import type { MeasuredToolFailure } from '../stages/toolCalls/contracts/callCells.js';

type LiveFailure = Omit<DeclaredSettlement, 'at'> & {
  readonly scope: TypedScope<AgentState>;
  readonly occurrence: string;
};

const dispatches = new WeakMap<DeclaredToolFailureRecord, LiveFailure>();
const scopesWithDeclarations = new WeakSet<TypedScope<AgentState>>();

/** An unavailable attempt slot must leave ordinary dispatch and its result untouched. */
export function beginDeclaredToolDispatch(
  scope: TypedScope<AgentState>,
  target: string,
): DeclaredDispatch | undefined {
  try {
    return declaredFailures(scope).begin(target);
  } catch {
    return undefined;
  }
}

/** Bind only a concrete delivered result to its native dispatch. */
export function admitDeclaredToolFailure(
  scope: TypedScope<AgentState>,
  message: LLMMessage,
  measured: MeasuredToolFailure | undefined,
): LLMMessage {
  if (
    measured?.dispatch === undefined ||
    message.outcome !== 'failed' ||
    message.toolResultExecution !== 'returned' ||
    message.toolResultDisposition !== undefined
  )
    return message;
  const occurrence = readCallOccurrenceKey(message);
  if (typeof occurrence !== 'string') return message;
  const { category, notChecked, tryInstead, dispatch, startedAt, durationMs } = measured;
  const candidate: DeclaredToolFailureRecord = {
    origin: 'declared',
    category,
    notChecked,
    tryInstead,
  };
  const retained = retainedStateValue(scope, 'history', [
    { ...message, toolDeclaredFailure: candidate },
  ]);
  const historyFailure = Array.isArray(retained) ? retained[0]?.toolDeclaredFailure : undefined;
  const admitted = readDeclaredToolFailure(historyFailure);
  if (admitted?.category !== category) return message;
  const policy = policyInForce(scope);
  const adviceIsSelected = (key: 'notChecked' | 'tryInstead') =>
    ['history', 'settledToolCalls'].some((root) =>
      (policy?.fields?.[root] ?? []).some((path) => {
        const parts = path.split('.');
        return (
          parts.every((part) => /^\d+$/.test(part)) ||
          ((parts.includes('toolDeclaredFailure') || parts.includes('declaredFailure')) &&
            !parts.some((part) => part === 'notChecked' || part === 'tryInstead')) ||
          parts.includes(key)
        );
      }),
    );
  const keptAdvice = (key: 'notChecked' | 'tryInstead') => {
    const value = candidate[key];
    // Read the retained text before applying the display cap. A hidden value adds no omission.
    if (typeof value !== 'string' || historyFailure?.[key] !== value || adviceIsSelected(key))
      return undefined;
    return value.length > MAX_RECORDED_ADVICE_CHARS ? { omitted: true as const } : value;
  };
  const checked = keptAdvice('notChecked');
  const next = keptAdvice('tryInstead');
  const declaration: DeclaredToolFailureRecord = Object.freeze({
    origin: 'declared',
    category,
    ...(checked !== undefined && { notChecked: checked }),
    ...(next !== undefined && { tryInstead: next }),
  });
  scopesWithDeclarations.add(scope);
  dispatches.set(declaration, { scope, occurrence, dispatch, category, startedAt, durationMs });
  return { ...message, toolDeclaredFailure: declaration };
}

/** Stage the same history write, with occurrence-local attempt facts when present. */
export function stageDeclaredToolHistory(
  scope: TypedScope<AgentState>,
  history: readonly LLMMessage[],
): void {
  if (!scopesWithDeclarations.has(scope)) {
    scope.history = history;
    return;
  }
  const settlements: DeclaredSettlement[] = [];
  const seen = new Set<DeclaredToolFailureRecord>();
  for (let index = scope.history.length; index < history.length; index++) {
    const message = history[index];
    const declaration = message?.toolDeclaredFailure;
    if (message?.role !== 'tool' || declaration === undefined || seen.has(declaration)) continue;
    const pending = dispatches.get(declaration);
    if (
      pending?.scope !== scope ||
      pending.occurrence !== readCallOccurrenceKey(message) ||
      recordedDeclaredToolFailure(message)?.category !== pending.category
    )
      continue;
    seen.add(declaration);
    const { dispatch, category, startedAt, durationMs } = pending;
    settlements.push({
      dispatch,
      category,
      startedAt,
      durationMs,
      at: [String(index), 'toolDeclaredFailure', 'category'],
    });
  }
  if (settlements.length === 0) {
    scope.history = history;
    return;
  }
  declaredFailures(scope).setValue('history', history, settlements);
  for (const declaration of seen) dispatches.delete(declaration);
  scopesWithDeclarations.delete(scope);
}

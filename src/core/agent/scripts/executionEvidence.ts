import type { TypedScope } from 'footprintjs';
import { readCallOccurrenceKey, type CallOccurrenceKey } from '../../../lib/callOccurrence.js';
import { retainedStateValue } from '../../../redaction/runRedaction.js';
import type { AgentInput, AgentState } from '../types.js';
import { isExitCode } from './label.js';

type SettledReceipt =
  | { readonly status: 'confirmed'; readonly callOccurrenceKey: CallOccurrenceKey }
  | { readonly status: 'none' };

export type CodeExecutionReceipt =
  | (SettledReceipt & { readonly terminal?: true })
  | { readonly status: 'open' | 'unknown' };

export interface CompletedCodeExecutionReceipt {
  readonly originRunId: string;
  readonly receipt: SettledReceipt;
}

function own(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? Object.getOwnPropertyDescriptor(value, key)?.value
    : undefined;
}

function receiptOf(value: unknown): CodeExecutionReceipt | undefined {
  const status = own(value, 'status');
  if (status === 'open' || status === 'unknown' || status === 'none') return { status };
  if (status !== 'confirmed') return undefined;
  const callOccurrenceKey = occurrenceOf(own(value, 'callOccurrenceKey'));
  return callOccurrenceKey === undefined ? undefined : { status, callOccurrenceKey };
}

// Read and detach the indexed words without accepting an imported iterator.
function occurrenceOf(value: unknown): CallOccurrenceKey | undefined {
  if (!Array.isArray(value) || own(value, 'length') !== 5) return undefined;
  const words = [0, 1, 2, 3, 4].map((index) => own(value, String(index)));
  return typeof readCallOccurrenceKey({ callOccurrenceKey: words }) === 'string'
    ? (words as unknown as CallOccurrenceKey)
    : undefined;
}

function completedReceiptOf(value: unknown): CompletedCodeExecutionReceipt | undefined {
  const originRunId = own(value, 'originRunId');
  const receipt = receiptOf(own(value, 'receipt'));
  return typeof originRunId === 'string' &&
    originRunId.length > 0 &&
    originRunId.length <= 256 &&
    (receipt?.status === 'none' || receipt?.status === 'confirmed')
    ? { originRunId, receipt }
    : undefined;
}

/** Bind a continued answer's receipt to the checkpoint that owns it. */
export function admitCompletedCodeExecution(
  value: unknown,
  runId: unknown,
): CompletedCodeExecutionReceipt | undefined {
  try {
    const completed = completedReceiptOf(value);
    return completed?.originRunId === runId ? completed : undefined;
  } catch {
    return undefined;
  }
}

export function completedCodeExecutionFrom(
  state: object,
  runId: string,
): CompletedCodeExecutionReceipt | undefined {
  const raw = own(state, 'codeExecutionReceipt');
  const receipt = own(raw, 'terminal') === true ? receiptOf(raw) : undefined;
  return receipt?.status === 'confirmed' || receipt?.status === 'none'
    ? { originRunId: runId, receipt }
    : undefined;
}

export function seedExecutionEvidence(
  scope: TypedScope<AgentState>,
  observesFullScope: boolean,
  previous?: CompletedCodeExecutionReceipt,
): void {
  if (observesFullScope) scope.codeExecutionReceipt = { status: 'open' };
  if (previous !== undefined) scope.previousCodeExecutionReceipt = previous;
}

/** Once a tool enters, no-execution requires more than an empty runner slot. */
export function noteExecutionEntry(scope: TypedScope<AgentState>): void {
  if (
    'codeExecutionReceipt' in scope &&
    receiptOf(scope.$getValue('codeExecutionReceipt'))?.status === 'open'
  )
    scope.codeExecutionReceipt = { status: 'unknown' };
}

/** Receive only the dispatcher-owned slot's exit, never provider-ID telemetry. */
export function noteExecutionExit(
  scope: TypedScope<AgentState>,
  callOccurrenceKey: CallOccurrenceKey | undefined,
  exitCode: unknown,
): void {
  if (!isExitCode(exitCode)) return;
  const address = occurrenceOf(callOccurrenceKey);
  if (address === undefined) return;
  const original = receiptOf(scope.$getValue('codeExecutionReceipt'));
  if (original?.status === 'confirmed') return;
  scope.codeExecutionReceipt = { status: 'confirmed', callOccurrenceKey: address };
}

/**
 * Seal only receipts this turn can serve. A trusted checkpoint can carry raw
 * work state, so its next turn must reuse this retained terminal proof only.
 */
export function sealExecutionClaimTurn(scope: TypedScope<AgentState>): void {
  if (!('codeExecutionReceipt' in scope)) return;
  const observed = receiptOf(scope.$getValue('codeExecutionReceipt'));
  const terminal =
    observed?.status === 'open'
      ? { status: 'none' as const, terminal: true as const }
      : observed?.status === 'confirmed'
      ? { ...observed, terminal: true as const }
      : undefined;
  if (terminal === undefined) return;
  const retained = retainedStateValue(scope, 'codeExecutionReceipt', terminal);
  if (own(retained, 'terminal') === true && sameReceipt(terminal, receiptOf(retained)))
    scope.codeExecutionReceipt = terminal;
}

type Target = 'current' | 'previous';
type Evidence = 'confirmed' | 'none' | 'unknown';

function sameReceipt(a: CodeExecutionReceipt | undefined, b: CodeExecutionReceipt | undefined) {
  if (a?.status !== b?.status) return false;
  return (
    a?.status !== 'confirmed' ||
    (b?.status === 'confirmed' && readCallOccurrenceKey(a) === readCallOccurrenceKey(b))
  );
}

function retainedCurrent(scope: TypedScope<AgentState>): CodeExecutionReceipt | undefined {
  const raw: unknown = scope.$getValue('codeExecutionReceipt');
  const receipt = receiptOf(raw);
  const retained = receiptOf(retainedStateValue(scope, 'codeExecutionReceipt', raw));
  return sameReceipt(receipt, retained) ? retained : undefined;
}

function retainedPrevious(scope: TypedScope<AgentState>): SettledReceipt | undefined {
  const raw: unknown = scope.$getValue('previousCodeExecutionReceipt');
  const receipt = completedReceiptOf(raw);
  const retained = completedReceiptOf(
    retainedStateValue(scope, 'previousCodeExecutionReceipt', raw),
  );
  return receipt?.originRunId === retained?.originRunId &&
    sameReceipt(receipt?.receipt, retained?.receipt)
    ? retained?.receipt
    : undefined;
}

const PREVIOUS_METHOD =
  /^(?:did you run code(?: or (?:did you )?(?:just )?estimate)?|did you estimate(?: or (?:did you )?run code)?) (?:for|in) (?:your |the )?(?:previous|last) (?:answer|reply)[?!.]?$/iu;
const OTHER_TURN =
  /\b(?:previous|prior|last|earlier|first|second|other|that)\s+(?:answer|reply|turn)\b/iu;

function turnOfQuestion(scope: TypedScope<AgentState>): Target | undefined {
  const message: unknown = scope.$getValue('userMessage');
  if (
    scope.$getArgs<AgentInput>().messageFrom === 'composed' ||
    typeof message !== 'string' ||
    message.length > 8_192 ||
    retainedStateValue(scope, 'userMessage', message) !== message
  )
    return undefined;
  if (PREVIOUS_METHOD.test(message.trim())) return 'previous';
  return OTHER_TURN.test(message) ? undefined : 'current';
}

function evidenceOf(receipt: CodeExecutionReceipt | undefined): Evidence {
  return receipt?.status === 'confirmed' || receipt?.status === 'none' ? receipt.status : 'unknown';
}

export function executionClaimContext(scope: TypedScope<AgentState>): {
  defaultTarget?: Target;
  evidence: Partial<Record<Target, Evidence>>;
  occurrences: Partial<Record<Target, CallOccurrenceKey>>;
} {
  const defaultTarget = turnOfQuestion(scope);
  if (defaultTarget === undefined) return { evidence: {}, occurrences: {} };
  const current = retainedCurrent(scope);
  const previous = retainedPrevious(scope);
  return {
    ...(defaultTarget !== undefined && { defaultTarget }),
    evidence: { current: evidenceOf(current), previous: evidenceOf(previous) },
    occurrences: {
      ...(current?.status === 'confirmed' && { current: current.callOccurrenceKey }),
      ...(previous?.status === 'confirmed' && { previous: previous.callOccurrenceKey }),
    },
  };
}

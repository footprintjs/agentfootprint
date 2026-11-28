/** Named, served inputs to the existing explanation readers. Raw requests and tool bodies stay out. */
import type { AgentfootprintEvent } from '../../../events/registry.js';
import { copyJson, jsonBytes, readOwnList } from '../../../lib/boundedJson.js';
import { readCallOccurrenceKey } from '../../../lib/callOccurrence.js';
import { toolBytesOf } from '../../../lib/toolBytes.js';
import type { AccountHistoryResult, CaptureToolEvidence } from './evidence.js';

type EventEvidence = import('./evidence.js').AccountEventEvidence['event'];

const leaves: Readonly<Partial<Record<string, readonly string[]>>> = Object.freeze({
  'agentfootprint.agent.run_configured': ['window', 'skillGraph', 'llm', 'evidenceGate'],
  'agentfootprint.agent.turn_start': ['userPrompt', 'turnIndex'],
  'agentfootprint.agent.turn_end': [
    'finalContent',
    'turnIndex',
    'iterationCount',
    'replyAuthor',
    'answerAssessment',
    'answerCoverage',
    'standingLineNames',
    'standingLineOmittedByRaiseOn',
    'llm',
    'status',
    'scripts',
  ],
  'agentfootprint.agent.evidence_checked': ['evidenceGate', 'unsupported', 'evidenceTruncated'],
  'agentfootprint.context.slot_composed': ['slot', 'iteration', 'sourceBreakdown'],
  'agentfootprint.context.injected': [
    'slot',
    'source',
    'sourceId',
    'callOccurrenceKey',
    'position',
    'contentHash',
  ],
  'agentfootprint.stream.llm_start': ['iteration'],
  'agentfootprint.stream.tool_start': ['toolCallId', 'toolName', 'iteration', 'callOccurrenceKey'],
  'agentfootprint.stream.tool_end': [
    'toolCallId',
    'toolName',
    'iteration',
    'callOccurrenceKey',
    'status',
    'error',
    'entered',
    'notExecuted',
    'notDispatched',
    'pausedCall',
  ],
  'agentfootprint.pause.resume': [],
});

const MAX_HISTORY_ENTRIES = 4_096;

const stateKeys = ['turnNumber', 'userMessage', 'history', 'findingsLedger'] as const;
const toolStateKeys = [
  ...stateKeys,
  'enteredToolCalls',
  'enteredToolCallsComplete',
  'settledToolCalls',
  'settledToolCallsComplete',
  'middlewareDecisions',
  'coverageDeclared',
  'placedTickets',
  'stoppedEarly',
  'libraryResultLimits',
  'libraryResultLimitsIncomplete',
  'sourceConsultation',
  'answerValidation',
  'answerCitations',
  'integrityFindingRows',
  'unsupportedValues',
  'llmLatestContent',
  'llmLatestStopReason',
] as const;
const toolMessageKeys = [
  'role',
  'toolCallId',
  'toolName',
  'callOccurrenceKey',
  'toolChars',
  'toolResultOrigin',
  'toolResultExecution',
  'toolResultDisposition',
  'outcome',
  'reportedStatus',
  'notDispatched',
] as const;

export function ownValue(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? Object.getOwnPropertyDescriptor(value, key)?.value
    : undefined;
}

function pick(value: unknown, names: readonly string[]): Record<string, unknown> {
  const fields: [string, unknown][] = [];
  for (const name of names) {
    const field = ownValue(value, name);
    if (field !== undefined) fields.push([name, field]);
  }
  return Object.fromEntries(fields);
}

/** No user data or result is inferred from a projected event. */
export function projectEvent(event: AgentfootprintEvent, budget: number): EventEvidence {
  const fields = Object.hasOwn(leaves, event.type) ? leaves[event.type] : undefined;
  return copyJson(
    {
      type: event.type,
      meta: pick(event.meta, ['runId', 'sessionId', 'runtimeStageId', 'sourcePosition']),
      payload: pick(event.payload, fields ?? []),
    },
    budget,
    true,
  ) as EventEvidence;
}

export function projectState(
  snapshot: unknown,
  budget: number,
  capture: CaptureToolEvidence | undefined,
):
  | {
      readonly kind: 'ready';
      readonly state: Readonly<Record<string, unknown>>;
      readonly historyResults?: readonly AccountHistoryResult[];
    }
  | { readonly kind: 'budget' | 'tool-results' | 'tool-result-key-limit' } {
  const shared = ownValue(snapshot, 'sharedState');
  const state = pick(shared, capture === undefined ? stateKeys : toolStateKeys);
  if (capture === undefined)
    return { kind: 'ready', state: copyJson(state, budget, true) as typeof state };
  const list = readOwnList(state.history, MAX_HISTORY_ENTRIES);
  if (list === undefined) return { kind: 'tool-results' };
  if (list.unread > 0) return { kind: 'budget' };

  let remaining = budget;
  const historyResults: AccountHistoryResult[] = [];
  const history = [...list.entries];
  for (let index = 0; index < history.length; index++) {
    const message = history[index];
    if (ownValue(message, 'role') !== 'tool') continue;
    if (
      message === null ||
      typeof message !== 'object' ||
      typeof readCallOccurrenceKey(message) !== 'string' ||
      ownValue(message, 'toolResultDisposition') === 'rewritten'
    )
      return { kind: 'tool-results' };
    const result = capture.captureHistory(
      toolBytesOf({
        content: ownValue(message, 'content'),
        toolChars: ownValue(message, 'toolChars'),
      }),
    );
    if (result.kind !== 'ready') return result;
    const row = copyJson({ index, shape: result.shape }, remaining, true) as AccountHistoryResult;
    remaining -= 1 + jsonBytes(row);
    if (remaining <= 0) return { kind: 'budget' };
    historyResults.push(row);
    history[index] = pick(message, toolMessageKeys);
  }
  state.history = history;
  return {
    kind: 'ready',
    state: copyJson(state, remaining, true) as typeof state,
    ...(historyResults.length > 0 && { historyResults: Object.freeze(historyResults) }),
  };
}

/** Until their fact inputs are projected, these events prevent a complete account. */
export function requiresMoreEvidence(type: string): boolean {
  return (
    type.startsWith('agentfootprint.skill.') ||
    type.startsWith('agentfootprint.middleware.') ||
    type.startsWith('agentfootprint.findings.') ||
    type.startsWith('agentfootprint.permission.') ||
    type.startsWith('agentfootprint.checkin.') ||
    type.startsWith('agentfootprint.artifacts.') ||
    (type.startsWith('agentfootprint.tools.') && type !== 'agentfootprint.tools.offered') ||
    type === 'agentfootprint.validation.args_invalid'
  );
}

/** Tool messages carry raw result bodies, even if no tool event reached this recording. */
export function containsToolHistory(snapshot: unknown): boolean {
  const state = ownValue(snapshot, 'sharedState');
  const history = ownValue(state, 'history');
  return (
    Array.isArray(history) &&
    history.some(
      (entry) => ownValue(entry, 'role') === 'tool' || ownValue(entry, 'toolCalls') !== undefined,
    )
  );
}

/** Named, served inputs to the existing explanation readers. Raw requests and tool bodies stay out. */
import type { AgentfootprintEvent } from '../../../events/registry.js';
import { copyJson, jsonBytes, readOwnList } from '../../../lib/boundedJson.js';
import { readCallOccurrenceKey } from '../../../lib/callOccurrence.js';
import { toolBytesOf } from '../../../lib/toolBytes.js';
import type {
  AccountEventEvidence,
  AccountHistoryResult,
  CaptureToolEvidence,
} from './evidence.js';
import { isInitialRoutingEvent, projectInitialRouting } from './routingEvidence.js';

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
    'asRole',
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
const MAX_FINDINGS_ROWS = 4_096;
const MAX_PROPOSALS = 1_000;

const stateKeys = ['turnNumber', 'userMessage', 'history', 'findingsLedger'] as const;
const toolStateKeys = [
  ...stateKeys,
  'enteredToolCalls',
  'enteredToolCallsComplete',
  'settledToolCalls',
  'settledToolCallsComplete',
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

/** Keep the proposal and its argument shape without the duplicate raw
 * declaration. The original event provides the independently admitted fact. */
function withoutFindingsArgument(call: unknown): unknown {
  const args = ownValue(call, 'args');
  if (typeof args !== 'object' || args === null || !Object.hasOwn(args, '_findings')) return call;
  const fields = Object.getOwnPropertyDescriptors(args);
  delete fields._findings;
  const proposal = Object.getOwnPropertyDescriptors(call as object);
  proposal.args = { ...proposal.args, value: Object.create(Object.getPrototypeOf(args), fields) };
  return Object.create(Object.getPrototypeOf(call), proposal);
}

/** No user data or result is inferred from a projected event. */
export function projectEvent(
  event: AgentfootprintEvent,
  budget: number,
  admittedPayload?: Readonly<Record<string, unknown>>,
  captureToolIteration = false,
): EventEvidence {
  const fields =
    captureToolIteration && event.type === 'agentfootprint.agent.iteration_end'
      ? ['iterIndex']
      : Object.hasOwn(leaves, event.type)
      ? leaves[event.type]
      : undefined;
  return copyJson(
    {
      type: event.type,
      meta: pick(event.meta, ['runId', 'sessionId', 'runtimeStageId', 'sourcePosition']),
      payload:
        admittedPayload ??
        projectInitialRouting(event.type, event.payload) ??
        pick(event.payload, fields ?? []),
    },
    budget,
    true,
  ) as EventEvidence;
}

export function projectState(
  snapshot: unknown,
  budget: number,
  capture: CaptureToolEvidence | undefined,
  events: readonly AccountEventEvidence[],
  comparison: string | undefined,
  hasLinkedExpectation: boolean,
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
  if (hasLinkedExpectation && Object.hasOwn(state, 'findingsLedger')) {
    const ledger = readOwnList(state.findingsLedger, MAX_FINDINGS_ROWS);
    if (ledger === undefined || ledger.unread > 0) return { kind: 'budget' };
    // The declaration is the only source of this fact. Its committed basis
    // row can also contain free text. Keep other rows at their original indices.
    state.findingsLedger = ledger.entries.map((row) =>
      ownValue(row, 'kind') === 'basis' ? null : row,
    );
  }
  const list = readOwnList(state.history, MAX_HISTORY_ENTRIES);
  if (list === undefined) return { kind: 'tool-results' };
  if (list.unread > 0) return { kind: 'budget' };

  const rewrite = capture.linkRewrite(events, snapshot, list.entries, comparison, budget);
  if (rewrite.kind === 'unproven') return { kind: 'tool-results' };
  if (rewrite.kind === 'linked') {
    // Earlier slots are not needed by the final-winner reducer. Keep their
    // positions without retaining their contents or relocating the pointer.
    state.middlewareDecisions = [...Array<null>(rewrite.ledgerIndex).fill(null), rewrite.decision];
  }

  let remaining = budget;
  const historyResults: AccountHistoryResult[] = [];
  const history = [...list.entries];
  for (let index = 0; index < history.length; index++) {
    const message = history[index];
    const role = ownValue(message, 'role');
    if (
      hasLinkedExpectation &&
      role === 'assistant' &&
      ownValue(message, 'toolCalls') !== undefined
    ) {
      const proposals = readOwnList(ownValue(message, 'toolCalls'), MAX_PROPOSALS);
      if (proposals === undefined || proposals.unread > 0) return { kind: 'budget' };
      const fields = Object.getOwnPropertyDescriptors(message as object);
      fields.toolCalls = {
        ...fields.toolCalls,
        value: proposals.entries.map(withoutFindingsArgument),
      };
      history[index] = Object.create(Object.getPrototypeOf(message), fields);
    }
    if (role !== 'tool') continue;
    if (
      message === null ||
      typeof message !== 'object' ||
      typeof readCallOccurrenceKey(message) !== 'string' ||
      (ownValue(message, 'toolResultDisposition') === 'rewritten' &&
        !(rewrite.kind === 'linked' && rewrite.historyIndex === index))
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
    (type.startsWith('agentfootprint.skill.') && !isInitialRoutingEvent(type)) ||
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

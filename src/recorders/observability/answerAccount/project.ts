/** Named, served inputs to the existing explanation readers. Raw requests and tool bodies stay out. */
import type { AgentfootprintEvent } from '../../../events/registry.js';
import { copyJson } from '../../../lib/boundedJson.js';

type EventEvidence = import('./evidence.js').AccountEventEvidence['event'];

const leaves: Readonly<Partial<Record<string, readonly string[]>>> = Object.freeze({
  'agentfootprint.agent.run_configured': ['window', 'skillGraph', 'llm', 'evidenceGate'],
  'agentfootprint.agent.turn_start': ['userPrompt'],
  'agentfootprint.agent.turn_end': [
    'finalContent',
    'iteration',
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
    'entered',
    'notExecuted',
    'notDispatched',
    'pausedCall',
  ],
  'agentfootprint.pause.resume': [],
});

const stateKeys = ['turnNumber', 'userMessage', 'history', 'findingsLedger'] as const;

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

export function projectState(snapshot: unknown, budget: number): Readonly<Record<string, unknown>> {
  return copyJson(pick(ownValue(snapshot, 'sharedState'), stateKeys), budget, true) as Record<
    string,
    unknown
  >;
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
    type.startsWith('agentfootprint.tools.')
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

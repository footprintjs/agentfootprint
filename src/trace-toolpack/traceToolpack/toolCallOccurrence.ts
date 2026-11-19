import {
  historyCallResolver,
  historyProposalForOccurrence,
  readCallOccurrences,
  readHistoryCalls,
  type HistoryCall,
} from '../../core/agent/recordedCalls.js';
import type { AgentfootprintEvent } from '../../events/registry.js';
import { readCallOccurrenceKey } from '../../lib/callOccurrence.js';

type Start = Extract<AgentfootprintEvent, { type: 'agentfootprint.stream.tool_start' }>;
export type ToolEndEvent = Extract<AgentfootprintEvent, { type: 'agentfootprint.stream.tool_end' }>;
type Decision = Extract<
  AgentfootprintEvent,
  {
    type:
      | 'agentfootprint.middleware.decision'
      | 'agentfootprint.permission.check'
      | 'agentfootprint.checkin.request'
      | 'agentfootprint.checkin.decision'
      | 'agentfootprint.validation.args_invalid';
  }
>;

export type ToolBracketEvent = Start | ToolEndEvent;

/** One committed middleware decision. */
export interface LedgerRow {
  readonly middleware?: string;
  readonly moment?: string;
  readonly toolCallId?: string;
  readonly iteration?: number;
  readonly outcome?: string;
  readonly phase?: string;
  readonly personApproved?: boolean;
  readonly changed?: boolean;
  readonly why?: string;
  readonly after?: unknown;
}

export interface HistoryTurn {
  readonly role?: string;
  readonly content?: unknown;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly toolCalls?: readonly {
    readonly id?: string;
    readonly name?: string;
    readonly args?: Record<string, unknown>;
  }[];
  readonly notDispatched?: unknown;
}

function isBracket(event: AgentfootprintEvent | undefined): event is ToolBracketEvent {
  return (
    event?.type === 'agentfootprint.stream.tool_start' ||
    event?.type === 'agentfootprint.stream.tool_end'
  );
}

function lastHistoryKey(history: readonly HistoryTurn[], id: string): string | null | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i];
    if (turn?.role === 'tool' && turn.toolCallId === id) return readCallOccurrenceKey(turn);
    const calls = turn?.toolCalls ?? [];
    for (let j = calls.length - 1; j >= 0; j--) {
      const call = calls[j];
      if (call?.id === id) return readCallOccurrenceKey(call);
    }
  }
  return undefined;
}

interface KeyedCall {
  readonly key: string | null;
  readonly bracket?: ToolBracketEvent;
  readonly start?: Start;
  readonly end?: ToolEndEvent;
  readonly history?: HistoryCall;
  readonly proposal?: HistoryCall['proposal'];
  readonly resultStatus: 'matched' | 'missing' | 'ambiguous';
  readonly evidence: readonly Decision[];
}

function isDecision(event: AgentfootprintEvent): event is Decision {
  return (
    event.type === 'agentfootprint.middleware.decision' ||
    (event.type === 'agentfootprint.permission.check' && event.payload?.phase === 'resume') ||
    event.type === 'agentfootprint.checkin.request' ||
    event.type === 'agentfootprint.checkin.decision' ||
    event.type === 'agentfootprint.validation.args_invalid'
  );
}

/** The public question still names the latest provider ID. The selected
 * observation's key, when present, then owns all further evidence reads. */
export function latestKeyedToolCall(
  events: readonly AgentfootprintEvent[],
  history: readonly HistoryTurn[],
  toolCallId: string,
): KeyedCall | undefined {
  let selected: ToolBracketEvent | undefined;
  let selectedAt = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (!isBracket(event) || event.payload?.toolCallId !== toolCallId) continue;
    selected = event;
    selectedAt = i;
    break;
  }
  const selectedKey = selected === undefined ? undefined : readCallOccurrenceKey(selected.payload);
  const key = selectedKey === undefined ? lastHistoryKey(history, toolCallId) : selectedKey;
  if (key === undefined) return undefined;

  const occurrence =
    selectedKey === undefined
      ? undefined
      : readCallOccurrences(
          events.map((event, index) => ({
            event,
            index,
            type: event.type,
            payload: (event.payload ?? {}) as unknown as Readonly<Record<string, unknown>>,
            meta: (event.meta ?? {}) as unknown as Readonly<Record<string, unknown>>,
          })),
          [],
        ).find((call) => call.start?.index === selectedAt || call.end?.index === selectedAt);
  if (key === null || (selectedKey !== undefined && occurrence?.occurrenceKey !== key)) {
    return { key: null, resultStatus: 'ambiguous', evidence: [] };
  }

  const start = occurrence?.start?.event;
  const end = occurrence?.end?.event;
  const result = historyCallResolver(readHistoryCalls(history))(undefined, undefined, key);
  const retained = result.kind === 'matched' ? result.call : undefined;
  const proposal =
    result.kind === 'missing' ? historyProposalForOccurrence(history, key) : retained?.proposal;
  const evidence = [
    'middleware.decision',
    'permission.check',
    'checkin.request',
    'checkin.decision',
    'validation.args_invalid',
  ]
    .flatMap((type) => occurrence?.eventsOf(type) ?? [])
    .sort((a, b) => a.index - b.index)
    .map(({ event }) => event)
    .filter(isDecision);
  return {
    key,
    ...(selectedKey !== undefined && selected !== undefined && { bracket: selected }),
    ...(start?.type === 'agentfootprint.stream.tool_start' && { start }),
    ...(end?.type === 'agentfootprint.stream.tool_end' && { end }),
    ...(retained !== undefined && { history: retained }),
    ...(proposal !== undefined && { proposal }),
    resultStatus: result.kind,
    evidence,
  };
}

function onSameStep(left: AgentfootprintEvent, right: AgentfootprintEvent): boolean {
  const a = left.meta;
  const b = right.meta;
  return (
    typeof a?.runtimeStageId === 'string' &&
    a.runtimeStageId === b?.runtimeStageId &&
    a.runId === b.runId &&
    a.sourcePosition?.logRunId === b.sourcePosition?.logRunId
  );
}

/**
 * Pair the latest bracket with its own opening event and the evidence in
 * between. An approval can resume on a different step, so requiring the
 * start and end to share a step would discard its decision. If the tail
 * lost the start, only evidence on the end's own step can speak for it.
 */
export function latestCallOccurrence(events: readonly AgentfootprintEvent[], toolCallId: string) {
  let bracket: ToolBracketEvent | undefined;
  let start: Start | undefined;
  let endAt = events.length;
  let startAt = -1;
  let previousEndAt = -1;
  let overlapping = false;
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (!isBracket(event) || event.payload?.toolCallId !== toolCallId) {
      continue;
    }
    if (bracket === undefined) {
      bracket = event;
      if (event.type === 'agentfootprint.stream.tool_end') {
        endAt = i;
        continue;
      }
    }
    if (event.type === 'agentfootprint.stream.tool_end') {
      previousEndAt = i;
      break;
    }
    if (start !== undefined) {
      overlapping = true;
      break;
    }
    start = event;
    startAt = i;
  }
  const end = bracket?.type === 'agentfootprint.stream.tool_end' ? bracket : undefined;
  const evidence: Decision[] = [];
  const iterations = new Set<number>();
  if (bracket !== undefined && !overlapping) {
    for (let i = Math.max(startAt, previousEndAt) + 1; i < events.length; i++) {
      const event = events[i];
      if (event.type === 'agentfootprint.agent.iteration_end' && onSameStep(event, bracket)) {
        if (typeof event.payload?.iterIndex === 'number') iterations.add(event.payload.iterIndex);
      }
      if (i >= endAt || (start === undefined && !onSameStep(event, bracket))) continue;
      if (isDecision(event) && event.payload?.toolCallId === toolCallId) {
        evidence.push(event);
        if (typeof event.payload.iteration === 'number') iterations.add(event.payload.iteration);
      }
    }
  }
  // Ledger rows carry the iteration, but no bracket offset or runtime step.
  // Conflicting or missing iteration evidence cannot identify a row.
  const iteration = iterations.size === 1 ? [...iterations][0] : undefined;
  return {
    bracket,
    start: overlapping ? undefined : start,
    end,
    evidence: iterations.size <= 1 ? evidence : [],
    iteration,
    reused: previousEndAt !== -1 || overlapping,
  };
}

/** A resume refusal names the actor. A recorded approval must precede it. */
export function resumeRefusalOf(
  evidence: readonly Decision[],
  ledger: readonly LedgerRow[],
): string | undefined {
  let approved = false;
  const refusal = (who: string) =>
    approved
      ? `a person approved the call. ${who} then refused the call after the wait.`
      : `${who} refused the call after the wait.`;
  const middlewareRefusal = (row: LedgerRow) => {
    if (row.phase !== 'resume') {
      if (row.outcome === 'allow' && row.personApproved === true) approved = true;
      if (row.outcome === 'deny' && row.personApproved === false) approved = false;
    }
    if (row.phase !== 'resume' || row.moment !== 'before-tool') return undefined;
    if (row.outcome === 'refused') return refusal('The library');
    if (row.outcome === 'deny')
      return refusal(
        row.middleware === undefined ? 'A middleware rule' : `Middleware '${row.middleware}'`,
      );
    return undefined;
  };
  for (const event of evidence) {
    if (event.type === 'agentfootprint.checkin.decision')
      approved = event.payload.approved === true;
    if (event.type === 'agentfootprint.permission.check') {
      if (event.payload.result === 'deny' || event.payload.result === 'halt')
        return refusal('The permission policy');
    }
    if (event.type === 'agentfootprint.middleware.decision') {
      const line = middlewareRefusal(event.payload);
      if (line !== undefined) return line;
    }
  }
  for (const row of ledger) {
    const line = middlewareRefusal(row);
    if (line !== undefined) return line;
  }
  return undefined;
}

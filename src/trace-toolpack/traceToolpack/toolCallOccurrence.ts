import type { AgentfootprintEvent } from '../../events/registry.js';

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
    if (
      (event.type !== 'agentfootprint.stream.tool_start' &&
        event.type !== 'agentfootprint.stream.tool_end') ||
      event.payload?.toolCallId !== toolCallId
    ) {
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
      if (
        (event.type === 'agentfootprint.middleware.decision' ||
          (event.type === 'agentfootprint.permission.check' && event.payload?.phase === 'resume') ||
          event.type === 'agentfootprint.checkin.request' ||
          event.type === 'agentfootprint.checkin.decision' ||
          event.type === 'agentfootprint.validation.args_invalid') &&
        event.payload?.toolCallId === toolCallId
      ) {
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

/**
 * StatusRecorder — Claude Code-style live status line for Agent runs.
 *
 * Pattern: Facade over EventDispatcher's wildcard subscription.
 * Role:    Tier 3 observability — the low-level helper behind
 *          `attachStatus(dispatcher, { onStatus })` (exported from
 *          `agentfootprint/observe`). For the high-level, uniform path use
 *          `agent.enable.liveStatus({ strategy: chatBubbleLiveStatus({ onLine }) })`.
 *          One callback receives a human-readable status string at every
 *          meaningful moment.
 * Emits:   Does NOT emit; READS core events via the dispatcher and calls
 *          `onStatus`.
 */

import type { EventDispatcher, Unsubscribe } from '../../events/dispatcher.js';
import type {
  AgentfootprintEvent,
  AgentfootprintEventMap,
  AgentfootprintEventType,
} from '../../events/registry.js';
import { progressMessageOf } from './status/statusTemplates.js';

export interface StatusOptions {
  /**
   * Called with a human-readable status string at each meaningful moment
   * (iteration start, tool start/end, route decision, turn end).
   */
  readonly onStatus: (status: string) => void;
  /**
   * Custom formatter. Return `null` to skip an event; return a string
   * to emit that status. Omit for the built-in renderer.
   */
  readonly format?: (event: StatusEvent) => string | null;
}

/**
 * Subset of events the thinking renderer formats. Discriminated on `type`.
 */
export type StatusEvent =
  | AgentfootprintEventMap['agentfootprint.agent.turn_start']
  | AgentfootprintEventMap['agentfootprint.agent.turn_end']
  | AgentfootprintEventMap['agentfootprint.agent.iteration_start']
  | AgentfootprintEventMap['agentfootprint.agent.route_decided']
  | AgentfootprintEventMap['agentfootprint.stream.tool_start']
  | AgentfootprintEventMap['agentfootprint.stream.tool_progress']
  | AgentfootprintEventMap['agentfootprint.stream.tool_end'];

const RELEVANT: ReadonlySet<AgentfootprintEventType> = new Set<AgentfootprintEventType>([
  'agentfootprint.agent.turn_start',
  'agentfootprint.agent.turn_end',
  'agentfootprint.agent.iteration_start',
  'agentfootprint.agent.route_decided',
  'agentfootprint.stream.tool_start',
  'agentfootprint.stream.tool_progress',
  'agentfootprint.stream.tool_end',
]);

/**
 * Attach a thinking-status subscription to the event dispatcher.
 * Returns an Unsubscribe — call to detach.
 *
 * Holds one small piece of state: how many mid-call reports each in-flight
 * tool call has filed (9.54.0), so the generic progress line can say "3 so
 * far" instead of repeating one indistinguishable sentence. The tally is
 * per-`toolCallId` — parallel calls count separately — and is dropped when
 * that call ends, so nothing accumulates across a long-lived run.
 */
export function attachStatus(dispatcher: EventDispatcher, options: StatusOptions): Unsubscribe {
  const progressCounts = new Map<string, number>();
  const format = options.format ?? ((e: StatusEvent) => defaultFormatter(e, progressCounts));
  return dispatcher.on('*', (event: AgentfootprintEvent) => {
    if (!RELEVANT.has(event.type)) return;
    if (event.type === 'agentfootprint.stream.tool_progress') {
      const id = event.payload.toolCallId;
      progressCounts.set(id, (progressCounts.get(id) ?? 0) + 1);
    }
    const status = format(event as StatusEvent);
    if (event.type === 'agentfootprint.stream.tool_end') {
      progressCounts.delete(event.payload.toolCallId);
    }
    if (status !== null) options.onStatus(status);
  });
}

/**
 * Default renderer. Humanizes each supported event into a short status line.
 *
 * `tool_progress` keeps the same display contract the projection keeps
 * (`progressMessageOf`): a top-level string `message` is shown verbatim,
 * length-capped; anything else gets the tool's name, the fact that it
 * reported, and the count. The author's payload is never dumped into prose.
 */
function defaultFormatter(
  event: StatusEvent,
  progressCounts?: ReadonlyMap<string, number>,
): string | null {
  switch (event.type) {
    case 'agentfootprint.agent.turn_start':
      return 'Thinking...';
    case 'agentfootprint.agent.iteration_start':
      return `Iteration ${event.payload.iterIndex}`;
    case 'agentfootprint.stream.tool_start':
      return `Calling ${event.payload.toolName}(…)`;
    case 'agentfootprint.stream.tool_progress': {
      const message = progressMessageOf(event.payload.payload);
      if (message !== null) return message;
      const n = progressCounts?.get(event.payload.toolCallId) ?? 1;
      return `${event.payload.toolName} reported progress (${String(n)} so far)`;
    }
    case 'agentfootprint.stream.tool_end':
      return event.payload.error
        ? `Tool ${event.payload.toolCallId} failed`
        : `Got result from ${event.payload.toolCallId}`;
    case 'agentfootprint.agent.route_decided':
      return event.payload.chosen === 'final'
        ? 'Composing answer...'
        : 'Continuing with tool calls...';
    case 'agentfootprint.agent.turn_end':
      return 'Done';
    default:
      return null;
  }
}

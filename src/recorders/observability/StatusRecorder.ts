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
  | AgentfootprintEventMap['agentfootprint.stream.tool_end'];

const RELEVANT: ReadonlySet<AgentfootprintEventType> = new Set<AgentfootprintEventType>([
  'agentfootprint.agent.turn_start',
  'agentfootprint.agent.turn_end',
  'agentfootprint.agent.iteration_start',
  'agentfootprint.agent.route_decided',
  'agentfootprint.stream.tool_start',
  'agentfootprint.stream.tool_end',
]);

/**
 * Attach a thinking-status subscription to the event dispatcher.
 * Returns an Unsubscribe — call to detach.
 */
export function attachStatus(dispatcher: EventDispatcher, options: StatusOptions): Unsubscribe {
  const format = options.format ?? defaultFormatter;
  return dispatcher.on('*', (event: AgentfootprintEvent) => {
    if (!RELEVANT.has(event.type)) return;
    const status = format(event as StatusEvent);
    if (status !== null) options.onStatus(status);
  });
}

/**
 * Default renderer. Humanizes each supported event into a short status line.
 */
function defaultFormatter(event: StatusEvent): string | null {
  switch (event.type) {
    case 'agentfootprint.agent.turn_start':
      return 'Thinking...';
    case 'agentfootprint.agent.iteration_start':
      return `Iteration ${event.payload.iterIndex}`;
    case 'agentfootprint.stream.tool_start':
      return `Calling ${event.payload.toolName}(…)`;
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

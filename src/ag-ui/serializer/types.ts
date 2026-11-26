import type { AgentfootprintEvent } from '../../events/registry.js';
import type { RunTranslation } from '../../hosting/protocolAdapter.js';
import type { AgUiEvent, AgUiSuspension } from '../types.js';
import type { AgUiCustomProjection } from '../customEvents.js';

/** Options for {@link agUiSerializer}. */
export interface AgUiSerializerOptions {
  /** Explicit host delivery: withhold candidate text at every depth until the authorized final output. Record-only is the default. */
  readonly delivery?: 'host';
  /** Optional served-only projection for calls without a protected argument view. */
  readonly toolArguments?: AgUiCustomProjection;
  /** Optional served-only result projection; fixed failed-tool words still take precedence. */
  readonly toolResults?: AgUiCustomProjection;
  /** The conversation this run belongs to — `RunAgentInput.threadId`. */
  readonly threadId: string;
  /** This run's AG-UI id — `RunAgentInput.runId`. Every id the run mints is under it. */
  readonly runId: string;
  /**
   * The events with no AG-UI equivalent that go out as `CUSTOM`, keyed by event
   * type, each with the projection that picks its fields. Default
   * {@link AG_UI_CUSTOM_EVENTS}; `{}` sends none. An event not listed sends
   * nothing. Events the mapping consumes (tokens, tool calls, turns,
   * iterations, compositions, the pause and the fatal error) are never CUSTOM.
   */
  readonly custom?: Readonly<Record<string, AgUiCustomProjection>>;
  /**
   * Write the model's reasoning — `REASONING_*` events from the served
   * `stream.thinking_*` events. Default `false`: a model's chain of thought is
   * shown to a person only when the app decides it is.
   */
  readonly reasoning?: boolean;
  /**
   * What a FAILED tool call's result says. Default `'withheld'`: fixed words
   * (`toolResultWords.ts`) — "The tool failed.", or "The call was not executed."
   * for a call that never reached its tool (an unknown name, rejected
   * arguments) — as the record's result for a failed call is the thrown text,
   * which may hold a connection string, a path or a provider's response.
   * `'served'` sends the record's own result (still the served value: the
   * placeholder wherever a redaction policy selected one).
   */
  readonly toolErrors?: 'withheld' | 'served';
  /**
   * Which served events are this run's. Default: the events of the first run
   * an event names (plus events that name no run). Pass it when the listener
   * can hear more than one run — an instance several callers share — so the
   * translation never binds to whichever run spoke first.
   */
  readonly owns?: (event: AgentfootprintEvent) => boolean;
  /**
   * The paused run this one continues — what that run's translation returned
   * from `suspension()` after it settled `'paused'`. Its suspended sub-agents
   * and open steps re-open under the same ids, and the call it stopped in is
   * answered under its own id (or, for a frontend tool, not at all: the client
   * already holds the result it sent).
   */
  readonly resume?: AgUiSuspension;
}

/** One run's AG-UI translation — and, once it pauses, what its continuation needs. */
export interface AgUiTranslation extends RunTranslation<AgUiEvent> {
  /**
   * The record to `resume` from. Before settling, what a `'paused'` settlement
   * with the same `awaiting` will hand out (keep it first, then settle); after
   * `settle({ kind: 'paused' })`, what it handed out; after any other ending,
   * `undefined`.
   */
  suspension(awaiting?: 'person' | 'caller'): AgUiSuspension | undefined;
}

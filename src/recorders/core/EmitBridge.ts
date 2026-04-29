/**
 * EmitBridge — forwards footprintjs emits whose name starts with a given
 * prefix to the EventDispatcher, enriched with EventMeta.
 *
 * Pattern: Adapter (GoF) + Pipes & Filters (Hohpe & Woolf, 2003).
 * Role:    Single reusable translation layer for every "pass-through"
 *          prefix recorder (StreamRecorder, AgentRecorder, and any
 *          future domain whose events are emitted via typedEmit()).
 * Emits:   Any event whose name matches `prefix` — type derived from the
 *          emit name and validated by the consumer's EventMap subscription.
 */

import type { CombinedRecorder, EmitEvent } from 'footprintjs';
import type { EventDispatcher } from '../../events/dispatcher.js';
import type { AgentfootprintEventMap, AgentfootprintEventType } from '../../events/registry.js';
import { buildEventMeta, type RunContext } from '../../bridge/eventMeta.js';

export interface EmitBridgeOptions {
  readonly dispatcher: EventDispatcher;
  /** Recorder id — must be unique among attached recorders. */
  readonly id: string;
  /** Event-name prefix this bridge forwards (e.g. 'agentfootprint.stream.'). */
  readonly prefix: string;
  readonly getRunContext: () => RunContext;
}

export class EmitBridge implements CombinedRecorder {
  readonly id: string;
  private readonly dispatcher: EventDispatcher;
  private readonly prefix: string;
  private readonly getRunContext: () => RunContext;

  constructor(options: EmitBridgeOptions) {
    this.dispatcher = options.dispatcher;
    this.id = options.id;
    this.prefix = options.prefix;
    this.getRunContext = options.getRunContext;
  }

  onEmit(event: EmitEvent): void {
    if (typeof event.name !== 'string') return;
    if (!event.name.startsWith(this.prefix)) return;
    const type = event.name as AgentfootprintEventType;
    if (!this.dispatcher.hasListenersFor(type)) return;

    const payload = event.payload as AgentfootprintEventMap[AgentfootprintEventType]['payload'];
    const meta = buildEventMeta(
      { runtimeStageId: event.runtimeStageId, subflowPath: event.subflowPath },
      this.getRunContext(),
    );

    this.dispatcher.dispatch({
      type,
      payload,
      meta,
    } as AgentfootprintEventMap[AgentfootprintEventType]);
  }
}

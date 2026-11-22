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
import { buildEventMeta, type RunContext, type TurnEventMeta } from '../../bridge/eventMeta.js';
import { projectEventSourcePosition } from '../../bridge/eventSourcePosition.js';
import { isDeferredPayloadSummary, type DeferredPayloadSummary } from './deferredPayload.js';

export interface EmitBridgeOptions {
  readonly dispatcher: EventDispatcher;
  /** Recorder id — must be unique among attached recorders. */
  readonly id: string;
  /**
   * Event-name prefix(es) this bridge forwards (e.g.
   * 'agentfootprint.stream.'). An array forwards any event matching ANY
   * of them — used when one source domain spans two event families
   * (`agentfootprint.fallback.` + `agentfootprint.error.`), or to match
   * exact full event names rather than a whole domain.
   */
  readonly prefix: string | readonly string[];
  readonly getRunContext: () => RunContext;
  /** Set on one native bridge per run, since each bridge sees the same emit capture. */
  readonly onSummary?: () => void;
  readonly rootTurnAt?: (type: AgentfootprintEventType, runtimeStageId: string) => true | undefined;
  readonly turnMetaAt?: (
    type: AgentfootprintEventType,
    runtimeStageId: string,
  ) => TurnEventMeta | undefined;
}

export class EmitBridge implements CombinedRecorder {
  readonly id: string;
  private readonly dispatcher: EventDispatcher;
  private readonly prefixes: readonly string[];
  private readonly getRunContext: () => RunContext;
  private readonly onSummary: EmitBridgeOptions['onSummary'];
  private readonly rootTurnAt: EmitBridgeOptions['rootTurnAt'];
  private readonly turnMetaAt: EmitBridgeOptions['turnMetaAt'];

  constructor(options: EmitBridgeOptions) {
    this.dispatcher = options.dispatcher;
    this.id = options.id;
    this.prefixes = typeof options.prefix === 'string' ? [options.prefix] : options.prefix;
    this.getRunContext = options.getRunContext;
    this.onSummary = options.onSummary;
    this.rootTurnAt = options.rootTurnAt;
    this.turnMetaAt = options.turnMetaAt;
  }

  onEmit(event: EmitEvent | DeferredPayloadSummary): void {
    if (!('name' in event) || typeof event.name !== 'string') {
      if (this.onSummary !== undefined && isDeferredPayloadSummary(event)) this.onSummary();
      return;
    }
    const name = event.name;
    if (!this.prefixes.some((p) => name.startsWith(p))) return;
    const type = event.name as AgentfootprintEventType;
    if (!this.dispatcher.hasListenersFor(type)) return;

    const payload = event.payload as AgentfootprintEventMap[AgentfootprintEventType]['payload'];
    const meta = buildEventMeta(
      {
        runtimeStageId: event.runtimeStageId,
        subflowPath: event.subflowPath,
        timestamp: event.timestamp,
        sourcePosition: projectEventSourcePosition(event),
        rootTurn: this.rootTurnAt?.(type, event.runtimeStageId),
        ...this.turnMetaAt?.(type, event.runtimeStageId),
      },
      this.getRunContext(),
    );

    // The payload was served at its source (`src/redaction/runRedaction.ts` ·
    // `emitServed`, before `$emit`), so this hop serves only the meta.
    this.dispatcher.dispatchServed({
      type,
      payload,
      meta,
    } as AgentfootprintEventMap[AgentfootprintEventType]);
  }
}

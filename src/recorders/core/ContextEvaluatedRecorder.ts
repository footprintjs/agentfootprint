/**
 * ContextEvaluatedRecorder — forwards the `agentfootprint.context.evaluated`
 * emit to the dispatcher.
 *
 * Pattern: Factory (GoF) returning an EmitBridge instance.
 * Role:    The InjectionEngine `typedEmit`s `context.evaluated` (the
 *          "what was considered / active / skipped + why" summary). Unlike the
 *          other `context.*` events — which `ContextRecorder` DISPATCHES by
 *          observing scope writes — this one is emitted complete by the stage,
 *          so it just needs forwarding (the EmitBridge pass-through pattern,
 *          same as StreamRecorder / AgentRecorder).
 * Why a full-name prefix: scoped to EXACTLY `agentfootprint.context.evaluated`
 *          (not the whole `context.*` domain) so it never double-dispatches
 *          `context.slot_composed`, which IS `typedEmit`'d in the viz chart
 *          (`buildMessageApiChart`) while ALSO being dispatched by
 *          `ContextRecorder` from writes in the runtime charts.
 * Emits:   agentfootprint.context.evaluated
 */

import { EmitBridge, type EmitBridgeOptions } from './EmitBridge.js';

export type ContextEvaluatedRecorderOptions = Omit<EmitBridgeOptions, 'id' | 'prefix'> & {
  readonly id?: string;
};

export function contextEvaluatedRecorder(options: ContextEvaluatedRecorderOptions): EmitBridge {
  return new EmitBridge({
    id: options.id ?? 'agentfootprint.context-evaluated-recorder',
    // Full event name (not the `agentfootprint.context.` domain) — forwards
    // ONLY context.evaluated, avoiding overlap with ContextRecorder's
    // write-derived context.* dispatch.
    prefix: 'agentfootprint.context.evaluated',
    dispatcher: options.dispatcher,
    getRunContext: options.getRunContext,
  });
}

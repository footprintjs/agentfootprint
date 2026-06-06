/**
 * ReliabilityRecorder — forwards `agentfootprint.reliability.*` emits to
 * the dispatcher.
 *
 * Pattern: Factory (GoF) returning an EmitBridge instance.
 * Role:    Bridges the rules-based reliability loop's telemetry
 *          (`reliability.fail_fast` / `reliability.retried` /
 *          `reliability.recovered`, emitted from `executeWithReliability`
 *          via `typedEmit`) to the EventDispatcher so typed consumer
 *          listeners (`agent.on('agentfootprint.reliability.retried', …)`)
 *          fire. Without this bridge those emits hit the footprintjs emit
 *          channel but never reach the dispatcher.
 * Emits:   agentfootprint.reliability.fail_fast / retried / recovered
 *
 * NOTE: this is the RULES-LOOP family. The generic `error.retried` /
 * `error.recovered` events are reserved for the standalone provider
 * decorators (withRetry/withFallback) and are NOT bridged here — see
 * docs/MENTAL_MODEL.md §14.
 */

import { EmitBridge, type EmitBridgeOptions } from './EmitBridge.js';

export type ReliabilityRecorderOptions = Omit<EmitBridgeOptions, 'id' | 'prefix'> & {
  readonly id?: string;
};

export function reliabilityRecorder(options: ReliabilityRecorderOptions): EmitBridge {
  return new EmitBridge({
    id: options.id ?? 'agentfootprint.reliability-recorder',
    prefix: 'agentfootprint.reliability.',
    dispatcher: options.dispatcher,
    getRunContext: options.getRunContext,
  });
}

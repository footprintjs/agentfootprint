/**
 * ResilienceRecorder — forwards the provider-decorator telemetry family
 * to the dispatcher.
 *
 * Pattern: Factory (GoF) returning an EmitBridge instance.
 * Role:    Bridges the four events the resilience decorators source
 *          (`fallback.triggered` / `error.retried` / `error.recovered` /
 *          `error.circuit_changed`, emitted in-run by `resilienceHooks`
 *          via `typedEmit`) to the EventDispatcher so typed consumer
 *          listeners (`agent.on('agentfootprint.error.retried', …)`)
 *          fire. Without this bridge those emits hit the footprintjs emit
 *          channel but never reach the dispatcher.
 * Emits:   agentfootprint.fallback.triggered
 *          agentfootprint.error.retried
 *          agentfootprint.error.recovered
 *          agentfootprint.error.circuit_changed  (9.32.0)
 *
 * Matched on EXACT full event names rather than the broader
 * `agentfootprint.error.` prefix. `error.fatal` is dispatched directly by
 * ErrorBridge (from footprintjs's `onRunFailed`, never via `$emit`), so a
 * broad prefix would be harmless today — the exact names close the
 * double-dispatch trap outright if that ever changes.
 *
 * NOTE: this is the DECORATOR family (fixed `maxAttempts` + exponential
 * backoff). The rules-based reliability loop's dynamic decisions ride the
 * `reliability.*` family and its own bridge — the two legitimately
 * interleave in one stage but stay distinct. See docs/MENTAL_MODEL.md §14.
 */

import { EmitBridge, type EmitBridgeOptions } from './EmitBridge.js';

export type ResilienceRecorderOptions = Omit<EmitBridgeOptions, 'id' | 'prefix'> & {
  readonly id?: string;
};

export function resilienceRecorder(options: ResilienceRecorderOptions): EmitBridge {
  return new EmitBridge({
    id: options.id ?? 'agentfootprint.resilience-recorder',
    prefix: [
      'agentfootprint.fallback.triggered',
      'agentfootprint.error.retried',
      'agentfootprint.error.recovered',
      'agentfootprint.error.circuit_changed',
    ],
    dispatcher: options.dispatcher,
    getRunContext: options.getRunContext,
  });
}

/**
 * IntegrityRecorder — forwards `agentfootprint.integrity.*` emits to the
 * dispatcher.
 *
 * Pattern: Factory over EmitBridge (the credentialRecorder shape, exactly).
 * Role:    Bridges Context Integrity findings so consumers observe them via
 *          `agent.on('agentfootprint.integrity.context_error', …)` and
 *          `agent.on('agentfootprint.integrity.*', …)`.
 * Emits:   agentfootprint.integrity.context_error
 *
 * Attached WITH the domain (9.60.0) — the credential.* lesson, applied
 * again: a findings channel nobody can subscribe to is decoration, which
 * is the precise decay this whole family exists to prevent. Zero-cost when
 * nothing fires: EmitBridge drops an event with no listener before meta.
 */

import { EmitBridge, type EmitBridgeOptions } from './EmitBridge.js';

export type IntegrityRecorderOptions = Omit<EmitBridgeOptions, 'id' | 'prefix'> & {
  readonly id?: string;
};

export function integrityRecorder(options: IntegrityRecorderOptions): EmitBridge {
  return new EmitBridge({
    id: options.id ?? 'agentfootprint.integrity-recorder',
    prefix: 'agentfootprint.integrity.',
    dispatcher: options.dispatcher,
    getRunContext: options.getRunContext,
  });
}

/**
 * MapRecorder — forwards `agentfootprint.map.*` emits to the dispatcher.
 *
 * Pattern: Factory over EmitBridge (the credentialRecorder shape, exactly).
 * Role:    Bridges the mount kernel's engagement lifecycle — engaged,
 *          parked — so consumers observe it via
 *          `agent.on('agentfootprint.map.parked', …)` and
 *          `agent.on('agentfootprint.map.*', …)`.
 * Emits:   agentfootprint.map.{engaged,parked}
 *
 * Attached WITH the domain (9.58.0), not after it — the credential domain
 * emitted into silence for eight minors because its bridge arrived late,
 * and that lesson is written on CredentialRecorder. Zero-cost when nothing
 * fires: EmitBridge drops an event with no listener before building meta.
 */

import { EmitBridge, type EmitBridgeOptions } from './EmitBridge.js';

export type MapRecorderOptions = Omit<EmitBridgeOptions, 'id' | 'prefix'> & {
  readonly id?: string;
};

export function mapRecorder(options: MapRecorderOptions): EmitBridge {
  return new EmitBridge({
    id: options.id ?? 'agentfootprint.map-recorder',
    prefix: 'agentfootprint.map.',
    dispatcher: options.dispatcher,
    getRunContext: options.getRunContext,
  });
}

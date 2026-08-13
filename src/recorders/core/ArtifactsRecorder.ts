/**
 * ArtifactsRecorder — forwards `agentfootprint.artifacts.*` emits to the
 * dispatcher.
 *
 * Pattern: Factory over EmitBridge (the credentialRecorder shape, exactly).
 * Role:    Bridges the claim-check lifecycle — minted, resolved, expired,
 *          refused — so consumers observe it via
 *          `agent.on('agentfootprint.artifacts.minted', …)` and
 *          `agent.on('agentfootprint.artifacts.*', …)`.
 * Emits:   agentfootprint.artifacts.{minted,resolved,expired,refused}
 *
 * Shipped WITH the domain (9.21.0), because the credential domain proved what
 * the alternative costs: payloads, registry entries and live emit sites with
 * no bridge meant `agent.on(...)` observed a healthy silence while every call
 * failed. Zero-cost when nothing fires — `EmitBridge` drops an event with no
 * listener before building any meta.
 */

import { EmitBridge, type EmitBridgeOptions } from './EmitBridge.js';

export type ArtifactsRecorderOptions = Omit<EmitBridgeOptions, 'id' | 'prefix'> & {
  readonly id?: string;
};

export function artifactsRecorder(options: ArtifactsRecorderOptions): EmitBridge {
  return new EmitBridge({
    id: options.id ?? 'agentfootprint.artifacts-recorder',
    prefix: 'agentfootprint.artifacts.',
    dispatcher: options.dispatcher,
    getRunContext: options.getRunContext,
  });
}

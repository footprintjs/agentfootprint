/**
 * CredentialRecorder — forwards `agentfootprint.credential.*` emits to the
 * dispatcher.
 *
 * Pattern: Factory over EmitBridge.
 * Role:    Bridges the declare-and-push credential lifecycle — requested,
 *          acquired, authorization_required, failed — so consumers observe it
 *          via `agent.on('agentfootprint.credential.failed', …)` and
 *          `agent.on('agentfootprint.credential.*', …)`.
 * Emits:   agentfootprint.credential.{requested,acquired,authorization_required,failed}
 *
 * ── Why this did not exist until 9.4.0, and what it cost ────────────────────
 * The credential domain has had payload types, registry entries and real
 * `typedEmit` call sites since 6.11.0 — and NO BRIDGE. Every one of those
 * events was raised onto footprintjs's emit channel and stopped there: a raw
 * `agent.attach()` recorder saw them, and `agent.on(...)` never did. So the
 * documented way to watch for credential failures observed nothing, and an AWS
 * identity adapter that failed 100% of its calls for two minor versions did so
 * in a silence that read exactly like health.
 *
 * This is the law CLAUDE.md states for a new event DOMAIN — payload + registry
 * entry + `DomainWildcard` arm + a bridge attach — with the fourth part
 * missing. Zero-cost when nothing fires: `EmitBridge` drops an event with no
 * listener before building any meta.
 */

import { EmitBridge, type EmitBridgeOptions } from './EmitBridge.js';

export type CredentialRecorderOptions = Omit<EmitBridgeOptions, 'id' | 'prefix'> & {
  readonly id?: string;
};

export function credentialRecorder(options: CredentialRecorderOptions): EmitBridge {
  return new EmitBridge({
    id: options.id ?? 'agentfootprint.credential-recorder',
    prefix: 'agentfootprint.credential.',
    dispatcher: options.dispatcher,
    getRunContext: options.getRunContext,
  });
}

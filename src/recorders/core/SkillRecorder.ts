/**
 * SkillRecorder — forwards `agentfootprint.skill.*` emits to the v2 dispatcher.
 *
 * Pattern: Factory over EmitBridge.
 * Role:    Bridges skill lifecycle events (activated, deactivated) emitted
 *          by consumer skill-management code. Skills are a consumer-owned
 *          context-engineering concern; the library only provides transport.
 * Emits:   agentfootprint.skill.activated / skill.deactivated
 */

import { EmitBridge, type EmitBridgeOptions } from './EmitBridge.js';

export type SkillRecorderOptions = Omit<EmitBridgeOptions, 'id' | 'prefix'> & {
  readonly id?: string;
};

export function skillRecorder(options: SkillRecorderOptions): EmitBridge {
  return new EmitBridge({
    id: options.id ?? 'agentfootprint.skill-recorder',
    prefix: 'agentfootprint.skill.',
    dispatcher: options.dispatcher,
    getRunContext: options.getRunContext,
  });
}

/**
 * AgentRecorder — forwards `agentfootprint.agent.*` emits to v2 dispatcher.
 *
 * Pattern: Factory (GoF) returning an EmitBridge instance.
 * Role:    Convenience constructor for the agent-lifecycle bridge recorder.
 *          Same mechanics as StreamRecorder, scoped to agent.* events
 *          (turns + iterations + route decisions + handoffs).
 * Emits:   agentfootprint.agent.turn_start / turn_end / iteration_start /
 *          iteration_end / route_decided / handoff
 */

import { EmitBridge, type EmitBridgeOptions } from './EmitBridge.js';

export type AgentRecorderOptions = Omit<EmitBridgeOptions, 'id' | 'prefix'> & {
  readonly id?: string;
};

export function agentRecorder(options: AgentRecorderOptions): EmitBridge {
  return new EmitBridge({
    id: options.id ?? 'agentfootprint.agent-recorder',
    prefix: 'agentfootprint.agent.',
    dispatcher: options.dispatcher,
    getRunContext: options.getRunContext,
  });
}

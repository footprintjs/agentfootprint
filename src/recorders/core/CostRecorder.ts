/**
 * CostRecorder — forwards `agentfootprint.cost.*` emits to v2 dispatcher.
 *
 * Pattern: Factory (GoF) returning an EmitBridge instance.
 * Role:    Bridges `cost.tick` + `cost.limit_hit` emits from LLMCall / Agent
 *          stages (via `emitCostTick`) to the v2 EventDispatcher so typed
 *          consumer listeners fire.
 * Emits:   agentfootprint.cost.tick / cost.limit_hit
 */

import { EmitBridge, type EmitBridgeOptions } from './EmitBridge.js';

export type CostRecorderOptions = Omit<EmitBridgeOptions, 'id' | 'prefix'> & {
  readonly id?: string;
};

export function costRecorder(options: CostRecorderOptions): EmitBridge {
  return new EmitBridge({
    id: options.id ?? 'agentfootprint.cost-recorder',
    prefix: 'agentfootprint.cost.',
    dispatcher: options.dispatcher,
    getRunContext: options.getRunContext,
  });
}

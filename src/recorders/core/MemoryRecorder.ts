/**
 * MemoryRecorder — forwards `agentfootprint.memory.*` emits to the dispatcher.
 *
 * Pattern: Factory over EmitBridge.
 * Role:    Bridges memory-layer events (strategy_applied, attached,
 *          detached, written) emitted by consumer memory adapters.
 *          The library does not ship a memory implementation; consumers
 *          plug in their own store and emit these events where relevant
 *          (e.g., before/after sliding-window summarization).
 * Emits:   agentfootprint.memory.strategy_applied / attached /
 *          detached / written
 */

import { EmitBridge, type EmitBridgeOptions } from './EmitBridge.js';

export type MemoryRecorderOptions = Omit<EmitBridgeOptions, 'id' | 'prefix'> & {
  readonly id?: string;
};

export function memoryRecorder(options: MemoryRecorderOptions): EmitBridge {
  return new EmitBridge({
    id: options.id ?? 'agentfootprint.memory-recorder',
    prefix: 'agentfootprint.memory.',
    dispatcher: options.dispatcher,
    getRunContext: options.getRunContext,
  });
}

/**
 * EmbeddingRecorder — forwards `agentfootprint.embedding.*` emits to the dispatcher.
 *
 * Pattern: Factory over EmitBridge.
 * Role:    Bridges the embedding domain — the two-phase cost model. Without a
 *          bridge an emit never reaches `agent.on(...)` no matter how correctly
 *          it is fired, which is the shape this domain was in until 8.9.0: it
 *          had a payload type, a registry entry and a `DomainWildcard` arm, and
 *          no way for the event to arrive.
 * Emits:   agentfootprint.embedding.generated
 *
 * Always-on and zero-cost: an agent with no memory pipeline embeds nothing and
 * this bridge sees nothing.
 */

import { EmitBridge, type EmitBridgeOptions } from './EmitBridge.js';

export type EmbeddingRecorderOptions = Omit<EmitBridgeOptions, 'id' | 'prefix'> & {
  readonly id?: string;
};

export function embeddingRecorder(options: EmbeddingRecorderOptions): EmitBridge {
  return new EmitBridge({
    id: options.id ?? 'agentfootprint.embedding-recorder',
    prefix: 'agentfootprint.embedding.',
    dispatcher: options.dispatcher,
    getRunContext: options.getRunContext,
  });
}

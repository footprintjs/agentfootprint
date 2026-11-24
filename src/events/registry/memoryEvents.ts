import type { AgentfootprintEventEnvelope } from '../types.js';
import type {
  MemoryAttachedPayload,
  MemoryDetachedPayload,
  MemoryRetrievedPayload,
  MemoryStrategyAppliedPayload,
  MemoryWrittenPayload,
} from '../payloads/memory.js';

export interface MemoryEventMap {
  // memory
  'agentfootprint.memory.strategy_applied': AgentfootprintEventEnvelope<
    'agentfootprint.memory.strategy_applied',
    MemoryStrategyAppliedPayload
  >;
  'agentfootprint.memory.attached': AgentfootprintEventEnvelope<
    'agentfootprint.memory.attached',
    MemoryAttachedPayload
  >;
  'agentfootprint.memory.retrieved': AgentfootprintEventEnvelope<
    'agentfootprint.memory.retrieved',
    MemoryRetrievedPayload
  >;
  'agentfootprint.memory.detached': AgentfootprintEventEnvelope<
    'agentfootprint.memory.detached',
    MemoryDetachedPayload
  >;
  'agentfootprint.memory.written': AgentfootprintEventEnvelope<
    'agentfootprint.memory.written',
    MemoryWrittenPayload
  >;
  /** A settled host reply was projected through this memory's declared writer. */
  'agentfootprint.memory.write_outcome': AgentfootprintEventEnvelope<
    'agentfootprint.memory.write_outcome',
    { readonly memoryId: string; readonly outcome: 'acknowledged' | 'unknown' }
  >;
}

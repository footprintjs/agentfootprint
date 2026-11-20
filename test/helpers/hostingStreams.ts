import { flowChart } from 'footprintjs';
import type { Agent } from '../../src/core/Agent.js';
import {
  defineMemory,
  InMemoryStore,
  MEMORY_STRATEGIES,
  MEMORY_TYPES,
  type MemoryDefinition,
} from '../../src/doors/memory.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';
import { toSSE, type ToSSEOptions } from '../../src/hosting/stream.js';

type EventPort = {
  on(type: '*', listener: (event: AgentfootprintEvent) => void): () => void;
};

/** Once the run has finished delivering events, the next heartbeat bounds the wait. */
export function readWithHeartbeat(runner: EventPort, options: ToSSEOptions) {
  let drained = false;
  const reading = (async () => {
    const chunks: string[] = [];
    for await (const chunk of toSSE(runner, { ...options, heartbeatMs: 50 })) {
      if (chunk !== ': ping\n\n') chunks.push(chunk);
      else if (drained) return { closed: false, chunks };
    }
    return { closed: true, chunks };
  })();
  return () => {
    drained = true;
    return reading;
  };
}

/** Mount a specialist's own Agent chart inside the root Agent's memory read. */
export function specialistMemory(child: Agent): MemoryDefinition {
  const read = flowChart('Seed', () => undefined, 'seed')
    .addSubFlowChartNext('specialist', child.getSpec(), 'Specialist', {
      inputMapper: () => ({
        message: 'Check the draft.',
        identity: { conversationId: 'specialist' },
      }),
      outputMapper: () => ({ formatted: 'The specialist finished.' }),
    })
    .build();
  const memory = defineMemory({
    id: 'nested',
    type: MEMORY_TYPES.EPISODIC,
    strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 2 },
    store: new InMemoryStore(),
    readOnly: true,
  });
  return { ...memory, read: read as unknown as MemoryDefinition['read'] };
}

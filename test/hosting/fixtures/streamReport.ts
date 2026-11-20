import { flowChart } from 'footprintjs';
import { Agent, defineTool, pauseHere, type AgentOptions } from '../../../src/index.js';
import {
  defineMemory,
  InMemoryStore,
  MEMORY_STRATEGIES,
  MEMORY_TYPES,
  type MemoryDefinition,
} from '../../../src/doors/memory.js';
import { mock } from '../../../src/doors/providers.js';
import type { AgentfootprintEvent } from '../../../src/events/registry.js';
import { toSSE, type ToSSEOptions } from '../../../src/hosting/stream.js';

export const approval = defineTool({
  name: 'ask_approval',
  description: 'Wait for approval.',
  inputSchema: { type: 'object', properties: {} },
  execute: () => pauseHere({ question: 'Approve?' }),
});

const pendingReport = defineTool({
  name: 'pending_report',
  description: 'Check whether the report is ready.',
  inputSchema: { type: 'object', properties: {} },
  execute: () => ({ content: 'Queued.', effects: [], status: 'pending' }),
});

export const call = (name: string, id = 'c1') => ({
  content: '',
  toolCalls: [{ id, name, args: {} }],
});

export const REPORT = 'The report is ready.';
export const DRAFT = 'The draft is ready.';
export const WARNING = '\n\n---\n\nNot sure — a tool reported unfinished work.';
export const TURN_END = 'agentfootprint.agent.turn_end';

export function reportBuilder(
  answer: string,
  pause: boolean,
  options: Pick<AgentOptions, 'redact' | 'observerDelivery' | 'reactMode'> = {},
) {
  const replies = [call('pending_report'), ...(pause ? [call('ask_approval', 'c2')] : []), answer];
  return Agent.create({ provider: mock({ replies, chunkDelayMs: 0 }), model: 'm', ...options })
    .tool(pendingReport)
    .tool(approval)
    .answerLayer({ standingLine: true });
}

export function mountReport(
  child: Pick<Agent, 'getSpec'>,
  options: Parameters<typeof reportBuilder>[2],
) {
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
  return reportBuilder(REPORT, false, options)
    .memory({ ...memory, read: read as unknown as MemoryDefinition['read'] })
    .build();
}

/** Start reading now. Once the run's observers have drained, the next heartbeat bounds the wait. */
export function readWithHeartbeat(
  runner: { on(type: '*', listener: (event: AgentfootprintEvent) => void): () => void },
  options: ToSSEOptions,
) {
  let drained = false;
  const reading = (async () => {
    const chunks: string[] = [];
    for await (const chunk of toSSE(runner, { ...options, heartbeatMs: 50 })) {
      if (chunk !== ': ping\n\n') chunks.push(chunk);
      // Returning releases the iterator even when the stream failed to close.
      else if (drained) return { closed: false, chunks };
    }
    return { closed: true, chunks };
  })();
  return () => {
    drained = true;
    return reading;
  };
}

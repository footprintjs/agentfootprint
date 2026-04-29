/**
 * 09 — AgentCoreStore: AWS Bedrock AgentCore Memory adapter.
 *
 * Subpath import: `agentfootprint/memory-agentcore`. Lazy-required
 * `@aws-sdk/client-bedrock-agent-runtime` peer-dep.
 *
 * Production usage:
 *
 *   import { AgentCoreStore } from 'agentfootprint/memory-agentcore';
 *   const store = new AgentCoreStore({
 *     memoryId: 'arn:aws:bedrock:us-east-1:...:memory/my-mem',
 *     region: 'us-east-1',
 *   });
 *
 * This example uses an injected mock client so it runs offline.
 *
 * Caveats vs InMemoryStore (also documented at the adapter level):
 *   - `putIfVersion` is emulated client-side (read+write) — fine for
 *     single-writer-per-session deploys, weaker for multi-writer.
 *   - `seen` / `feedback` use in-process shadow state (don't survive
 *     process restart). Use Redis for durable recognition.
 *   - `search()` is NOT implemented in v2.3 — AgentCore's native
 *     retrieve API will surface as `agentcoreRetrieve()` later.
 */

import {
  Agent,
  defineMemory,
  MEMORY_TYPES,
  MEMORY_STRATEGIES,
  mock,
  type LLMProvider,
} from '../../src/index.js';
import {
  AgentCoreStore,
  type AgentCoreLikeClient,
} from '../../src/adapters/memory/agentcore.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'memory/09-agentcore-store',
  title: 'AgentCoreStore — AWS Bedrock AgentCore Memory adapter',
  group: 'memory',
  description:
    'Persist conversation memory in AWS Bedrock AgentCore. Mock-injected ' +
    'client so this example runs offline; in production pass `{ memoryId, region }`.',
  defaultInput: 'What did I tell you?',
  providerSlots: ['default'],
  tags: ['memory', 'adapter', 'aws', 'bedrock', 'agentcore', 'peer-dep'],
};

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  const fakeClient = makeFakeAgentCore();
  const store = new AgentCoreStore({
    memoryId: 'arn:aws:bedrock:us-east-1:000000000000:memory/demo',
    _client: fakeClient,
  });

  const memory = defineMemory({
    id: 'agentcore-window',
    description: 'Last 10 turns persisted in AgentCore Memory.',
    type: MEMORY_TYPES.EPISODIC,
    strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },
    store,
  });

  const agent = Agent.create({
    provider:
      provider ??
      mock({ reply: "I remember — you mentioned your name is Alice earlier." }),
    model: 'mock',
    maxIterations: 1,
  })
    .system('You remember conversations across runs via AgentCore Memory.')
    .memory(memory)
    .build();

  const identity = { tenant: 'demo', principal: 'alice', conversationId: 'agentcore-thread' };

  await agent.run({ message: 'My name is Alice.', identity });

  const result = await agent.run({ message: input, identity });
  await store.close();
  if (typeof result !== 'string') throw new Error('Agent paused unexpectedly.');
  return result;
}

function makeFakeAgentCore(): AgentCoreLikeClient {
  const sessions = new Map<string, Map<string, string>>();
  return {
    async putEvent(input) {
      const session = sessions.get(input.sessionId) ?? new Map<string, string>();
      session.set(input.eventId, input.payload);
      sessions.set(input.sessionId, session);
      return {};
    },
    async getEvent(input) {
      const payload = sessions.get(input.sessionId)?.get(input.eventId);
      return payload ? { payload } : null;
    },
    async listEvents(input) {
      const s = sessions.get(input.sessionId);
      if (!s) return { events: [] };
      const all = [...s.entries()].map(([eventId, payload]) => ({ eventId, payload }));
      const start = input.nextToken ? parseInt(input.nextToken, 10) : 0;
      const max = input.maxResults ?? all.length;
      const page = all.slice(start, start + max);
      const next = start + max;
      return next < all.length
        ? { events: page, nextToken: String(next) }
        : { events: page };
    },
    async deleteEvent(input) {
      sessions.get(input.sessionId)?.delete(input.eventId);
      return {};
    },
    async deleteSession(input) {
      sessions.delete(input.sessionId);
      return {};
    },
  };
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}

/**
 * 09 — AgentCoreStore: AWS Bedrock AgentCore Memory adapter.
 *
 * Lazy-required `@aws-sdk/client-bedrock-agentcore` peer-dep — maps the MemoryStore
 * onto AgentCore's event API (CreateEvent / ListEvents / DeleteEvent).
 *
 * Production usage:
 *
 *   import { AgentCoreStore } from 'agentfootprint/memory-providers';
 *   const store = new AgentCoreStore({
 *     memoryId: 'arn:aws:bedrock-agentcore:us-west-2:...:memory/my-mem',
 *     region: 'us-west-2',
 *   });
 *
 * This example uses an injected mock client so it runs offline.
 *
 * Caveats (AgentCore is an append-only event log, not a key-value store):
 *   - `put` appends; `get`/`delete` by id are list-then-find (O(events in session)).
 *     Window / episodic memory (append + list recent) is the natural fit.
 *   - `putIfVersion` is emulated client-side; `seen` / `feedback` are in-process
 *     shadow state (don't survive process restart) — use Redis for durable recognition.
 *   - `search()` is not wired — AgentCore's `RetrieveMemoryRecords` lands later.
 */

import { Agent, type LLMProvider } from '../../src/index.js'
import { defineMemory, MEMORY_TYPES, MEMORY_STRATEGIES } from '../../src/memory/index.js'
import { mock } from '../../src/llm-providers.js';
import {
  AgentCoreStore,
  type AgentCoreLikeClient,
} from '../../src/adapters/memory/agentcore.js';
import type { MemoryEntry } from '../../src/memory/entry/index.js';
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
  // #region define
  const store = new AgentCoreStore({
    memoryId: 'arn:aws:bedrock-agentcore:us-west-2:000000000000:memory/demo',
    _client: fakeClient,
  });

  const memory = defineMemory({
    id: 'agentcore-window',
    description: 'Last 10 turns persisted in AgentCore Memory.',
    type: MEMORY_TYPES.EPISODIC,
    strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },
    store,
  });
  // #endregion define

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

// Offline stand-in for the AgentCore event API: an append-log keyed by actor+session,
// mirroring CreateEvent (append, server-assigns the id) / ListEvents / DeleteEvent.
function makeFakeAgentCore(): AgentCoreLikeClient {
  const log = new Map<string, { eventId: string; entry: MemoryEntry }[]>();
  let seq = 0;
  const key = (actorId: string, sessionId: string) => `${actorId}|${sessionId}`;
  return {
    async createEvent({ actorId, sessionId, entry }) {
      const k = key(actorId, sessionId);
      const arr = log.get(k) ?? [];
      arr.push({ eventId: `ev-${seq++}`, entry });
      log.set(k, arr);
    },
    async listEvents({ actorId, sessionId, maxResults, nextToken }) {
      const arr = log.get(key(actorId, sessionId)) ?? [];
      const start = nextToken ? parseInt(nextToken, 10) : 0;
      const max = maxResults ?? arr.length;
      const page = arr.slice(start, start + max);
      const next = start + max;
      return next < arr.length ? { events: page, nextToken: String(next) } : { events: page };
    },
    async deleteEvent({ actorId, sessionId, eventId }) {
      const k = key(actorId, sessionId);
      const arr = log.get(k);
      if (arr) log.set(k, arr.filter((e) => e.eventId !== eventId));
    },
  };
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}

/**
 * 12 — Memory write options: skip long-term extraction, a namespace per tenant.
 *
 * A managed memory service (AWS Bedrock AgentCore Memory, here) does more than
 * keep what it is handed: it EXTRACTS long-term records — facts, summaries,
 * preferences — and files them under namespaces. `writeOptions` decides, for
 * every write a memory makes:
 *
 *   extraction: 'skip'   keep the writes out of long-term extraction
 *   namespaceScope       the namespace derived records are filed under —
 *                        here one per tenant, read from each write's identity
 *
 * AgentCoreStore sends them as CreateEvent's own fields (`extractionMode`,
 * `extractionConfig.namespaceVariables`). A store that cannot honour them
 * refuses BY NAME — shown at the end with InMemoryStore.
 *
 * Nothing leaves the process: the AgentCore client is an in-memory stand-in.
 *
 * Run:  npm run example examples/memory/12-write-options.ts
 */
import assert from 'node:assert/strict';
import { Agent, type LLMProvider } from '../../src/index.js';
import {
  defineMemory,
  InMemoryStore,
  MEMORY_STRATEGIES,
  MEMORY_TYPES,
  UnsupportedMemoryWriteOptionError,
} from '../../src/doors/memory.js';
import { mock } from '../../src/doors/providers.js';
import { AgentCoreStore, type AgentCoreLikeClient } from '../../src/adapters/memory/agentcore.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'memory/12-write-options',
  title: 'Memory write options — skip extraction, a namespace per tenant',
  group: 'memory',
  description:
    'defineMemory({ writeOptions }) over AgentCoreStore: every event is kept out of long-term extraction and filed under its own tenant’s namespace; InMemoryStore refuses the same options by name.',
  defaultInput: 'Remember that I prefer email.',
  providerSlots: ['default'],
  tags: ['memory', 'adapter', 'aws', 'agentcore', 'multi-tenant'],
};

export async function run(input: string, provider?: LLMProvider): Promise<unknown> {
  const created: Parameters<AgentCoreLikeClient['createEvent']>[0][] = [];

  // #region write-options
  const store = new AgentCoreStore({
    memoryId: 'arn:aws:bedrock-agentcore:us-west-2:000000000000:memory/demo',
    _client: standInClient(created), // ← drop this line (and pass `region`) for the real service
  });

  const memory = defineMemory({
    id: 'conversation',
    type: MEMORY_TYPES.EPISODIC,
    strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },
    store,
    writeOptions: {
      extraction: 'skip',
      // One namespace per tenant. Keep this mapping one-to-one.
      namespaceScope: (identity) => ({ tenantid: identity.tenant ?? 'none' }),
    },
  });
  // #endregion write-options

  const agent = Agent.create({
    provider: provider ?? mock({ reply: 'Noted.' }),
    model: 'mock',
    maxIterations: 1,
  })
    .system('You remember what each customer prefers.')
    .memory(memory)
    .build();

  await agent.run({ message: input, identity: { tenant: 'acme', conversationId: 'c-1' } });
  await agent.run({ message: input, identity: { tenant: 'globex', conversationId: 'c-1' } });

  // Every event asked AgentCore to skip extraction, under its own tenant's scope.
  assert.ok(created.length >= 2);
  assert.ok(created.every((e) => e.extractionMode === 'SKIP'));
  const tenants = new Set(created.map((e) => e.extractionConfig?.namespaceVariables['tenantid']));
  assert.deepEqual([...tenants].sort(), ['acme', 'globex']);

  // A store with no extraction cannot honour them — refused by name, not ignored.
  let refusal = '';
  try {
    defineMemory({
      id: 'local',
      type: MEMORY_TYPES.EPISODIC,
      strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },
      store: new InMemoryStore(),
      writeOptions: { extraction: 'skip' },
    });
  } catch (err) {
    assert.ok(err instanceof UnsupportedMemoryWriteOptionError);
    refusal = `${err.store} refused \`${err.option}\``;
  }
  assert.equal(refusal, 'InMemoryStore refused `extraction`');

  return { events: created.length, tenants: [...tenants].sort(), refusal };
}

/** An in-memory stand-in for the AgentCore event API that records what it was asked. */
function standInClient(created: Parameters<AgentCoreLikeClient['createEvent']>[0][]) {
  const client: AgentCoreLikeClient = {
    // This client forwards CreateEvent's extraction fields, so the store may honour them.
    forwardsWriteOptions: true,
    async createEvent(input) {
      created.push(input);
    },
    async listEvents() {
      return { events: [] };
    },
    async deleteEvent() {
      /* nothing to delete in this demo */
    },
  };
  return client;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch(console.error);
}

---
name: Window strategy — last N turns (short-term, rule-based)
group: memory
guide: ../../src/memory/README.md
defaultInput: What did I just say?
---

# Window — sliding window over recent conversation

Pure rule-based: keep the last `N` turns. No LLM calls, no embeddings.
The cheapest and simplest memory strategy — and the right answer for
the **90% case** (chatbot, short-to-medium conversations).

## When to use

- Short-to-medium chats (under ~20 turns)
- Latency- or cost-sensitive deployments where running a summarizer LLM
  every turn isn't justified
- You're starting out with memory and want a sensible default
- Tests / dev — pair with `InMemoryStore` for zero deps

## When to upgrade

| Symptom | Try instead |
|---|---|
| Conversations grow past 20 turns and context fills up | `MEMORY_STRATEGIES.SUMMARIZE` (compress older turns) |
| User refers back to topics from many turns ago | `MEMORY_STRATEGIES.TOP_K` with embeddings |
| You want both recent + relevant | `MEMORY_STRATEGIES.HYBRID` |

## Anatomy of one call

```ts
import {
  Agent,
  defineMemory,
  MEMORY_TYPES,
  MEMORY_STRATEGIES,
  InMemoryStore,
} from 'agentfootprint';

const memory = defineMemory({
  id: 'last-10',
  type: MEMORY_TYPES.EPISODIC,                          // raw conversation messages
  strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },// last 10 entries
  store: new InMemoryStore(),                            // swap for Redis/Postgres adapters in prod
});

const agent = Agent.create({ provider })
  .memory(memory)
  .build();

await agent.run({
  message: 'My name is Alice.',
  identity: { conversationId: 'alice-session' },         // stable across runs → memory accumulates
});
```

## What happens at runtime

```
┌─ Turn 1 ────────────────────────────────────────────────────────────┐
│  Seed → MemoryRead(last-10) → InjectionEngine → SystemPrompt →     │
│  Messages → Tools → CallLLM → Route → Final → MemoryWrite(last-10)  │
│                                                          ↓          │
│                                          stores [user, assistant]   │
└─────────────────────────────────────────────────────────────────────┘

┌─ Turn 2 ────────────────────────────────────────────────────────────┐
│  Seed → MemoryRead(last-10) → InjectionEngine → SystemPrompt → ...  │
│           ↑                                                         │
│   loads turn-1 messages as system context                           │
└─────────────────────────────────────────────────────────────────────┘
```

## Multi-tenant isolation

`identity.tenant` and `identity.principal` namespace the store so
two users never see each other's history:

```ts
await agent.run({ message: '...', identity: {
  tenant: 'acme-corp',
  principal: 'alice@acme.com',
  conversationId: 'support-thread-42',
}});
```

## Observability

The memory read/write subflows emit `agentfootprint.context.injected`
with `source: 'memory'`. In Lens, you'll see:
- One **memory chip** per registered memory in the system-prompt slot
- The chip's hover reveals: `id`, `strategy`, `entries loaded`, `score: n/a` (rule-based)

## Related strategies

- **[Budget](./02-budget-strategy.md)** — same idea but caps by token count instead of entry count
- **[Summarize](./03-summarize-strategy.md)** — when window can't keep up, compress older turns
- **[Top-K](./04-topK-strategy.md)** — semantic recall instead of recency
- **[Causal](./06-causal-snapshot.md)** — store the WHY (decision evidence) alongside the WHAT

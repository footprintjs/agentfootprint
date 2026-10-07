**Mixed** — persistence, retrieval, and the prose that carries recall onto the
wire.
Support: `store/`, `identity/`, `entry/`, `embedding/`, `turn/`.
Map: `pipeline/`, `wire/` (declared stage compositions).
Fold: `retrieval/`, `facts/`, `beats/`, `causal/` (derived claims over prior turns).
Lens: `stages/formatDefault.ts`, `beats/formatAsNarrative.ts`,
`facts/formatFacts.ts`, `causal/loadSnapshot.ts` — the only four files here that
put words in front of the model. They all write `scope.formatted`, and they own
the message role. `asRoleRefusal.ts` · `asRoleRefusal` is the record of what leaving that
unsaid cost: `asRole` was stored, read back, and never honoured. `redactRefusal.ts` ·
`memoryRedactRefusal` is the same record for `redact`: reserved, stored, never read.

# memory/

The agentfootprint memory system lives here. Public API lives at
`agentfootprint/memory` (subpath export).

## Layers

| Layer | Folder | Purpose |
|-------|--------|---------|
| Identity | `identity/` | Hierarchical `MemoryIdentity { tenant?, principal?, conversationId }` + `identityNamespace()` encoder. Tenant isolation at the boundary. |
| Entry | `entry/` | `MemoryEntry<T>` with version, timestamps, TTL, tier, source, decay. |
| Store | `store/` | `MemoryStore` interface (CRUD + seen/feedback/forget) + reference `InMemoryStore`. |
| Stages | `stages/` | `loadRecent`, `pickByBudget` (decider + branches), `formatDefault`, `writeMessages`. |
| Pipeline | `pipeline/` | `defaultPipeline(config)` / `ephemeralPipeline(config)` — compose stages into `{ read, write }` subflows. |
| Wire | `wire/` | `mountMemoryRead(builder)` / `mountMemoryWrite(builder)` — drop subflows into any host flowchart. |

Small legacy conversation-history helpers (`appendMessage`,
`lastAssistantMessage`, etc.) for array manipulation live in
`conversationHelpers.ts` and are re-exported from
`agentfootprint` (top-level), not from the memory subpath.

## Usage

```typescript
import { Agent } from 'agentfootprint';
import { defaultPipeline, InMemoryStore } from 'agentfootprint/memory';

const pipeline = defaultPipeline({ store: new InMemoryStore() });

const agent = Agent.create({ provider })
  .memoryPipeline(pipeline)
  .build();

await agent.run('My name is Alice', {
  identity: { conversationId: 'alice-session' },
});
```

See the [Memory pipeline guide](https://agentfootprint.dev/docs/build/memory)
for full documentation.

## A memory is working state, not a record

What a store keeps is what the agent's next run recalls and sends to the model —
the class of value the redaction law never covers (live state, what the agent
computes on). So `defineMemory({ redact })` and `defineRAG({ redact })` are
REFUSED (`redactRefusal.ts`), on presence, for TypeScript and JavaScript callers
alike, rather than accepted and ignored. The agent's own `redact` covers the
RECORD of the memory stages — the snapshot's memory subflows, the
`memory.*` / `context.*` events, recordings — and never the store:

```typescript
const agent = Agent.create({ provider, model, redact: conversationRedaction() })
  .memory(defineMemory({ id: 'chat', type: MEMORY_TYPES.EPISODIC,
    strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 }, store }))
  .build();
// The store holds the real turn (the next run recalls it); every record of
// this run holds the placeholder (test/memory/redactRefusal.test.ts).
```

To keep a value out of a store, leave it out before the write, or mount the
memory `readOnly: true`.

## Orthogonal concerns

- **What to keep in-context**: `providers/messages/` strategies (`slidingWindow`, `charBudget`, `summaryStrategy`, `compositeMessages`). These reshape `scope.messages` pre-LLM and are orthogonal to durable persistence.
- **Durable persistence across runs**: the memory pipeline above.

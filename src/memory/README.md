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

See the [Memory pipeline guide](../../docs-site/src/content/docs/guides/memory.mdx)
for full documentation.

## Orthogonal concerns

- **What to keep in-context**: `providers/messages/` strategies (`slidingWindow`, `charBudget`, `summaryStrategy`, `compositeMessages`). These reshape `scope.messages` pre-LLM and are orthogonal to durable persistence.
- **Durable persistence across runs**: the memory pipeline above.

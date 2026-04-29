---
name: RAG — retrieval-augmented generation
group: context-engineering
guide: ../../src/lib/rag/
defaultInput: How long do refunds take?
---

# RAG — retrieval-augmented generation

The fifth context-engineering flavor (after Skill / Steering / Instruction / Fact). Embeds the user's question, retrieves top-K semantically similar chunks from a vector store, injects them into the messages slot of the next LLM call.

The pitch from the v2.0 README:

> Adding the next flavor is **one new factory file** &mdash; no engine change, no slot subflow change, no consumer-API change.

`defineRAG` proves that. The whole RAG public surface is two functions:

- `defineRAG({ id, store, embedder, topK?, threshold?, asRole? })` &mdash; the read-side factory
- `indexDocuments(store, embedder, docs)` &mdash; the seeding helper

Under the hood, `defineRAG` returns the same `MemoryDefinition` that `defineMemory({ type: SEMANTIC, strategy: TOP_K })` produces &mdash; just with RAG-friendly defaults (`asRole: 'user'`, `topK: 3`, `threshold: 0.7`) and a clearer name.

## Anatomy

```ts
import {
  Agent, defineRAG, indexDocuments,
  InMemoryStore, mockEmbedder,
} from 'agentfootprint';

const embedder = mockEmbedder();         // swap for openaiEmbedder() in prod
const store = new InMemoryStore();       // swap for pgvector / Pinecone / Qdrant

// 1. Seed the corpus ONCE at startup
await indexDocuments(store, embedder, [
  { id: 'doc1', content: 'Refunds are processed within 3 business days.' },
  { id: 'doc2', content: 'Pro plan costs $20/month.' },
  { id: 'doc3', content: 'Free plan: 100 API calls per month.' },
]);

// 2. Define the retriever
const docs = defineRAG({
  id: 'product-docs',
  store, embedder,
  topK: 3,
  threshold: 0.7,                        // STRICT — no fallback
  asRole: 'user',                        // RAG default
});

// 3. Wire to agent
const agent = Agent.create({ provider })
  .rag(docs)                             // alias for `.memory(docs)` — same plumbing
  .build();

// 4. Run
await agent.run({
  message: 'How long do refunds take?',
  identity: { conversationId: '_global' },// must match indexDocuments identity
});
```

## Strict threshold semantics

When **no chunk** meets the threshold, **no injection happens**. There is no "return top-K anyway" fallback. Garbage past context is worse than no context &mdash; it primes the LLM toward a wrong answer.

This is the same panel-decision strict-threshold rule as `defineMemory({ strategy: TOP_K })` &mdash; consistent across both surfaces.

## When `defineRAG` vs `defineMemory({ type: SEMANTIC })`

Same plumbing. The distinction is consumer intent:

| Use `defineRAG` when... | Use `defineMemory({ type: SEMANTIC })` when... |
|---|---|
| You're retrieving from a **document corpus** (docs, KB articles, FAQs) | You're storing **facts learned from conversation** |
| Content is seeded once at startup (`indexDocuments`) | Content accumulates per-turn during the agent loop |
| Default role is `user` (chunks are retrieved context) | Default role is `system` (facts are agent knowledge) |
| Lifetime: corpus rebuilds on schedule | Lifetime: per-conversation, multi-tenant |

## Multi-tenant corpora

By default `indexDocuments` writes under `{ conversationId: '_global' }` &mdash; one shared corpus across all users. For per-tenant document partitions:

```ts
await indexDocuments(store, embedder, tenantADocs, {
  identity: { tenant: 'acme', conversationId: 'corpus' },
});
await indexDocuments(store, embedder, tenantBDocs, {
  identity: { tenant: 'globex', conversationId: 'corpus' },
});

// Same RAG definition works for both tenants — identity at agent.run
// time selects which corpus to retrieve from.
const docs = defineRAG({ id: 'docs', store, embedder });
agent.rag(docs);

await agent.run({
  message: '...',
  identity: { tenant: 'acme', conversationId: 'corpus' },
});
```

## Cost model

Per agent.run() with RAG:
- 1 embedding call (the user's query) &mdash; ~$0.00002 with `text-embedding-3-small`
- 1 store search &mdash; in-memory: microseconds; pgvector / Pinecone: 10-50ms
- 0 LLM calls beyond the standard agent flow

Indexing cost is amortized: `indexDocuments` runs once at startup, embedding all docs in batch. Use `embedder.embedBatch?` if your embedder supports it (the helper falls back to parallel singles).

## Compliance

`MemoryStore.forget(identity)` cascades to RAG entries when they were indexed under a tenant identity &mdash; right-to-erasure works the same as for any memory entry. For doc-level removal, call `store.delete(identity, docId)` directly.

## Related

- **[Skills](./02-skill.md)** &mdash; LLM-activated body + tools (different flavor: skills *react* to user intent, RAG *retrieves* for it)
- **[Memory](../memory/04-topK-strategy.md)** &mdash; same plumbing, different intent (conversation memory vs document corpus)
- **[Causal](../memory/06-causal-snapshot.md)** &mdash; the differentiator that doesn't have a v1-style equivalent

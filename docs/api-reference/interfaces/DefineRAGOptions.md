[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / DefineRAGOptions

# Interface: DefineRAGOptions

Defined in: [agentfootprint/src/lib/rag/defineRAG.ts:70](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/rag/defineRAG.ts#L70)

## Properties

### asRole?

> `readonly` `optional` **asRole?**: [`ContextRole`](/agentfootprint/api/generated/type-aliases/ContextRole.md)

Defined in: [agentfootprint/src/lib/rag/defineRAG.ts:138](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/rag/defineRAG.ts#L138)

Role to use when injecting retrieved chunks into the messages
slot. Default `'user'`.

Why `'user'`: in tool-using ReAct loops, retrieved chunks
conceptually "augment what the user asked." Anthropic's tool-use
cookbook and OpenAI's RAG cookbook both show retrieved context
inside user-turn messages.

Use `'system'` for authoritative reference docs that should
outweigh user instruction (policy / compliance / brand-voice
corpora). Use `'assistant'` only if you've persisted prior agent
turns as context — rare.

***

### description?

> `readonly` `optional` **description?**: `string`

Defined in: [agentfootprint/src/lib/rag/defineRAG.ts:79](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/rag/defineRAG.ts#L79)

Human-readable description. Surfaces in narrative + Lens hover.
Recommend describing the *corpus* (e.g., "Product documentation
chunks indexed weekly from docs.example.com").

***

### embedder

> `readonly` **embedder**: [`Embedder`](/agentfootprint/api/generated/interfaces/Embedder.md)

Defined in: [agentfootprint/src/lib/rag/defineRAG.ts:94](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/rag/defineRAG.ts#L94)

Embedder used for the read-side query. Pass the SAME embedder
instance (or one with the same `name`) that was used for indexing
— cross-model similarity scores are not comparable.

***

### embedderId?

> `readonly` `optional` **embedderId?**: `string`

Defined in: [agentfootprint/src/lib/rag/defineRAG.ts:101](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/rag/defineRAG.ts#L101)

Stable id of the embedder. Stored on entries during indexing
(via `indexDocuments`) and filtered at search time so a later
embedder swap doesn't pollute results.

***

### id

> `readonly` **id**: `string`

Defined in: [agentfootprint/src/lib/rag/defineRAG.ts:72](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/rag/defineRAG.ts#L72)

Stable id. Becomes the scope-key suffix and the Lens label.

***

### store

> `readonly` **store**: `MemoryStore`

Defined in: [agentfootprint/src/lib/rag/defineRAG.ts:87](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/rag/defineRAG.ts#L87)

Vector-capable store containing the indexed corpus. Must implement
`search()`. Use `indexDocuments(store, embedder, docs)` at startup
to populate it. Ships with `InMemoryStore` for dev/tests; swap to
`pgvector` / Pinecone / Qdrant adapters in production.

***

### threshold?

> `readonly` `optional` **threshold?**: `number`

Defined in: [agentfootprint/src/lib/rag/defineRAG.ts:122](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/rag/defineRAG.ts#L122)

Minimum cosine similarity to inject. **Strict** — when no chunk
meets the threshold, NO injection happens (no fallback that would
pollute the prompt with weak matches). Default 0.7.

Tuning note: 0.7 is a high bar for some embedders. Sentence-BERT
relatives (`all-MiniLM-L6-v2`, etc.) often score 0.4–0.6 even on
relevant chunks. If you see frequent zero-result silent skips,
lower to ~0.5 and observe the `agentfootprint.context.injected`
stream. OpenAI `text-embedding-3-*` and Cohere embed-v3 typically
sit comfortably with 0.7.

***

### topK?

> `readonly` `optional` **topK?**: `number`

Defined in: [agentfootprint/src/lib/rag/defineRAG.ts:108](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/rag/defineRAG.ts#L108)

Top-K chunks to retrieve per turn. Default 3 (balanced —
defends against lost-in-the-middle while giving multiple
perspectives). Increase for richer context, decrease for cost.

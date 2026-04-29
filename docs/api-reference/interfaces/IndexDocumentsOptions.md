[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / IndexDocumentsOptions

# Interface: IndexDocumentsOptions

Defined in: [agentfootprint/src/lib/rag/indexDocuments.ts:44](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/rag/indexDocuments.ts#L44)

## Properties

### embedderId?

> `readonly` `optional` **embedderId?**: `string`

Defined in: [agentfootprint/src/lib/rag/indexDocuments.ts:71](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/rag/indexDocuments.ts#L71)

Stable id of the embedder. Stored on each entry so a future
embedder swap doesn't silently mix similarity scores. Default:
`'default-embedder'` — pass an explicit id when you may rotate
embedders.

***

### identity?

> `readonly` `optional` **identity?**: [`MemoryIdentity`](/agentfootprint/api/generated/interfaces/MemoryIdentity.md)

Defined in: [agentfootprint/src/lib/rag/indexDocuments.ts:63](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/rag/indexDocuments.ts#L63)

Identity scope to write under. Default: a single shared
`{ conversationId: '_global' }` namespace, suitable for app-wide
corpora.

**Multi-tenant footgun:** the read side (`agent.run({ identity })`)
queries within whichever identity is passed at request time.
If you index here under `_global` but query under
`{ tenant: 'acme' }`, you'll get ZERO results — silently. Either:
  1. Index every document under each tenant's identity (duplicated
     storage, but isolated), or
  2. Index under `_global` AND query under `_global` (shared
     corpus across tenants — fine for product docs, NOT for
     tenant-private data), or
  3. Use a vector store adapter that supports multi-namespace
     reads at query time (Pinecone, Qdrant — outside this helper's
     scope).

***

### maxConcurrency?

> `readonly` `optional` **maxConcurrency?**: `number`

Defined in: [agentfootprint/src/lib/rag/indexDocuments.ts:99](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/rag/indexDocuments.ts#L99)

Max number of concurrent embed calls when the embedder doesn't
implement `embedBatch`. Default `8`. Without this cap, a 10K-doc
corpus would fire 10K parallel embed calls and trigger rate limits.
Ignored when `embedBatch` is available (the embedder controls
its own batching).

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [agentfootprint/src/lib/rag/indexDocuments.ts:90](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/rag/indexDocuments.ts#L90)

Optional abort signal — embedders making network calls thread
this through to abort batch indexing on shutdown / timeout.

***

### tier?

> `readonly` `optional` **tier?**: `"hot"` \| `"warm"` \| `"cold"`

Defined in: [agentfootprint/src/lib/rag/indexDocuments.ts:78](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/rag/indexDocuments.ts#L78)

Optional tier tag to attach to indexed entries (`'hot'` /
`'warm'` / `'cold'`). Useful when read-side `defineRAG` should
filter to a subset of the corpus.

***

### ttlMs?

> `readonly` `optional` **ttlMs?**: `number`

Defined in: [agentfootprint/src/lib/rag/indexDocuments.ts:84](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/rag/indexDocuments.ts#L84)

Optional TTL in milliseconds from indexing time. Useful for
compliance retention windows (e.g., re-index quarterly).

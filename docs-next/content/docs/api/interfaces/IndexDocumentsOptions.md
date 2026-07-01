---
title: IndexDocumentsOptions
---

# Interface: IndexDocumentsOptions

Defined in: [src/lib/rag/indexDocuments.ts:45](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/rag/indexDocuments.ts#L45)

## Properties

### embedderId?

> `readonly` `optional` **embedderId?**: `string`

Defined in: [src/lib/rag/indexDocuments.ts:72](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/rag/indexDocuments.ts#L72)

Stable id of the embedder. Stored on each entry so a future
embedder swap doesn't silently mix similarity scores. Default:
`'default-embedder'` — pass an explicit id when you may rotate
embedders.

***

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/lib/rag/indexDocuments.ts:64](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/rag/indexDocuments.ts#L64)

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

Defined in: [src/lib/rag/indexDocuments.ts:100](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/rag/indexDocuments.ts#L100)

Max number of concurrent embed calls when the embedder doesn't
implement `embedBatch`. Default `8`. Without this cap, a 10K-doc
corpus would fire 10K parallel embed calls and trigger rate limits.
Ignored when `embedBatch` is available (the embedder controls
its own batching).

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/lib/rag/indexDocuments.ts:91](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/rag/indexDocuments.ts#L91)

Optional abort signal — embedders making network calls thread
this through to abort batch indexing on shutdown / timeout.

***

### tier?

> `readonly` `optional` **tier?**: `"hot"` \| `"warm"` \| `"cold"`

Defined in: [src/lib/rag/indexDocuments.ts:79](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/rag/indexDocuments.ts#L79)

Optional tier tag to attach to indexed entries (`'hot'` /
`'warm'` / `'cold'`). Useful when read-side `defineRAG` should
filter to a subset of the corpus.

***

### ttlMs?

> `readonly` `optional` **ttlMs?**: `number`

Defined in: [src/lib/rag/indexDocuments.ts:85](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/rag/indexDocuments.ts#L85)

Optional TTL in milliseconds from indexing time. Useful for
compliance retention windows (e.g., re-index quarterly).

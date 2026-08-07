[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / IndexDocumentsOptions

# Interface: IndexDocumentsOptions

Defined in: [src/lib/rag/indexDocuments.ts:45](https://github.com/footprintjs/agentfootprint/blob/6d36ae240cf24d0dcc1b65e0f65dca700a4a788d/src/lib/rag/indexDocuments.ts#L45)

## Properties

### embedderId?

> `readonly` `optional` **embedderId?**: `string`

Defined in: [src/lib/rag/indexDocuments.ts:77](https://github.com/footprintjs/agentfootprint/blob/6d36ae240cf24d0dcc1b65e0f65dca700a4a788d/src/lib/rag/indexDocuments.ts#L77)

Stable id of the embedder. Stored on each entry so a future embedder swap
doesn't silently mix similarity scores.

Defaults to the embedder's own `id` (8.9.0 — every shipped embedder sets
one), and to `'default-embedder'` for a hand-written `Embedder` that has
none. That default matters more with a durable store: it is half of the
`'<id>@<dims>'` fingerprint `sqliteVectorStore` records per vector and
refuses on, so an index built by `staticEmbedder()` will not silently
accept vectors from `openaiEmbedder()`.

***

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/lib/rag/indexDocuments.ts:64](https://github.com/footprintjs/agentfootprint/blob/6d36ae240cf24d0dcc1b65e0f65dca700a4a788d/src/lib/rag/indexDocuments.ts#L64)

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

Defined in: [src/lib/rag/indexDocuments.ts:125](https://github.com/footprintjs/agentfootprint/blob/6d36ae240cf24d0dcc1b65e0f65dca700a4a788d/src/lib/rag/indexDocuments.ts#L125)

Max number of concurrent embed calls when the embedder doesn't
implement `embedBatch`. Default `8`. Without this cap, a 10K-doc
corpus would fire 10K parallel embed calls and trigger rate limits.
Ignored when `embedBatch` is available (the embedder controls
its own batching).

***

### onEmbedding?

> `readonly` `optional` **onEmbedding?**: (`payload`) => `void`

Defined in: [src/lib/rag/indexDocuments.ts:114](https://github.com/footprintjs/agentfootprint/blob/6d36ae240cf24d0dcc1b65e0f65dca700a4a788d/src/lib/rag/indexDocuments.ts#L114)

Called once with the cost of the embedding work this call did (8.9.0).

`indexDocuments` runs at STARTUP, outside any agent run, so it has no
emit channel to ride — there is no scope, no dispatcher and no
`runtimeStageId` to correlate against. Rather than pretend otherwise, it
hands the same payload the in-run stages emit as
`agentfootprint.embedding.generated` straight to you, so the index-time
half of the cost model is reportable from a boot script:

```ts
await indexDocuments(store, embedder, docs, {
  onEmbedding: (e) => console.log(`embedded ${e.count} documents in ${e.durationMs}ms`),
});
```

#### Parameters

##### payload

`EmbeddingGeneratedPayload`

#### Returns

`void`

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/lib/rag/indexDocuments.ts:96](https://github.com/footprintjs/agentfootprint/blob/6d36ae240cf24d0dcc1b65e0f65dca700a4a788d/src/lib/rag/indexDocuments.ts#L96)

Optional abort signal — embedders making network calls thread
this through to abort batch indexing on shutdown / timeout.

***

### tier?

> `readonly` `optional` **tier?**: `"hot"` \| `"warm"` \| `"cold"`

Defined in: [src/lib/rag/indexDocuments.ts:84](https://github.com/footprintjs/agentfootprint/blob/6d36ae240cf24d0dcc1b65e0f65dca700a4a788d/src/lib/rag/indexDocuments.ts#L84)

Optional tier tag to attach to indexed entries (`'hot'` /
`'warm'` / `'cold'`). Useful when read-side `defineRAG` should
filter to a subset of the corpus.

***

### ttlMs?

> `readonly` `optional` **ttlMs?**: `number`

Defined in: [src/lib/rag/indexDocuments.ts:90](https://github.com/footprintjs/agentfootprint/blob/6d36ae240cf24d0dcc1b65e0f65dca700a4a788d/src/lib/rag/indexDocuments.ts#L90)

Optional TTL in milliseconds from indexing time. Useful for
compliance retention windows (e.g., re-index quarterly).

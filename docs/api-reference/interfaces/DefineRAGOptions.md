[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / DefineRAGOptions

# Interface: DefineRAGOptions

Defined in: [src/lib/rag/defineRAG.ts:73](https://github.com/footprintjs/agentfootprint/blob/7e60be4bdc7314eb1aa9110d77f8f728bb948866/src/lib/rag/defineRAG.ts#L73)

## Properties

### description?

> `readonly` `optional` **description?**: `string`

Defined in: [src/lib/rag/defineRAG.ts:82](https://github.com/footprintjs/agentfootprint/blob/7e60be4bdc7314eb1aa9110d77f8f728bb948866/src/lib/rag/defineRAG.ts#L82)

Human-readable description. Surfaces in narrative + Lens hover.
Recommend describing the *corpus* (e.g., "Product documentation
chunks indexed weekly from docs.example.com").

***

### embedder

> `readonly` **embedder**: `Embedder`

Defined in: [src/lib/rag/defineRAG.ts:97](https://github.com/footprintjs/agentfootprint/blob/7e60be4bdc7314eb1aa9110d77f8f728bb948866/src/lib/rag/defineRAG.ts#L97)

Embedder used for the read-side query. Pass the SAME embedder
instance (or one with the same `name`) that was used for indexing
— cross-model similarity scores are not comparable.

***

### embedderId?

> `readonly` `optional` **embedderId?**: `string`

Defined in: [src/lib/rag/defineRAG.ts:104](https://github.com/footprintjs/agentfootprint/blob/7e60be4bdc7314eb1aa9110d77f8f728bb948866/src/lib/rag/defineRAG.ts#L104)

Stable id of the embedder. Stored on entries during indexing
(via `indexDocuments`) and filtered at search time so a later
embedder swap doesn't pollute results.

***

### id

> `readonly` **id**: `string`

Defined in: [src/lib/rag/defineRAG.ts:75](https://github.com/footprintjs/agentfootprint/blob/7e60be4bdc7314eb1aa9110d77f8f728bb948866/src/lib/rag/defineRAG.ts#L75)

Stable id. Becomes the scope-key suffix and the Lens label.

***

### store

> `readonly` **store**: `MemoryStore`

Defined in: [src/lib/rag/defineRAG.ts:90](https://github.com/footprintjs/agentfootprint/blob/7e60be4bdc7314eb1aa9110d77f8f728bb948866/src/lib/rag/defineRAG.ts#L90)

Vector-capable store containing the indexed corpus. Must implement
`search()`. Use `indexDocuments(store, embedder, docs)` at startup
to populate it. Ships with `InMemoryStore` for dev/tests; swap to
`pgvector` / Pinecone / Qdrant adapters in production.

***

### threshold?

> `readonly` `optional` **threshold?**: `number`

Defined in: [src/lib/rag/defineRAG.ts:125](https://github.com/footprintjs/agentfootprint/blob/7e60be4bdc7314eb1aa9110d77f8f728bb948866/src/lib/rag/defineRAG.ts#L125)

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

Defined in: [src/lib/rag/defineRAG.ts:111](https://github.com/footprintjs/agentfootprint/blob/7e60be4bdc7314eb1aa9110d77f8f728bb948866/src/lib/rag/defineRAG.ts#L111)

Top-K chunks to retrieve per turn. Default 3 (balanced —
defends against lost-in-the-middle while giving multiple
perspectives). Increase for richer context, decrease for cost.

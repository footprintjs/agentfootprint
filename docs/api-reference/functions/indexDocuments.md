[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / indexDocuments

# Function: indexDocuments()

> **indexDocuments**(`store`, `embedder`, `documents`, `options?`): `Promise`\<`number`\>

Defined in: [agentfootprint/src/lib/rag/indexDocuments.ts:117](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/rag/indexDocuments.ts#L117)

Embed + persist documents. Returns the count actually indexed
(skips duplicates if the store rejects them). Throws on embedder
failure or store error — fail loud at startup is desirable.

**Re-indexing semantics:** entries are written with `version: 1` and
`putMany` (most adapters: last-write-wins). Re-running this helper
after the store has been mutated by other writers may stomp their
versions. For idempotent corpus refresh, either delete-then-index
or use a custom upsert via `store.putIfVersion()` per document. A
first-class `mode: 'upsert' | 'replace'` API is planned for a
future release.

## Parameters

### store

`MemoryStore`

### embedder

[`Embedder`](/agentfootprint/api/generated/interfaces/Embedder.md)

### documents

readonly [`RagDocument`](/agentfootprint/api/generated/interfaces/RagDocument.md)[]

### options?

[`IndexDocumentsOptions`](/agentfootprint/api/generated/interfaces/IndexDocumentsOptions.md) = `{}`

## Returns

`Promise`\<`number`\>

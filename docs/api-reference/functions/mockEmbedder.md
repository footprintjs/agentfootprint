[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / mockEmbedder

# Function: mockEmbedder()

> **mockEmbedder**(`options?`): [`Embedder`](/agentfootprint/api/generated/interfaces/Embedder.md)

Defined in: [src/memory/embedding/mockEmbedder.ts:34](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/memory/embedding/mockEmbedder.ts#L34)

Build a deterministic mock embedder. Same text always yields the
same vector; texts sharing characters share cosine similarity.

## Parameters

### options?

`MockEmbedderOptions` = `{}`

## Returns

[`Embedder`](/agentfootprint/api/generated/interfaces/Embedder.md)

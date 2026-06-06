[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / mockEmbedder

# Function: mockEmbedder()

> **mockEmbedder**(`options?`): [`Embedder`](/agentfootprint/api/generated/interfaces/Embedder.md)

Defined in: [src/memory/embedding/mockEmbedder.ts:34](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/memory/embedding/mockEmbedder.ts#L34)

Build a deterministic mock embedder. Same text always yields the
same vector; texts sharing characters share cosine similarity.

## Parameters

### options?

`MockEmbedderOptions` = `{}`

## Returns

[`Embedder`](/agentfootprint/api/generated/interfaces/Embedder.md)

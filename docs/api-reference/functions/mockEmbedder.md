[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / mockEmbedder

# Function: mockEmbedder()

> **mockEmbedder**(`options?`): [`Embedder`](/agentfootprint/api/generated/interfaces/Embedder.md)

Defined in: [agentfootprint/src/memory/embedding/mockEmbedder.ts:34](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/memory/embedding/mockEmbedder.ts#L34)

Build a deterministic mock embedder. Same text always yields the
same vector; texts sharing characters share cosine similarity.

## Parameters

### options?

`MockEmbedderOptions` = `{}`

## Returns

[`Embedder`](/agentfootprint/api/generated/interfaces/Embedder.md)

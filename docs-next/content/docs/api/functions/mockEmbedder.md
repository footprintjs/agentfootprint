---
title: mockEmbedder
---

# Function: mockEmbedder()

> **mockEmbedder**(`options?`): [`Embedder`](/docs/api/interfaces/Embedder)

Defined in: [src/memory/embedding/mockEmbedder.ts:34](https://github.com/footprintjs/agentfootprint/blob/main/src/memory/embedding/mockEmbedder.ts#L34)

Build a deterministic mock embedder. Same text always yields the
same vector; texts sharing characters share cosine similarity.

## Parameters

### options?

`MockEmbedderOptions` = `{}`

## Returns

[`Embedder`](/docs/api/interfaces/Embedder)

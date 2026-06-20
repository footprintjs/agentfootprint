---
title: mockEmbedder
---

# Function: mockEmbedder()

> **mockEmbedder**(`options?`): [`Embedder`](/docs/api/interfaces/Embedder)

Defined in: [src/memory/embedding/mockEmbedder.ts:34](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/memory/embedding/mockEmbedder.ts#L34)

Build a deterministic mock embedder. Same text always yields the
same vector; texts sharing characters share cosine similarity.

## Parameters

### options?

`MockEmbedderOptions` = `{}`

## Returns

[`Embedder`](/docs/api/interfaces/Embedder)

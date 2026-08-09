---
title: topK
---

# Function: topK()

> **topK**(`options?`): [`RetrievalStrategy`](/docs/api/interfaces/RetrievalStrategy)

Defined in: [src/memory/retrieval/topK.ts:75](https://github.com/footprintjs/agentfootprint/blob/main/src/memory/retrieval/topK.ts#L75)

Build the top-K strategy.

## Parameters

### options?

[`TopKOptions`](/docs/api/interfaces/TopKOptions) = `{}`

## Returns

[`RetrievalStrategy`](/docs/api/interfaces/RetrievalStrategy)

## Example

```ts
import { defineRAG } from 'agentfootprint';
import { topK } from 'agentfootprint/memory';

const docs = defineRAG({
  id: 'product-docs',
  store, embedder,
  retrieval: topK({ k: 5, threshold: 0.55 }),
});
```

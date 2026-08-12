[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / topK

# Function: topK()

> **topK**(`options?`): [`RetrievalStrategy`](/agentfootprint/api/generated/interfaces/RetrievalStrategy.md)

Defined in: [src/memory/retrieval/topK.ts:75](https://github.com/footprintjs/agentfootprint/blob/a076ce4729494fbee32b8a5fe7f46f567fa9fbe9/src/memory/retrieval/topK.ts#L75)

Build the top-K strategy.

## Parameters

### options?

[`TopKOptions`](/agentfootprint/api/generated/interfaces/TopKOptions.md) = `{}`

## Returns

[`RetrievalStrategy`](/agentfootprint/api/generated/interfaces/RetrievalStrategy.md)

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

---
title: "~~Interface: EmbeddingProvider~~"
---

# ~~Interface: EmbeddingProvider~~

Defined in: [src/adapters/types.ts:585](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L585)

## Deprecated

**Nothing implements or calls this, and nothing ever has.**
It is a second, dead spelling of a live idea. Removed in 10.0.0.

The port the library really uses is `Embedder`
(`memory/embedding/types.ts`, exported from `agentfootprint/memory`):
`{ dimensions, id?, embed({ text }), embedBatch? }`. Every shipped
embedder — `openaiEmbedder`, `localEmbedder`, `staticEmbedder`,
`mockEmbedder` — implements THAT one, and `defineMemory`/`defineRAG`
accept THAT one.

## Properties

### ~~dimension~~

> `readonly` **dimension**: `number`

Defined in: [src/adapters/types.ts:587](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L587)

***

### ~~name~~

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:586](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L586)

## Methods

### ~~embed()~~

> **embed**(`inputs`, `kind`): `Promise`\<`number`[][]\>

Defined in: [src/adapters/types.ts:588](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L588)

#### Parameters

##### inputs

readonly `string`[]

##### kind

`"query"` \| `"document"`

#### Returns

`Promise`\<`number`[][]\>

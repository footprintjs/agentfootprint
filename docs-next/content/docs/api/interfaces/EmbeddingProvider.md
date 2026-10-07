---
title: "~~Interface: EmbeddingProvider~~"
---

# ~~Interface: EmbeddingProvider~~

Defined in: [src/adapters/types.ts:728](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L728)

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

Defined in: [src/adapters/types.ts:730](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L730)

***

### ~~name~~

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:729](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L729)

## Methods

### ~~embed()~~

> **embed**(`inputs`, `kind`): `Promise`\<`number`[][]\>

Defined in: [src/adapters/types.ts:731](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L731)

#### Parameters

##### inputs

readonly `string`[]

##### kind

`"query"` \| `"document"`

#### Returns

`Promise`\<`number`[][]\>

---
title: "~~Interface: EmbeddingProvider~~"
---

# ~~Interface: EmbeddingProvider~~

Defined in: [src/adapters/types.ts:683](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L683)

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

Defined in: [src/adapters/types.ts:685](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L685)

***

### ~~name~~

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:684](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L684)

## Methods

### ~~embed()~~

> **embed**(`inputs`, `kind`): `Promise`\<`number`[][]\>

Defined in: [src/adapters/types.ts:686](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L686)

#### Parameters

##### inputs

readonly `string`[]

##### kind

`"query"` \| `"document"`

#### Returns

`Promise`\<`number`[][]\>

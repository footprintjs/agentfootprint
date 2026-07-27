---
title: EmbeddingProvider
---

# Interface: EmbeddingProvider

Defined in: [src/adapters/types.ts:345](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L345)

## Properties

### dimension

> `readonly` **dimension**: `number`

Defined in: [src/adapters/types.ts:347](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L347)

***

### name

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:346](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L346)

## Methods

### embed()

> **embed**(`inputs`, `kind`): `Promise`\<`number`[][]\>

Defined in: [src/adapters/types.ts:348](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L348)

#### Parameters

##### inputs

readonly `string`[]

##### kind

`"query"` \| `"document"`

#### Returns

`Promise`\<`number`[][]\>

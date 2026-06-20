---
title: EmbeddingProvider
---

# Interface: EmbeddingProvider

Defined in: [src/adapters/types.ts:265](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L265)

## Properties

### dimension

> `readonly` **dimension**: `number`

Defined in: [src/adapters/types.ts:267](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L267)

***

### name

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:266](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L266)

## Methods

### embed()

> **embed**(`inputs`, `kind`): `Promise`\<`number`[][]\>

Defined in: [src/adapters/types.ts:268](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L268)

#### Parameters

##### inputs

readonly `string`[]

##### kind

`"query"` \| `"document"`

#### Returns

`Promise`\<`number`[][]\>

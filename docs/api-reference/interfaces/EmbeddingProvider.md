[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / EmbeddingProvider

# Interface: EmbeddingProvider

Defined in: [src/adapters/types.ts:264](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/adapters/types.ts#L264)

## Properties

### dimension

> `readonly` **dimension**: `number`

Defined in: [src/adapters/types.ts:266](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/adapters/types.ts#L266)

***

### name

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:265](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/adapters/types.ts#L265)

## Methods

### embed()

> **embed**(`inputs`, `kind`): `Promise`\<`number`[][]\>

Defined in: [src/adapters/types.ts:267](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/adapters/types.ts#L267)

#### Parameters

##### inputs

readonly `string`[]

##### kind

`"query"` \| `"document"`

#### Returns

`Promise`\<`number`[][]\>

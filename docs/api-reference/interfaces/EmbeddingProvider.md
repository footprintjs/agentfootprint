[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / EmbeddingProvider

# Interface: EmbeddingProvider

Defined in: [src/adapters/types.ts:483](https://github.com/footprintjs/agentfootprint/blob/da4d9975cc6a2f88b2692e1773dc59434515cc7a/src/adapters/types.ts#L483)

## Properties

### dimension

> `readonly` **dimension**: `number`

Defined in: [src/adapters/types.ts:485](https://github.com/footprintjs/agentfootprint/blob/da4d9975cc6a2f88b2692e1773dc59434515cc7a/src/adapters/types.ts#L485)

***

### name

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:484](https://github.com/footprintjs/agentfootprint/blob/da4d9975cc6a2f88b2692e1773dc59434515cc7a/src/adapters/types.ts#L484)

## Methods

### embed()

> **embed**(`inputs`, `kind`): `Promise`\<`number`[][]\>

Defined in: [src/adapters/types.ts:486](https://github.com/footprintjs/agentfootprint/blob/da4d9975cc6a2f88b2692e1773dc59434515cc7a/src/adapters/types.ts#L486)

#### Parameters

##### inputs

readonly `string`[]

##### kind

`"query"` \| `"document"`

#### Returns

`Promise`\<`number`[][]\>

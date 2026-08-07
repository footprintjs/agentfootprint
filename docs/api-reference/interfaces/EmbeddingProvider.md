[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / EmbeddingProvider

# Interface: EmbeddingProvider

Defined in: [src/adapters/types.ts:483](https://github.com/footprintjs/agentfootprint/blob/35335c51cb97cbd7d2d4de6ef3c2bc69a62d68d5/src/adapters/types.ts#L483)

## Properties

### dimension

> `readonly` **dimension**: `number`

Defined in: [src/adapters/types.ts:485](https://github.com/footprintjs/agentfootprint/blob/35335c51cb97cbd7d2d4de6ef3c2bc69a62d68d5/src/adapters/types.ts#L485)

***

### name

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:484](https://github.com/footprintjs/agentfootprint/blob/35335c51cb97cbd7d2d4de6ef3c2bc69a62d68d5/src/adapters/types.ts#L484)

## Methods

### embed()

> **embed**(`inputs`, `kind`): `Promise`\<`number`[][]\>

Defined in: [src/adapters/types.ts:486](https://github.com/footprintjs/agentfootprint/blob/35335c51cb97cbd7d2d4de6ef3c2bc69a62d68d5/src/adapters/types.ts#L486)

#### Parameters

##### inputs

readonly `string`[]

##### kind

`"query"` \| `"document"`

#### Returns

`Promise`\<`number`[][]\>

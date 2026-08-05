[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / PricingTable

# Interface: PricingTable

Defined in: [src/adapters/types.ts:584](https://github.com/footprintjs/agentfootprint/blob/d630ddc0e0e611e1322ad7092c9a03baa7a88950/src/adapters/types.ts#L584)

## Properties

### name

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:585](https://github.com/footprintjs/agentfootprint/blob/d630ddc0e0e611e1322ad7092c9a03baa7a88950/src/adapters/types.ts#L585)

## Methods

### pricePerToken()

> **pricePerToken**(`model`, `kind`): `number`

Defined in: [src/adapters/types.ts:587](https://github.com/footprintjs/agentfootprint/blob/d630ddc0e0e611e1322ad7092c9a03baa7a88950/src/adapters/types.ts#L587)

USD per ONE token for the given model+kind.

#### Parameters

##### model

`string`

##### kind

[`TokenKind`](/agentfootprint/api/generated/type-aliases/TokenKind.md)

#### Returns

`number`

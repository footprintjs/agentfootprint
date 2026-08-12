[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / PricingTable

# Interface: PricingTable

Defined in: [src/adapters/types.ts:730](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/adapters/types.ts#L730)

## Properties

### name

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:731](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/adapters/types.ts#L731)

## Methods

### pricePerToken()

> **pricePerToken**(`model`, `kind`): `number`

Defined in: [src/adapters/types.ts:733](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/adapters/types.ts#L733)

USD per ONE token for the given model+kind.

#### Parameters

##### model

`string`

##### kind

[`TokenKind`](/agentfootprint/api/generated/type-aliases/TokenKind.md)

#### Returns

`number`

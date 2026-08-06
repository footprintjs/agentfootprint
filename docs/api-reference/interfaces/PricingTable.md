[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / PricingTable

# Interface: PricingTable

Defined in: [src/adapters/types.ts:630](https://github.com/footprintjs/agentfootprint/blob/7e60be4bdc7314eb1aa9110d77f8f728bb948866/src/adapters/types.ts#L630)

## Properties

### name

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:631](https://github.com/footprintjs/agentfootprint/blob/7e60be4bdc7314eb1aa9110d77f8f728bb948866/src/adapters/types.ts#L631)

## Methods

### pricePerToken()

> **pricePerToken**(`model`, `kind`): `number`

Defined in: [src/adapters/types.ts:633](https://github.com/footprintjs/agentfootprint/blob/7e60be4bdc7314eb1aa9110d77f8f728bb948866/src/adapters/types.ts#L633)

USD per ONE token for the given model+kind.

#### Parameters

##### model

`string`

##### kind

[`TokenKind`](/agentfootprint/api/generated/type-aliases/TokenKind.md)

#### Returns

`number`

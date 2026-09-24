[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ServerToolEntry

# Interface: ServerToolEntry

Defined in: [src/core/toolContract.ts:38](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/toolContract.ts#L38)

A server-catalog entry — the shape of one item from `GET /tools`.

## Properties

### inputSchema?

> `readonly` `optional` **inputSchema?**: `object`

Defined in: [src/core/toolContract.ts:40](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/toolContract.ts#L40)

#### properties?

> `readonly` `optional` **properties?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

#### required?

> `readonly` `optional` **required?**: readonly `string`[]

***

### name

> `readonly` **name**: `string`

Defined in: [src/core/toolContract.ts:39](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/toolContract.ts#L39)

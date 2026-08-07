[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ServerToolEntry

# Interface: ServerToolEntry

Defined in: [src/core/toolContract.ts:38](https://github.com/footprintjs/agentfootprint/blob/455f6597240fc141458c0e86e6b1fbf49ea37d98/src/core/toolContract.ts#L38)

A server-catalog entry — the shape of one item from `GET /tools`.

## Properties

### inputSchema?

> `readonly` `optional` **inputSchema?**: `object`

Defined in: [src/core/toolContract.ts:40](https://github.com/footprintjs/agentfootprint/blob/455f6597240fc141458c0e86e6b1fbf49ea37d98/src/core/toolContract.ts#L40)

#### properties?

> `readonly` `optional` **properties?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

#### required?

> `readonly` `optional` **required?**: readonly `string`[]

***

### name

> `readonly` **name**: `string`

Defined in: [src/core/toolContract.ts:39](https://github.com/footprintjs/agentfootprint/blob/455f6597240fc141458c0e86e6b1fbf49ea37d98/src/core/toolContract.ts#L39)

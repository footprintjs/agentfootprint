[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RiskDetector

# Interface: RiskDetector

Defined in: [src/adapters/types.ts:511](https://github.com/footprintjs/agentfootprint/blob/da6095f057eb2f2b7ab8d6ad464a4cbde8688032/src/adapters/types.ts#L511)

## Properties

### name

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:512](https://github.com/footprintjs/agentfootprint/blob/da6095f057eb2f2b7ab8d6ad464a4cbde8688032/src/adapters/types.ts#L512)

## Methods

### check()

> **check**(`content`, `context`): `Promise`\<[`RiskResult`](/agentfootprint/api/generated/interfaces/RiskResult.md)\>

Defined in: [src/adapters/types.ts:513](https://github.com/footprintjs/agentfootprint/blob/da6095f057eb2f2b7ab8d6ad464a4cbde8688032/src/adapters/types.ts#L513)

#### Parameters

##### content

`string`

##### context

[`RiskContext`](/agentfootprint/api/generated/interfaces/RiskContext.md)

#### Returns

`Promise`\<[`RiskResult`](/agentfootprint/api/generated/interfaces/RiskResult.md)\>

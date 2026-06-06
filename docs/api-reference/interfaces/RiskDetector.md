[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RiskDetector

# Interface: RiskDetector

Defined in: [src/adapters/types.ts:293](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/adapters/types.ts#L293)

## Properties

### name

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:294](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/adapters/types.ts#L294)

## Methods

### check()

> **check**(`content`, `context`): `Promise`\<[`RiskResult`](/agentfootprint/api/generated/interfaces/RiskResult.md)\>

Defined in: [src/adapters/types.ts:295](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/adapters/types.ts#L295)

#### Parameters

##### content

`string`

##### context

[`RiskContext`](/agentfootprint/api/generated/interfaces/RiskContext.md)

#### Returns

`Promise`\<[`RiskResult`](/agentfootprint/api/generated/interfaces/RiskResult.md)\>

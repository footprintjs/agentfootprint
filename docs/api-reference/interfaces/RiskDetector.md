[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RiskDetector

# Interface: RiskDetector

Defined in: [src/adapters/types.ts:465](https://github.com/footprintjs/agentfootprint/blob/d630ddc0e0e611e1322ad7092c9a03baa7a88950/src/adapters/types.ts#L465)

## Properties

### name

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:466](https://github.com/footprintjs/agentfootprint/blob/d630ddc0e0e611e1322ad7092c9a03baa7a88950/src/adapters/types.ts#L466)

## Methods

### check()

> **check**(`content`, `context`): `Promise`\<[`RiskResult`](/agentfootprint/api/generated/interfaces/RiskResult.md)\>

Defined in: [src/adapters/types.ts:467](https://github.com/footprintjs/agentfootprint/blob/d630ddc0e0e611e1322ad7092c9a03baa7a88950/src/adapters/types.ts#L467)

#### Parameters

##### content

`string`

##### context

[`RiskContext`](/agentfootprint/api/generated/interfaces/RiskContext.md)

#### Returns

`Promise`\<[`RiskResult`](/agentfootprint/api/generated/interfaces/RiskResult.md)\>

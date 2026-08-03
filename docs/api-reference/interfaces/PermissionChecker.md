[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / PermissionChecker

# Interface: PermissionChecker

Defined in: [src/adapters/types.ts:501](https://github.com/footprintjs/agentfootprint/blob/6d7498c2fc112b3787418f14708897a47e933fd6/src/adapters/types.ts#L501)

## Properties

### name

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:502](https://github.com/footprintjs/agentfootprint/blob/6d7498c2fc112b3787418f14708897a47e933fd6/src/adapters/types.ts#L502)

## Methods

### check()

> **check**(`request`): [`PermissionDecision`](/agentfootprint/api/generated/interfaces/PermissionDecision.md) \| `Promise`\<[`PermissionDecision`](/agentfootprint/api/generated/interfaces/PermissionDecision.md)\>

Defined in: [src/adapters/types.ts:503](https://github.com/footprintjs/agentfootprint/blob/6d7498c2fc112b3787418f14708897a47e933fd6/src/adapters/types.ts#L503)

#### Parameters

##### request

[`PermissionRequest`](/agentfootprint/api/generated/interfaces/PermissionRequest.md)

#### Returns

[`PermissionDecision`](/agentfootprint/api/generated/interfaces/PermissionDecision.md) \| `Promise`\<[`PermissionDecision`](/agentfootprint/api/generated/interfaces/PermissionDecision.md)\>

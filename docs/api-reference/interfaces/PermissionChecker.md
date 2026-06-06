[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / PermissionChecker

# Interface: PermissionChecker

Defined in: [src/adapters/types.ts:402](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/adapters/types.ts#L402)

## Properties

### name

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:403](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/adapters/types.ts#L403)

## Methods

### check()

> **check**(`request`): [`PermissionDecision`](/agentfootprint/api/generated/interfaces/PermissionDecision.md) \| `Promise`\<[`PermissionDecision`](/agentfootprint/api/generated/interfaces/PermissionDecision.md)\>

Defined in: [src/adapters/types.ts:404](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/adapters/types.ts#L404)

#### Parameters

##### request

[`PermissionRequest`](/agentfootprint/api/generated/interfaces/PermissionRequest.md)

#### Returns

[`PermissionDecision`](/agentfootprint/api/generated/interfaces/PermissionDecision.md) \| `Promise`\<[`PermissionDecision`](/agentfootprint/api/generated/interfaces/PermissionDecision.md)\>

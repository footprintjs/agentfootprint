[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / PermissionChecker

# Interface: PermissionChecker

Defined in: [src/adapters/types.ts:621](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/adapters/types.ts#L621)

## Properties

### name

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:622](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/adapters/types.ts#L622)

## Methods

### check()

> **check**(`request`): [`PermissionDecision`](/agentfootprint/api/generated/interfaces/PermissionDecision.md) \| `Promise`\<[`PermissionDecision`](/agentfootprint/api/generated/interfaces/PermissionDecision.md)\>

Defined in: [src/adapters/types.ts:623](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/adapters/types.ts#L623)

#### Parameters

##### request

[`PermissionRequest`](/agentfootprint/api/generated/interfaces/PermissionRequest.md)

#### Returns

[`PermissionDecision`](/agentfootprint/api/generated/interfaces/PermissionDecision.md) \| `Promise`\<[`PermissionDecision`](/agentfootprint/api/generated/interfaces/PermissionDecision.md)\>

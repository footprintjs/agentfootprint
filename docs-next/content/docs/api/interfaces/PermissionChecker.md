---
title: PermissionChecker
---

# Interface: PermissionChecker

Defined in: [src/adapters/types.ts:621](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L621)

## Properties

### name

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:622](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L622)

## Methods

### check()

> **check**(`request`): [`PermissionDecision`](/docs/api/interfaces/PermissionDecision) \| `Promise`\<[`PermissionDecision`](/docs/api/interfaces/PermissionDecision)\>

Defined in: [src/adapters/types.ts:623](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L623)

#### Parameters

##### request

[`PermissionRequest`](/docs/api/interfaces/PermissionRequest)

#### Returns

[`PermissionDecision`](/docs/api/interfaces/PermissionDecision) \| `Promise`\<[`PermissionDecision`](/docs/api/interfaces/PermissionDecision)\>

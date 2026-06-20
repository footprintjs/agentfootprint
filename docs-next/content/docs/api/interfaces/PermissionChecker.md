---
title: PermissionChecker
---

# Interface: PermissionChecker

Defined in: [src/adapters/types.ts:403](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L403)

## Properties

### name

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:404](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L404)

## Methods

### check()

> **check**(`request`): [`PermissionDecision`](/docs/api/interfaces/PermissionDecision) \| `Promise`\<[`PermissionDecision`](/docs/api/interfaces/PermissionDecision)\>

Defined in: [src/adapters/types.ts:405](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L405)

#### Parameters

##### request

[`PermissionRequest`](/docs/api/interfaces/PermissionRequest)

#### Returns

[`PermissionDecision`](/docs/api/interfaces/PermissionDecision) \| `Promise`\<[`PermissionDecision`](/docs/api/interfaces/PermissionDecision)\>

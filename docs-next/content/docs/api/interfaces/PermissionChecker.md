---
title: PermissionChecker
---

# Interface: PermissionChecker

Defined in: [src/adapters/types.ts:575](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L575)

## Properties

### name

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:576](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L576)

## Methods

### check()

> **check**(`request`): [`PermissionDecision`](/docs/api/interfaces/PermissionDecision) \| `Promise`\<[`PermissionDecision`](/docs/api/interfaces/PermissionDecision)\>

Defined in: [src/adapters/types.ts:577](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L577)

#### Parameters

##### request

[`PermissionRequest`](/docs/api/interfaces/PermissionRequest)

#### Returns

[`PermissionDecision`](/docs/api/interfaces/PermissionDecision) \| `Promise`\<[`PermissionDecision`](/docs/api/interfaces/PermissionDecision)\>

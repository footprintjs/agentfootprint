---
title: PermissionChecker
---

# Interface: PermissionChecker

Defined in: [src/adapters/types.ts:501](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L501)

## Properties

### name

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:502](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L502)

## Methods

### check()

> **check**(`request`): [`PermissionDecision`](/docs/api/interfaces/PermissionDecision) \| `Promise`\<[`PermissionDecision`](/docs/api/interfaces/PermissionDecision)\>

Defined in: [src/adapters/types.ts:503](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L503)

#### Parameters

##### request

[`PermissionRequest`](/docs/api/interfaces/PermissionRequest)

#### Returns

[`PermissionDecision`](/docs/api/interfaces/PermissionDecision) \| `Promise`\<[`PermissionDecision`](/docs/api/interfaces/PermissionDecision)\>

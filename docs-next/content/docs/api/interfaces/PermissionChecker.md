---
title: PermissionChecker
---

# Interface: PermissionChecker

Defined in: [src/adapters/types.ts:483](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L483)

## Properties

### name

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:484](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L484)

## Methods

### check()

> **check**(`request`): [`PermissionDecision`](/docs/api/interfaces/PermissionDecision) \| `Promise`\<[`PermissionDecision`](/docs/api/interfaces/PermissionDecision)\>

Defined in: [src/adapters/types.ts:485](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L485)

#### Parameters

##### request

[`PermissionRequest`](/docs/api/interfaces/PermissionRequest)

#### Returns

[`PermissionDecision`](/docs/api/interfaces/PermissionDecision) \| `Promise`\<[`PermissionDecision`](/docs/api/interfaces/PermissionDecision)\>

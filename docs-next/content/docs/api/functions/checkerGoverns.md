---
title: checkerGoverns
---

# Function: checkerGoverns()

> **checkerGoverns**(`checker`, `capability`): `boolean`

Defined in: [src/adapters/types.ts:835](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L835)

Does this checker ask to be consulted about `capability`? (9.11.0)

`'tool_call'` is always true — it has been enforced since v2.4 and needs no
declaration. Everything else is true only when the checker named it.
Absence is NO.

## Parameters

### checker

[`PermissionChecker`](/docs/api/interfaces/PermissionChecker) \| `undefined`

### capability

[`PermissionCapability`](/docs/api/type-aliases/PermissionCapability)

## Returns

`boolean`

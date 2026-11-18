---
title: checkerGoverns
---

# Function: checkerGoverns()

> **checkerGoverns**(`checker`, `capability`): `boolean`

Defined in: [src/provider-contract/types.ts:982](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L982)

Is this checker asked about `capability`? (9.11.0) `'tool_call'`: always, enforced since v2.4, no declaration needed. Anything else: only when the checker named it in `governs`; absence is NO.

## Parameters

### checker

[`PermissionChecker`](/docs/api/interfaces/PermissionChecker) \| `undefined`

### capability

[`PermissionCapability`](/docs/api/type-aliases/PermissionCapability)

## Returns

`boolean`

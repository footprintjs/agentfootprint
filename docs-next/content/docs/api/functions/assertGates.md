---
title: assertGates
---

# Function: assertGates()

> **assertGates**(`toolName`, `gates`): `void`

Defined in: [src/core/tools.ts:667](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L667)

Refuse a `gates` declaration that is not a boolean, at definition time.
Trivial for anyone the compiler vets; load-bearing at the MCP ingest
boundary, where a foreign server can put anything under the key and a
truthy string would silently declare a gate nobody wrote.

## Parameters

### toolName

`string`

### gates

`boolean` \| `undefined`

## Returns

`void`

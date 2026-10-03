---
title: timeAxisIssues
---

# Function: timeAxisIssues()

> **timeAxisIssues**(`value`): `string`[]

Defined in: [src/core/time/axis.ts:141](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/axis.ts#L141)

THE ONE JUDGE of a time-axis declaration. Returns every problem, in words a
producer can act on; an empty list means the declaration is well-formed.
Never throws, never repairs, never reads a value.

## Parameters

### value

`unknown`

## Returns

`string`[]

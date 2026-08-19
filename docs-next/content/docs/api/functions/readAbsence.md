---
title: readAbsence
---

# Function: readAbsence()

> **readAbsence**(`value`): [`ToolAbsence`](/docs/api/interfaces/ToolAbsence) \| `undefined`

Defined in: [src/core/agent/coverage/absent.ts:152](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/absent.ts#L152)

Recognize (or decline to recognize) a value as an absence — STRICT, and the
strictness is the zero-cost guarantee. Only a plain object whose
`af_absent` is exactly `true` and whose `checked` is a non-empty array
qualifies; every other value any tool has ever returned takes the path it
always took, byte for byte.

`undefined` means "not an absence", never "a malformed one" — this library
does not guess at a shape it did not mint.

## Parameters

### value

`unknown`

## Returns

[`ToolAbsence`](/docs/api/interfaces/ToolAbsence) \| `undefined`

[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / readAbsence

# Function: readAbsence()

> **readAbsence**(`value`): [`ToolAbsence`](/agentfootprint/api/generated/interfaces/ToolAbsence.md) \| `undefined`

Defined in: [src/core/agent/coverage/absent.ts:307](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/coverage/absent.ts#L307)

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

[`ToolAbsence`](/agentfootprint/api/generated/interfaces/ToolAbsence.md) \| `undefined`

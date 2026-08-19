[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / readToolResultEnvelope

# Function: readToolResultEnvelope()

> **readToolResultEnvelope**(`result`): [`ReadToolResultEnvelope`](/agentfootprint/api/generated/interfaces/ReadToolResultEnvelope.md) \| `undefined`

Defined in: [src/core/agent/toolEffects.ts:145](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/agent/toolEffects.ts#L145)

Recognize (or decline to recognize) a tool's return value as an effects
envelope. `undefined` = not an envelope: the caller keeps today's path
untouched. See the module header for the exact recognition rule and why
it is strict.

## Parameters

### result

`unknown`

## Returns

[`ReadToolResultEnvelope`](/agentfootprint/api/generated/interfaces/ReadToolResultEnvelope.md) \| `undefined`

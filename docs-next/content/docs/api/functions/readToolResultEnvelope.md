---
title: readToolResultEnvelope
---

# Function: readToolResultEnvelope()

> **readToolResultEnvelope**(`result`): [`ReadToolResultEnvelope`](/docs/api/interfaces/ReadToolResultEnvelope) \| `undefined`

Defined in: [src/core/agent/toolEffects.ts:145](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/toolEffects.ts#L145)

Recognize (or decline to recognize) a tool's return value as an effects
envelope. `undefined` = not an envelope: the caller keeps today's path
untouched. See the module header for the exact recognition rule and why
it is strict.

## Parameters

### result

`unknown`

## Returns

[`ReadToolResultEnvelope`](/docs/api/interfaces/ReadToolResultEnvelope) \| `undefined`

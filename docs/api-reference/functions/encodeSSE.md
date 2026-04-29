[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / encodeSSE

# Function: encodeSSE()

> **encodeSSE**(`eventName`, `payload`): `string`

Defined in: [agentfootprint/src/stream.ts:169](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/stream.ts#L169)

Format any JSON-able payload as a single SSE event chunk.

Useful for app-level events outside the runner's typed registry
(auth/error frames, app-state echoes). Most consumers won't need this.

## Parameters

### eventName

`string`

### payload

`unknown`

## Returns

`string`

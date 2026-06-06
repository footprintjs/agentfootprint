[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / encodeSSE

# Function: encodeSSE()

> **encodeSSE**(`eventName`, `payload`): `string`

Defined in: [src/stream.ts:171](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/stream.ts#L171)

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

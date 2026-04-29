[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LoggingLogger

# Interface: LoggingLogger

Defined in: [agentfootprint/src/recorders/observability/LoggingRecorder.ts:22](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/LoggingRecorder.ts#L22)

Minimal logger shape — structurally compatible with console, winston,
pino, etc. Consumers pass their existing logger.

## Methods

### log()

> **log**(`message`, `data?`): `void`

Defined in: [agentfootprint/src/recorders/observability/LoggingRecorder.ts:23](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/LoggingRecorder.ts#L23)

#### Parameters

##### message

`string`

##### data?

`unknown`

#### Returns

`void`

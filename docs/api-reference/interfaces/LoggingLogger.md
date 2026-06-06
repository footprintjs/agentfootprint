[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LoggingLogger

# Interface: LoggingLogger

Defined in: [src/recorders/observability/LoggingRecorder.ts:22](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/LoggingRecorder.ts#L22)

Minimal logger shape — structurally compatible with console, winston,
pino, etc. Consumers pass their existing logger.

## Methods

### log()

> **log**(`message`, `data?`): `void`

Defined in: [src/recorders/observability/LoggingRecorder.ts:23](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/LoggingRecorder.ts#L23)

#### Parameters

##### message

`string`

##### data?

`unknown`

#### Returns

`void`

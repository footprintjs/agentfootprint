[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LoggingLogger

# Interface: LoggingLogger

Defined in: [src/recorders/observability/LoggingRecorder.ts:25](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LoggingRecorder.ts#L25)

Minimal logger shape — structurally compatible with console, winston,
pino, etc. Consumers pass their existing logger.

## Methods

### log()

> **log**(`message`, `data?`): `void`

Defined in: [src/recorders/observability/LoggingRecorder.ts:26](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LoggingRecorder.ts#L26)

#### Parameters

##### message

`string`

##### data?

`unknown`

#### Returns

`void`

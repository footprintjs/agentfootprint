[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LoggingOptions

# Interface: LoggingOptions

Defined in: [src/recorders/observability/LoggingRecorder.ts:77](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/LoggingRecorder.ts#L77)

## Properties

### domains?

> `readonly` `optional` **domains?**: readonly [`LoggingDomain`](/agentfootprint/api/generated/type-aliases/LoggingDomain.md)[] \| `"all"`

Defined in: [src/recorders/observability/LoggingRecorder.ts:85](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/LoggingRecorder.ts#L85)

Domains to log. Pass `'all'` for firehose (including consumer custom
events). Default: `['context', 'stream']` — the core debugging lens
(what went into the LLM, what came out).

***

### format?

> `readonly` `optional` **format?**: (`event`) => `string`

Defined in: [src/recorders/observability/LoggingRecorder.ts:87](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/LoggingRecorder.ts#L87)

Custom formatter. Default: `[domain.action]`.

#### Parameters

##### event

[`AgentfootprintEvent`](/agentfootprint/api/generated/type-aliases/AgentfootprintEvent.md)

#### Returns

`string`

***

### logger?

> `readonly` `optional` **logger?**: [`LoggingLogger`](/agentfootprint/api/generated/interfaces/LoggingLogger.md)

Defined in: [src/recorders/observability/LoggingRecorder.ts:79](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/LoggingRecorder.ts#L79)

Logger sink. Defaults to console.

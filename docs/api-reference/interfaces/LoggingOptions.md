[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LoggingOptions

# Interface: LoggingOptions

Defined in: [src/recorders/observability/LoggingRecorder.ts:80](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LoggingRecorder.ts#L80)

## Properties

### domains?

> `readonly` `optional` **domains?**: readonly [`LoggingDomain`](/agentfootprint/api/generated/type-aliases/LoggingDomain.md)[] \| `"all"`

Defined in: [src/recorders/observability/LoggingRecorder.ts:88](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LoggingRecorder.ts#L88)

Domains to log. Pass `'all'` for firehose (including consumer custom
events). Default: `['context', 'stream']` — the core debugging lens
(what went into the LLM, what came out).

***

### format?

> `readonly` `optional` **format?**: (`event`) => `string`

Defined in: [src/recorders/observability/LoggingRecorder.ts:90](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LoggingRecorder.ts#L90)

Custom formatter. Default: `[domain.action]`.

#### Parameters

##### event

[`AgentfootprintEvent`](/agentfootprint/api/generated/type-aliases/AgentfootprintEvent.md)

#### Returns

`string`

***

### logger?

> `readonly` `optional` **logger?**: [`LoggingLogger`](/agentfootprint/api/generated/interfaces/LoggingLogger.md)

Defined in: [src/recorders/observability/LoggingRecorder.ts:82](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LoggingRecorder.ts#L82)

Logger sink. Defaults to console.

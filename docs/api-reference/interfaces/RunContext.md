[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RunContext

# Interface: RunContext

Defined in: [agentfootprint/src/bridge/eventMeta.ts:35](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/bridge/eventMeta.ts#L35)

## Properties

### compositionPath

> `readonly` **compositionPath**: readonly `string`[]

Defined in: [agentfootprint/src/bridge/eventMeta.ts:45](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/bridge/eventMeta.ts#L45)

Composition ancestry path (e.g. ['Sequence:bot', 'Agent:classify']).

***

### correlationId?

> `readonly` `optional` **correlationId?**: `string`

Defined in: [agentfootprint/src/bridge/eventMeta.ts:43](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/bridge/eventMeta.ts#L43)

Optional correlation id for cross-event tying (retrieval→injection→LLM).

***

### iterIndex?

> `readonly` `optional` **iterIndex?**: `number`

Defined in: [agentfootprint/src/bridge/eventMeta.ts:48](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/bridge/eventMeta.ts#L48)

***

### runId

> `readonly` **runId**: `string`

Defined in: [agentfootprint/src/bridge/eventMeta.ts:39](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/bridge/eventMeta.ts#L39)

Unique run id (demultiplex concurrent runs sharing one dispatcher).

***

### runStartMs

> `readonly` **runStartMs**: `number`

Defined in: [agentfootprint/src/bridge/eventMeta.ts:37](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/bridge/eventMeta.ts#L37)

Millisecond wall-clock timestamp when the run started.

***

### traceId?

> `readonly` `optional` **traceId?**: `string`

Defined in: [agentfootprint/src/bridge/eventMeta.ts:41](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/bridge/eventMeta.ts#L41)

Optional OTEL trace id forwarded from executor.run({ env: { traceId } }).

***

### turnIndex?

> `readonly` `optional` **turnIndex?**: `number`

Defined in: [agentfootprint/src/bridge/eventMeta.ts:47](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/bridge/eventMeta.ts#L47)

Optional turn/iter indices from agent runtime.

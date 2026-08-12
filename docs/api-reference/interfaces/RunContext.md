[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RunContext

# Interface: RunContext

Defined in: [src/bridge/eventMeta.ts:35](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/bridge/eventMeta.ts#L35)

## Properties

### compositionPath

> `readonly` **compositionPath**: readonly `string`[]

Defined in: [src/bridge/eventMeta.ts:45](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/bridge/eventMeta.ts#L45)

Composition ancestry path (e.g. ['Sequence:bot', 'Agent:classify']).

***

### correlationId?

> `readonly` `optional` **correlationId?**: `string`

Defined in: [src/bridge/eventMeta.ts:43](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/bridge/eventMeta.ts#L43)

Optional correlation id for cross-event tying (retrieval→injection→LLM).

***

### iterIndex?

> `readonly` `optional` **iterIndex?**: `number`

Defined in: [src/bridge/eventMeta.ts:48](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/bridge/eventMeta.ts#L48)

***

### principal?

> `readonly` `optional` **principal?**: `string`

Defined in: [src/bridge/eventMeta.ts:55](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/bridge/eventMeta.ts#L55)

WHO the caller NAMED for this run (9.11.0) — from an explicit
 `run({ identity })` only, never from the synthesized `runIdentity` and
 never derived from a session. Absent for an anonymous run.

***

### runId

> `readonly` **runId**: `string`

Defined in: [src/bridge/eventMeta.ts:39](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/bridge/eventMeta.ts#L39)

Unique run id (demultiplex concurrent runs sharing one dispatcher).

***

### runStartMs

> `readonly` **runStartMs**: `number`

Defined in: [src/bridge/eventMeta.ts:37](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/bridge/eventMeta.ts#L37)

Millisecond wall-clock timestamp when the run started.

***

### sessionId?

> `readonly` `optional` **sessionId?**: `string`

Defined in: [src/bridge/eventMeta.ts:51](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/bridge/eventMeta.ts#L51)

The hosting conversation this run belongs to, when it belongs to one
 (9.4.0). Absent for an unhosted or anonymous run — never fabricated.

***

### tenant?

> `readonly` `optional` **tenant?**: `string`

Defined in: [src/bridge/eventMeta.ts:58](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/bridge/eventMeta.ts#L58)

The tenant the caller NAMED for this run (9.11.0). Same rule as
 [RunContext.principal](/agentfootprint/api/generated/interfaces/RunContext.md#principal).

***

### traceId?

> `readonly` `optional` **traceId?**: `string`

Defined in: [src/bridge/eventMeta.ts:41](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/bridge/eventMeta.ts#L41)

Optional OTEL trace id forwarded from executor.run({ env: { traceId } }).

***

### turnIndex?

> `readonly` `optional` **turnIndex?**: `number`

Defined in: [src/bridge/eventMeta.ts:47](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/bridge/eventMeta.ts#L47)

Optional turn/iter indices from agent runtime.

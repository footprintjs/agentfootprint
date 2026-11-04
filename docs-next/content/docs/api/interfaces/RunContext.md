---
title: RunContext
---

# Interface: RunContext

Defined in: [src/bridge/eventMeta.ts:41](https://github.com/footprintjs/agentfootprint/blob/main/src/bridge/eventMeta.ts#L41)

## Properties

### compositionPath

> `readonly` **compositionPath**: readonly `string`[]

Defined in: [src/bridge/eventMeta.ts:51](https://github.com/footprintjs/agentfootprint/blob/main/src/bridge/eventMeta.ts#L51)

Composition ancestry path (e.g. ['Sequence:bot', 'Agent:classify']).

***

### correlationId?

> `readonly` `optional` **correlationId?**: `string`

Defined in: [src/bridge/eventMeta.ts:49](https://github.com/footprintjs/agentfootprint/blob/main/src/bridge/eventMeta.ts#L49)

Optional correlation id for cross-event tying (retrieval→injection→LLM).

***

### iterIndex?

> `readonly` `optional` **iterIndex?**: `number`

Defined in: [src/bridge/eventMeta.ts:54](https://github.com/footprintjs/agentfootprint/blob/main/src/bridge/eventMeta.ts#L54)

***

### principal?

> `readonly` `optional` **principal?**: `string`

Defined in: [src/bridge/eventMeta.ts:61](https://github.com/footprintjs/agentfootprint/blob/main/src/bridge/eventMeta.ts#L61)

WHO the caller NAMED for this run (9.11.0) — from an explicit
 `run({ identity })` only, never from the synthesized `runIdentity` and
 never derived from a session. Absent for an anonymous run.

***

### runId

> `readonly` **runId**: `string`

Defined in: [src/bridge/eventMeta.ts:45](https://github.com/footprintjs/agentfootprint/blob/main/src/bridge/eventMeta.ts#L45)

Unique run id (demultiplex concurrent runs sharing one dispatcher).

***

### runStartMs

> `readonly` **runStartMs**: `number`

Defined in: [src/bridge/eventMeta.ts:43](https://github.com/footprintjs/agentfootprint/blob/main/src/bridge/eventMeta.ts#L43)

Millisecond wall-clock timestamp when the run started.

***

### sessionId?

> `readonly` `optional` **sessionId?**: `string`

Defined in: [src/bridge/eventMeta.ts:57](https://github.com/footprintjs/agentfootprint/blob/main/src/bridge/eventMeta.ts#L57)

The hosting conversation this run belongs to, when it belongs to one
 (9.4.0). Absent for an unhosted or anonymous run — never fabricated.

***

### tenant?

> `readonly` `optional` **tenant?**: `string`

Defined in: [src/bridge/eventMeta.ts:64](https://github.com/footprintjs/agentfootprint/blob/main/src/bridge/eventMeta.ts#L64)

The tenant the caller NAMED for this run (9.11.0). Same rule as
 [RunContext.principal](/docs/api/interfaces/RunContext#principal).

***

### traceId?

> `readonly` `optional` **traceId?**: `string`

Defined in: [src/bridge/eventMeta.ts:47](https://github.com/footprintjs/agentfootprint/blob/main/src/bridge/eventMeta.ts#L47)

Optional OTEL trace id forwarded from executor.run({ env: { traceId } }).

***

### turnIndex?

> `readonly` `optional` **turnIndex?**: `number`

Defined in: [src/bridge/eventMeta.ts:53](https://github.com/footprintjs/agentfootprint/blob/main/src/bridge/eventMeta.ts#L53)

Optional turn/iter indices from agent runtime.

[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / BoundaryAggregate

# Interface: BoundaryAggregate

Defined in: [src/recorders/observability/BoundaryRecorder.ts:335](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/BoundaryRecorder.ts#L335)

Per-boundary rollup returned by
`BoundaryRecorder.aggregateForBoundary` and
`BoundaryRecorder.aggregateAllBoundaries`. Same shape regardless of
primitive kind — UIs render the same chip set for every Agent /
LLMCall / Sequence / Parallel / Conditional / Loop.

Events count toward this rollup when their `subflowPath` is a
prefix-match of the boundary's `subflowPath`. Nested boundaries
(e.g., LLMCall inside an Agent) contribute to BOTH rollups.

In-flight boundaries (no `subflow.exit` yet) get partial values;
`endedAtMs` and `durationMs` are undefined until close.

## Properties

### durationMs?

> `readonly` `optional` **durationMs?**: `number`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:361](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/BoundaryRecorder.ts#L361)

`endedAtMs - startedAtMs`. Undefined while in flight.

***

### endedAtMs?

> `readonly` `optional` **endedAtMs?**: `number`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:359](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/BoundaryRecorder.ts#L359)

Wall-clock ms of `subflow.exit`. Undefined while in flight.

***

### iterations

> `readonly` **iterations**: `number`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:355](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/BoundaryRecorder.ts#L355)

Count of `agent.iteration_start` events scoped to this boundary —
 ReAct-loop iterations. Always `0` for non-Agent primitives.

***

### label

> `readonly` **label**: `string`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:346](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/BoundaryRecorder.ts#L346)

Subflow display name (e.g., 'Triage', 'Billing').

***

### llmCalls

> `readonly` **llmCalls**: `number`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:350](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/BoundaryRecorder.ts#L350)

Count of `llm.start` events inside this boundary.

***

### primitiveKind?

> `readonly` `optional` **primitiveKind?**: `string`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:344](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/BoundaryRecorder.ts#L344)

`'Agent'` / `'LLMCall'` / `'Sequence'` / `'Parallel'` /
 `'Conditional'` / `'Loop'`. Always set on rollups returned by
 `aggregateAllBoundaries` (which filters to primitive boundaries).
 Optional on `aggregateForBoundary` results because the caller may
 request rollup for a non-primitive subflow (rare).

***

### runtimeStageId

> `readonly` **runtimeStageId**: `string`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:336](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/BoundaryRecorder.ts#L336)

***

### startedAtMs

> `readonly` **startedAtMs**: `number`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:357](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/BoundaryRecorder.ts#L357)

Wall-clock ms of `subflow.entry`.

***

### subflowId

> `readonly` **subflowId**: `string`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:337](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/BoundaryRecorder.ts#L337)

***

### subflowPath

> `readonly` **subflowPath**: readonly `string`[]

Defined in: [src/recorders/observability/BoundaryRecorder.ts:338](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/BoundaryRecorder.ts#L338)

***

### tokens

> `readonly` **tokens**: `object`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:348](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/BoundaryRecorder.ts#L348)

Token usage summed across every `llm.end` inside this boundary.

#### input

> `readonly` **input**: `number`

#### output

> `readonly` **output**: `number`

***

### toolCalls

> `readonly` **toolCalls**: `number`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:352](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/BoundaryRecorder.ts#L352)

Count of `tool.start` events inside this boundary.

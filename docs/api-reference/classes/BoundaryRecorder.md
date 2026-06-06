[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / BoundaryRecorder

# Class: BoundaryRecorder

Defined in: [src/recorders/observability/BoundaryRecorder.ts:523](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L523)

Unified domain event recorder. Implements `CombinedRecorder` so it can
attach to the executor's FlowRecorder channel; exposes `subscribe()`
to wire to the agentfootprint typed-event dispatcher.

v5: composes a `SequenceStore<DomainEvent>` (storage) instead of
extending the deprecated `SequenceStore<T>` base. Time-travel
utilities (`getEntryRanges`, `accumulate`) are accessed through the
store via the public read API on this class.

## Implements

- [`CombinedRecorder`](/agentfootprint/api/generated/type-aliases/CombinedRecorder.md)

## Constructors

### Constructor

> **new BoundaryRecorder**(`options?`): `BoundaryRecorder`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:597](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L597)

#### Parameters

##### options?

[`BoundaryRecorderOptions`](/agentfootprint/api/generated/interfaces/BoundaryRecorderOptions.md) = `{}`

#### Returns

`BoundaryRecorder`

## Properties

### boundaryIndex

> `readonly` **boundaryIndex**: `CommitRangeIndex`\<[`BoundaryRangeLabel`](/agentfootprint/api/generated/interfaces/BoundaryRangeLabel.md)\>

Defined in: [src/recorders/observability/BoundaryRecorder.ts:536](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L536)

Phase 5 Layer 2 — interval index over commit indices, populated
live as boundary entry/exit pairs fire. Consumers (Lens) read
`enclosing(commitIdx)` for breadcrumbs and `overlapping(slice)`
for time-range queries. Empty when `getCommitCount` is not
injected. See `docs/design/boundary-commit-ranges.md`.

***

### id

> `readonly` **id**: `string`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:524](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L524)

#### Implementation of

`CombinedRecorder.id`

## Methods

### aggregateAllBoundaries()

> **aggregateAllBoundaries**(): readonly [`BoundaryAggregate`](/agentfootprint/api/generated/interfaces/BoundaryAggregate.md)[]

Defined in: [src/recorders/observability/BoundaryRecorder.ts:1149](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L1149)

Roll up every primitive boundary in the run into one rollup each,
in the order their `subflow.entry` events fired. Top-level multi-
agent UIs call this once per render to populate per-agent chips.

Filters to `primitiveKind`-tagged subflows ONLY (Agent / LLMCall /
Sequence / Parallel / Conditional / Loop). Slot subflows
(`sf-system-prompt` / `sf-messages` / `sf-tools`) are NOT
boundaries in this sense — they're context-engineering machinery,
not user-facing rollup units.

#### Returns

readonly [`BoundaryAggregate`](/agentfootprint/api/generated/interfaces/BoundaryAggregate.md)[]

***

### aggregateForBoundary()

> **aggregateForBoundary**(`runtimeStageId`): [`BoundaryAggregate`](/agentfootprint/api/generated/interfaces/BoundaryAggregate.md) \| `undefined`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:1126](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L1126)

Roll up the event stream for ONE primitive boundary (Agent /
LLMCall / Sequence / Parallel / Conditional / Loop) into per-
boundary totals — tokens, llm calls, tool calls, iterations,
cache hits, duration.

Pure projection over `getEvents()`. Events are attributed to a
boundary when their `subflowPath` is a **prefix-match** of the
boundary's path — so a nested `LLMCall` inside an `Agent` rolls
up into BOTH (LLMCall total + Agent total).

Works mid-run (the boundary's `subflow.exit` may not have fired
yet — `endedAtMs` / `durationMs` are undefined in that case).
Works post-run.

Multi-consumer story: this is the single source of rollup truth
for Lens, CLI live monitors, Sentry breadcrumbs, OTel exporters,
dashboards. Domain math (what counts as an "iteration"? does
cache hit count separately from llmCalls?) lives HERE — every
consumer hooks up; nobody re-implements.

#### Parameters

##### runtimeStageId

`string`

The boundary's runtimeStageId (the same id
  carried by `StepNode.runtimeStageId` for primitive subflows).

#### Returns

[`BoundaryAggregate`](/agentfootprint/api/generated/interfaces/BoundaryAggregate.md) \| `undefined`

The rollup, or `undefined` if no `subflow.entry` event
  matches `runtimeStageId`.

***

### clear()

> **clear**(): `void`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:629](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L629)

Reset all transient state.

**Composition-safe gate (Phase 5 Layer 4):** if `openTokens.size > 0`
the call is a no-op. Rationale: `FlowChartExecutor.run()` calls
`r.clear?.()` on every attached recorder during its pre-run loop.
When agentfootprint composition primitives (LLMCall, Sequence,
Parallel, etc.) propagate the parent's recorders to nested
sub-executors, EACH sub-executor's pre-run clear loop calls
`clear()` on the SHARED parent recorder mid-run — wiping live
parent state. The `openTokens.size > 0` check distinguishes:

  - **Legitimate reset** — consumer or executor calls `clear()`
    when no boundary is in-flight (`openTokens` empty). Safe to
    wipe; the recorder is idle.
  - **Composition wipe** — sub-executor's pre-run clear fires
    while the parent has open boundaries (`openTokens` non-empty).
    Skip the wipe; the parent's state must be preserved.

If a consumer needs to forcibly wipe state even with open tokens
(e.g., manual recovery after a crashed run), pair `clear()` with
an explicit `forceClear()` (TODO — add when the use case shows up;
today the recorder lifecycle pattern is "one recorder per logical
run" so leaked tokens shouldn't occur).

#### Returns

`void`

#### Implementation of

`CombinedRecorder.clear`

***

### getBoundaries()

> **getBoundaries**(): ([`DomainRunEvent`](/agentfootprint/api/generated/interfaces/DomainRunEvent.md) \| [`DomainSubflowEvent`](/agentfootprint/api/generated/interfaces/DomainSubflowEvent.md))[]

Defined in: [src/recorders/observability/BoundaryRecorder.ts:1027](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L1027)

All boundary events (run + subflow, entry + exit interleaved).

#### Returns

([`DomainRunEvent`](/agentfootprint/api/generated/interfaces/DomainRunEvent.md) \| [`DomainSubflowEvent`](/agentfootprint/api/generated/interfaces/DomainSubflowEvent.md))[]

***

### getBoundary()

> **getBoundary**(`runtimeStageId`): `object`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:1053](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L1053)

Entry/exit pair for one chart execution by `runtimeStageId`.

#### Parameters

##### runtimeStageId

`string`

#### Returns

`object`

##### entry?

> `optional` **entry?**: [`DomainRunEvent`](/agentfootprint/api/generated/interfaces/DomainRunEvent.md) \| [`DomainSubflowEvent`](/agentfootprint/api/generated/interfaces/DomainSubflowEvent.md)

##### exit?

> `optional` **exit?**: [`DomainRunEvent`](/agentfootprint/api/generated/interfaces/DomainRunEvent.md) \| [`DomainSubflowEvent`](/agentfootprint/api/generated/interfaces/DomainSubflowEvent.md)

***

### getEvents()

> **getEvents**(): [`DomainEvent`](/agentfootprint/api/generated/type-aliases/DomainEvent.md)[]

Defined in: [src/recorders/observability/BoundaryRecorder.ts:1011](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L1011)

All events in capture order (the canonical projection).

#### Returns

[`DomainEvent`](/agentfootprint/api/generated/type-aliases/DomainEvent.md)[]

***

### getEventsByType()

> **getEventsByType**\<`T`\>(`type`): (`Extract`\<[`DomainRunEvent`](/agentfootprint/api/generated/interfaces/DomainRunEvent.md), \{ `type`: `T`; \}\> \| `Extract`\<[`DomainSubflowEvent`](/agentfootprint/api/generated/interfaces/DomainSubflowEvent.md), \{ `type`: `T`; \}\> \| `Extract`\<`DomainCompositionEvent`, \{ `type`: `T`; \}\> \| `Extract`\<[`DomainForkBranchEvent`](/agentfootprint/api/generated/interfaces/DomainForkBranchEvent.md), \{ `type`: `T`; \}\> \| `Extract`\<[`DomainDecisionBranchEvent`](/agentfootprint/api/generated/interfaces/DomainDecisionBranchEvent.md), \{ `type`: `T`; \}\> \| `Extract`\<[`DomainLoopIterationEvent`](/agentfootprint/api/generated/interfaces/DomainLoopIterationEvent.md), \{ `type`: `T`; \}\> \| `Extract`\<[`DomainLLMStartEvent`](/agentfootprint/api/generated/interfaces/DomainLLMStartEvent.md), \{ `type`: `T`; \}\> \| `Extract`\<[`DomainLLMEndEvent`](/agentfootprint/api/generated/interfaces/DomainLLMEndEvent.md), \{ `type`: `T`; \}\> \| `Extract`\<[`DomainToolStartEvent`](/agentfootprint/api/generated/interfaces/DomainToolStartEvent.md), \{ `type`: `T`; \}\> \| `Extract`\<[`DomainToolEndEvent`](/agentfootprint/api/generated/interfaces/DomainToolEndEvent.md), \{ `type`: `T`; \}\> \| `Extract`\<[`DomainContextInjectedEvent`](/agentfootprint/api/generated/interfaces/DomainContextInjectedEvent.md), \{ `type`: `T`; \}\>)[]

Defined in: [src/recorders/observability/BoundaryRecorder.ts:1016](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L1016)

Type-narrowed lookup: all events of one kind.

#### Type Parameters

##### T

`T` *extends* `"run.entry"` \| `"run.exit"` \| `"subflow.entry"` \| `"subflow.exit"` \| `"composition.start"` \| `"composition.end"` \| `"fork.branch"` \| `"decision.branch"` \| `"loop.iteration"` \| `"llm.start"` \| `"llm.end"` \| `"tool.start"` \| `"tool.end"` \| `"context.injected"`

#### Parameters

##### type

`T`

#### Returns

(`Extract`\<[`DomainRunEvent`](/agentfootprint/api/generated/interfaces/DomainRunEvent.md), \{ `type`: `T`; \}\> \| `Extract`\<[`DomainSubflowEvent`](/agentfootprint/api/generated/interfaces/DomainSubflowEvent.md), \{ `type`: `T`; \}\> \| `Extract`\<`DomainCompositionEvent`, \{ `type`: `T`; \}\> \| `Extract`\<[`DomainForkBranchEvent`](/agentfootprint/api/generated/interfaces/DomainForkBranchEvent.md), \{ `type`: `T`; \}\> \| `Extract`\<[`DomainDecisionBranchEvent`](/agentfootprint/api/generated/interfaces/DomainDecisionBranchEvent.md), \{ `type`: `T`; \}\> \| `Extract`\<[`DomainLoopIterationEvent`](/agentfootprint/api/generated/interfaces/DomainLoopIterationEvent.md), \{ `type`: `T`; \}\> \| `Extract`\<[`DomainLLMStartEvent`](/agentfootprint/api/generated/interfaces/DomainLLMStartEvent.md), \{ `type`: `T`; \}\> \| `Extract`\<[`DomainLLMEndEvent`](/agentfootprint/api/generated/interfaces/DomainLLMEndEvent.md), \{ `type`: `T`; \}\> \| `Extract`\<[`DomainToolStartEvent`](/agentfootprint/api/generated/interfaces/DomainToolStartEvent.md), \{ `type`: `T`; \}\> \| `Extract`\<[`DomainToolEndEvent`](/agentfootprint/api/generated/interfaces/DomainToolEndEvent.md), \{ `type`: `T`; \}\> \| `Extract`\<[`DomainContextInjectedEvent`](/agentfootprint/api/generated/interfaces/DomainContextInjectedEvent.md), \{ `type`: `T`; \}\>)[]

***

### getRootBoundary()

> **getRootBoundary**(): `object`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:1071](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L1071)

Convenience for the outermost `__root__` pair.

#### Returns

`object`

##### entry?

> `optional` **entry?**: [`DomainRunEvent`](/agentfootprint/api/generated/interfaces/DomainRunEvent.md)

##### exit?

> `optional` **exit?**: [`DomainRunEvent`](/agentfootprint/api/generated/interfaces/DomainRunEvent.md)

***

### getSlotBoundaries()

> **getSlotBoundaries**(): `object`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:1083](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L1083)

Subflow events grouped by the 3 input slots — for slot-row rendering.

#### Returns

`object`

##### messages

> **messages**: [`DomainSubflowEvent`](/agentfootprint/api/generated/interfaces/DomainSubflowEvent.md)[]

##### systemPrompt

> **systemPrompt**: [`DomainSubflowEvent`](/agentfootprint/api/generated/interfaces/DomainSubflowEvent.md)[]

##### tools

> **tools**: [`DomainSubflowEvent`](/agentfootprint/api/generated/interfaces/DomainSubflowEvent.md)[]

***

### getSteps()

> **getSteps**(): ([`DomainRunEvent`](/agentfootprint/api/generated/interfaces/DomainRunEvent.md) \| [`DomainSubflowEvent`](/agentfootprint/api/generated/interfaces/DomainSubflowEvent.md))[]

Defined in: [src/recorders/observability/BoundaryRecorder.ts:1043](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L1043)

Just the entry-phase boundary events — the "step list" timeline.

#### Returns

([`DomainRunEvent`](/agentfootprint/api/generated/interfaces/DomainRunEvent.md) \| [`DomainSubflowEvent`](/agentfootprint/api/generated/interfaces/DomainSubflowEvent.md))[]

***

### getVisibleSteps()

> **getVisibleSteps**(): ([`DomainRunEvent`](/agentfootprint/api/generated/interfaces/DomainRunEvent.md) \| [`DomainSubflowEvent`](/agentfootprint/api/generated/interfaces/DomainSubflowEvent.md))[]

Defined in: [src/recorders/observability/BoundaryRecorder.ts:1048](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L1048)

Subset of `getSteps()` excluding agent-internal routing subflows.

#### Returns

([`DomainRunEvent`](/agentfootprint/api/generated/interfaces/DomainRunEvent.md) \| [`DomainSubflowEvent`](/agentfootprint/api/generated/interfaces/DomainSubflowEvent.md))[]

***

### onDecision()

> **onDecision**(`event`): `void`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:747](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L747)

#### Parameters

##### event

[`FlowDecisionEvent`](/agentfootprint/api/generated/interfaces/FlowDecisionEvent.md)

#### Returns

`void`

#### Implementation of

[`FlowRecorder`](/agentfootprint/api/generated/interfaces/FlowRecorder.md).[`onDecision`](/agentfootprint/api/generated/interfaces/FlowRecorder.md#ondecision)

***

### onFork()

> **onFork**(`event`): `void`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:724](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L724)

#### Parameters

##### event

[`FlowForkEvent`](/agentfootprint/api/generated/interfaces/FlowForkEvent.md)

#### Returns

`void`

#### Implementation of

[`FlowRecorder`](/agentfootprint/api/generated/interfaces/FlowRecorder.md).[`onFork`](/agentfootprint/api/generated/interfaces/FlowRecorder.md#onfork)

***

### onLoop()

> **onLoop**(`event`): `void`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:778](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L778)

#### Parameters

##### event

[`FlowLoopEvent`](/agentfootprint/api/generated/interfaces/FlowLoopEvent.md)

#### Returns

`void`

#### Implementation of

[`FlowRecorder`](/agentfootprint/api/generated/interfaces/FlowRecorder.md).[`onLoop`](/agentfootprint/api/generated/interfaces/FlowRecorder.md#onloop)

***

### onRunEnd()

> **onRunEnd**(`event`): `void`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:662](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L662)

Called once per top-level `executor.run()` AFTER traversal completes
cleanly. Carries `event.payload = chart's return value`. NOT fired on
pause (the run didn't end) or uncaught error.

#### Parameters

##### event

`FlowRunEvent`

#### Returns

`void`

#### Implementation of

[`FlowRecorder`](/agentfootprint/api/generated/interfaces/FlowRecorder.md).[`onRunEnd`](/agentfootprint/api/generated/interfaces/FlowRecorder.md#onrunend)

***

### onRunFailed()

> **onRunFailed**(`event`): `void`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:679](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L679)

Called once per top-level `executor.run()` when the run throws a
non-pause error, BEFORE the exception propagates. The TERMINAL
counterpart to `onRunEnd` — lets a monitor close the run boundary on
failure instead of waiting forever. NOT fired on pause.

#### Parameters

##### event

`FlowRunFailedEvent`

#### Returns

`void`

#### Implementation of

[`FlowRecorder`](/agentfootprint/api/generated/interfaces/FlowRecorder.md).[`onRunFailed`](/agentfootprint/api/generated/interfaces/FlowRecorder.md#onrunfailed)

***

### onRunStart()

> **onRunStart**(`event`): `void`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:648](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L648)

Called once per top-level `executor.run()` BEFORE traversal begins.
Carries `event.payload = run({input})`. Subflow-traversers don't fire it.

#### Parameters

##### event

`FlowRunEvent`

#### Returns

`void`

#### Implementation of

[`FlowRecorder`](/agentfootprint/api/generated/interfaces/FlowRecorder.md).[`onRunStart`](/agentfootprint/api/generated/interfaces/FlowRecorder.md#onrunstart)

***

### onSubflowEntry()

> **onSubflowEntry**(`event`): `void`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:697](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L697)

#### Parameters

##### event

[`FlowSubflowEvent`](/agentfootprint/api/generated/interfaces/FlowSubflowEvent.md)

#### Returns

`void`

#### Implementation of

[`FlowRecorder`](/agentfootprint/api/generated/interfaces/FlowRecorder.md).[`onSubflowEntry`](/agentfootprint/api/generated/interfaces/FlowRecorder.md#onsubflowentry)

***

### onSubflowExit()

> **onSubflowExit**(`event`): `void`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:709](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L709)

#### Parameters

##### event

[`FlowSubflowEvent`](/agentfootprint/api/generated/interfaces/FlowSubflowEvent.md)

#### Returns

`void`

#### Implementation of

[`FlowRecorder`](/agentfootprint/api/generated/interfaces/FlowRecorder.md).[`onSubflowExit`](/agentfootprint/api/generated/interfaces/FlowRecorder.md#onsubflowexit)

***

### subscribe()

> **subscribe**(`dispatcher`): [`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)

Defined in: [src/recorders/observability/BoundaryRecorder.ts:805](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L805)

Subscribe to the runner's typed-event dispatcher and emit a domain
event for each `llm.*` / `tool.*` / `context.injected` event.

Returns an unsubscribe function; safe to call multiple times (each
call adds a new subscription). Most consumers call this once at
recorder construction and dispose with the returned function.

#### Parameters

##### dispatcher

[`EventDispatcher`](/agentfootprint/api/generated/classes/EventDispatcher.md)

#### Returns

[`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)

***

### toSnapshot()

> **toSnapshot**(): `object`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:1169](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L1169)

Snapshot bundle — included in `executor.getSnapshot()` if the
 executor implements the snapshot extension protocol.

#### Returns

`object`

##### data

> **data**: [`DomainEvent`](/agentfootprint/api/generated/type-aliases/DomainEvent.md)[]

##### description

> **description**: `string` = `'Unified domain event log — run/subflow boundaries + LLM/tool/context events'`

##### name

> **name**: `string` = `'BoundaryEvents'`

##### preferredOperation

> **preferredOperation**: `"translate"`

#### Implementation of

`CombinedRecorder.toSnapshot`

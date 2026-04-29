[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / BoundaryRecorder

# Class: BoundaryRecorder

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:289](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L289)

Unified domain event recorder. Implements `CombinedRecorder` so it can
attach to the executor's FlowRecorder channel; exposes `subscribe()`
to wire to the agentfootprint typed-event dispatcher.

Internally stores events in a `SequenceRecorder<DomainEvent>` so the
usual time-travel utilities (`getEntryRanges`, `accumulate`) work
out of the box.

## Extends

- `SequenceRecorder`\<[`DomainEvent`](/agentfootprint/api/generated/type-aliases/DomainEvent.md)\>

## Implements

- `CombinedRecorder`

## Constructors

### Constructor

> **new BoundaryRecorder**(`options?`): `BoundaryRecorder`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:300](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L300)

#### Parameters

##### options?

[`BoundaryRecorderOptions`](/agentfootprint/api/generated/interfaces/BoundaryRecorderOptions.md) = `{}`

#### Returns

`BoundaryRecorder`

#### Overrides

`SequenceRecorder<DomainEvent>.constructor`

## Properties

### id

> `readonly` **id**: `string`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:290](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L290)

#### Implementation of

`CombinedRecorder.id`

#### Overrides

`SequenceRecorder.id`

## Accessors

### entryCount

#### Get Signature

> **get** **entryCount**(): `number`

Defined in: footPrint/dist/types/lib/recorder/SequenceRecorder.d.ts:78

Number of entries in the sequence.

##### Returns

`number`

#### Inherited from

`SequenceRecorder.entryCount`

***

### stepCount

#### Get Signature

> **get** **stepCount**(): `number`

Defined in: footPrint/dist/types/lib/recorder/SequenceRecorder.d.ts:84

Number of unique execution steps that have entries.

##### Returns

`number`

#### Inherited from

`SequenceRecorder.stepCount`

## Methods

### accumulate()

> **accumulate**\<`R`\>(`fn`, `initial`, `keys?`): `R`

Defined in: footPrint/dist/types/lib/recorder/SequenceRecorder.d.ts:102

Reduce entries, optionally filtered by a set of runtimeStageIds.
For time-travel progressive view: pass the runtimeStageIds visible at the current slider position.
Entries without runtimeStageId (structural markers) are excluded when keys are provided.
Without keys, reduces all entries (same as aggregate).

#### Type Parameters

##### R

`R`

#### Parameters

##### fn

(`acc`, `entry`) => `R`

##### initial

`R`

##### keys?

`ReadonlySet`\<`string`\>

#### Returns

`R`

#### Inherited from

`SequenceRecorder.accumulate`

***

### aggregate()

> **aggregate**\<`R`\>(`fn`, `initial`): `R`

Defined in: footPrint/dist/types/lib/recorder/SequenceRecorder.d.ts:95

Reduce ALL entries to a single value. For dashboards, totals, summaries.

#### Type Parameters

##### R

`R`

#### Parameters

##### fn

(`acc`, `entry`) => `R`

##### initial

`R`

#### Returns

`R`

#### Inherited from

`SequenceRecorder.aggregate`

***

### clear()

> **clear**(): `void`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:305](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L305)

Clear all stored data. Called by executor before each run().

#### Returns

`void`

#### Implementation of

`CombinedRecorder.clear`

#### Overrides

`SequenceRecorder.clear`

***

### getBoundaries()

> **getBoundaries**(): ([`DomainRunEvent`](/agentfootprint/api/generated/interfaces/DomainRunEvent.md) \| [`DomainSubflowEvent`](/agentfootprint/api/generated/interfaces/DomainSubflowEvent.md))[]

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:541](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L541)

All boundary events (run + subflow, entry + exit interleaved).

#### Returns

([`DomainRunEvent`](/agentfootprint/api/generated/interfaces/DomainRunEvent.md) \| [`DomainSubflowEvent`](/agentfootprint/api/generated/interfaces/DomainSubflowEvent.md))[]

***

### getBoundary()

> **getBoundary**(`runtimeStageId`): `object`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:567](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L567)

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

### getEntries()

> **getEntries**(): [`DomainEvent`](/agentfootprint/api/generated/type-aliases/DomainEvent.md)[]

Defined in: footPrint/dist/types/lib/recorder/SequenceRecorder.d.ts:76

All entries in insertion order (returns a shallow copy — entry objects are shared).

#### Returns

[`DomainEvent`](/agentfootprint/api/generated/type-aliases/DomainEvent.md)[]

#### Inherited from

`SequenceRecorder.getEntries`

***

### getEntriesForStep()

> **getEntriesForStep**(`runtimeStageId`): [`DomainEvent`](/agentfootprint/api/generated/type-aliases/DomainEvent.md)[]

Defined in: footPrint/dist/types/lib/recorder/SequenceRecorder.d.ts:82

O(1) lookup: all entries for a specific execution step (returns a copy).

#### Parameters

##### runtimeStageId

`string`

#### Returns

[`DomainEvent`](/agentfootprint/api/generated/type-aliases/DomainEvent.md)[]

#### Inherited from

`SequenceRecorder.getEntriesForStep`

***

### getEntriesUpTo()

> **getEntriesUpTo**(`visibleIds`): [`DomainEvent`](/agentfootprint/api/generated/type-aliases/DomainEvent.md)[]

Defined in: footPrint/dist/types/lib/recorder/SequenceRecorder.d.ts:109

Progressive reveal: entries whose runtimeStageId is in the visible set.
Preserves insertion order. Entries without runtimeStageId (structural markers)
are buffered and included only when surrounded by visible steps on both sides —
trailing markers after the last visible step are discarded.

#### Parameters

##### visibleIds

`ReadonlySet`\<`string`\>

#### Returns

[`DomainEvent`](/agentfootprint/api/generated/type-aliases/DomainEvent.md)[]

#### Inherited from

`SequenceRecorder.getEntriesUpTo`

***

### getEntryRanges()

> **getEntryRanges**(): `ReadonlyMap`\<`string`, \{ `endIdx`: `number`; `firstIdx`: `number`; \}\>

Defined in: footPrint/dist/types/lib/recorder/SequenceRecorder.d.ts:90

Pre-built range index: runtimeStageId → half-open range [firstIdx, endIdx) in entries array.
Maintained during emit() — no rebuild needed. Use for O(1) per-step lookups during time-travel.
endIdx includes trailing keyless entries (structural markers following a step).

#### Returns

`ReadonlyMap`\<`string`, \{ `endIdx`: `number`; `firstIdx`: `number`; \}\>

#### Inherited from

`SequenceRecorder.getEntryRanges`

***

### getEvents()

> **getEvents**(): [`DomainEvent`](/agentfootprint/api/generated/type-aliases/DomainEvent.md)[]

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:525](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L525)

All events in capture order (the canonical projection).

#### Returns

[`DomainEvent`](/agentfootprint/api/generated/type-aliases/DomainEvent.md)[]

***

### getEventsByType()

> **getEventsByType**\<`T`\>(`type`): (`Extract`\<[`DomainRunEvent`](/agentfootprint/api/generated/interfaces/DomainRunEvent.md), \{ `type`: `T`; \}\> \| `Extract`\<[`DomainSubflowEvent`](/agentfootprint/api/generated/interfaces/DomainSubflowEvent.md), \{ `type`: `T`; \}\> \| `Extract`\<[`DomainForkBranchEvent`](/agentfootprint/api/generated/interfaces/DomainForkBranchEvent.md), \{ `type`: `T`; \}\> \| `Extract`\<[`DomainDecisionBranchEvent`](/agentfootprint/api/generated/interfaces/DomainDecisionBranchEvent.md), \{ `type`: `T`; \}\> \| `Extract`\<[`DomainLoopIterationEvent`](/agentfootprint/api/generated/interfaces/DomainLoopIterationEvent.md), \{ `type`: `T`; \}\> \| `Extract`\<[`DomainLLMStartEvent`](/agentfootprint/api/generated/interfaces/DomainLLMStartEvent.md), \{ `type`: `T`; \}\> \| `Extract`\<[`DomainLLMEndEvent`](/agentfootprint/api/generated/interfaces/DomainLLMEndEvent.md), \{ `type`: `T`; \}\> \| `Extract`\<[`DomainToolStartEvent`](/agentfootprint/api/generated/interfaces/DomainToolStartEvent.md), \{ `type`: `T`; \}\> \| `Extract`\<[`DomainToolEndEvent`](/agentfootprint/api/generated/interfaces/DomainToolEndEvent.md), \{ `type`: `T`; \}\> \| `Extract`\<[`DomainContextInjectedEvent`](/agentfootprint/api/generated/interfaces/DomainContextInjectedEvent.md), \{ `type`: `T`; \}\>)[]

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:530](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L530)

Type-narrowed lookup: all events of one kind.

#### Type Parameters

##### T

`T` *extends* `"run.entry"` \| `"run.exit"` \| `"subflow.entry"` \| `"subflow.exit"` \| `"fork.branch"` \| `"decision.branch"` \| `"loop.iteration"` \| `"llm.start"` \| `"llm.end"` \| `"tool.start"` \| `"tool.end"` \| `"context.injected"`

#### Parameters

##### type

`T`

#### Returns

(`Extract`\<[`DomainRunEvent`](/agentfootprint/api/generated/interfaces/DomainRunEvent.md), \{ `type`: `T`; \}\> \| `Extract`\<[`DomainSubflowEvent`](/agentfootprint/api/generated/interfaces/DomainSubflowEvent.md), \{ `type`: `T`; \}\> \| `Extract`\<[`DomainForkBranchEvent`](/agentfootprint/api/generated/interfaces/DomainForkBranchEvent.md), \{ `type`: `T`; \}\> \| `Extract`\<[`DomainDecisionBranchEvent`](/agentfootprint/api/generated/interfaces/DomainDecisionBranchEvent.md), \{ `type`: `T`; \}\> \| `Extract`\<[`DomainLoopIterationEvent`](/agentfootprint/api/generated/interfaces/DomainLoopIterationEvent.md), \{ `type`: `T`; \}\> \| `Extract`\<[`DomainLLMStartEvent`](/agentfootprint/api/generated/interfaces/DomainLLMStartEvent.md), \{ `type`: `T`; \}\> \| `Extract`\<[`DomainLLMEndEvent`](/agentfootprint/api/generated/interfaces/DomainLLMEndEvent.md), \{ `type`: `T`; \}\> \| `Extract`\<[`DomainToolStartEvent`](/agentfootprint/api/generated/interfaces/DomainToolStartEvent.md), \{ `type`: `T`; \}\> \| `Extract`\<[`DomainToolEndEvent`](/agentfootprint/api/generated/interfaces/DomainToolEndEvent.md), \{ `type`: `T`; \}\> \| `Extract`\<[`DomainContextInjectedEvent`](/agentfootprint/api/generated/interfaces/DomainContextInjectedEvent.md), \{ `type`: `T`; \}\>)[]

***

### getRootBoundary()

> **getRootBoundary**(): `object`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:585](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L585)

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

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:597](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L597)

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

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:557](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L557)

Just the entry-phase boundary events — the "step list" timeline.

#### Returns

([`DomainRunEvent`](/agentfootprint/api/generated/interfaces/DomainRunEvent.md) \| [`DomainSubflowEvent`](/agentfootprint/api/generated/interfaces/DomainSubflowEvent.md))[]

***

### getVisibleSteps()

> **getVisibleSteps**(): ([`DomainRunEvent`](/agentfootprint/api/generated/interfaces/DomainRunEvent.md) \| [`DomainSubflowEvent`](/agentfootprint/api/generated/interfaces/DomainSubflowEvent.md))[]

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:562](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L562)

Subset of `getSteps()` excluding agent-internal routing subflows.

#### Returns

([`DomainRunEvent`](/agentfootprint/api/generated/interfaces/DomainRunEvent.md) \| [`DomainSubflowEvent`](/agentfootprint/api/generated/interfaces/DomainSubflowEvent.md))[]

***

### onDecision()

> **onDecision**(`event`): `void`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:349](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L349)

#### Parameters

##### event

`FlowDecisionEvent`

#### Returns

`void`

#### Implementation of

`CombinedRecorder.onDecision`

***

### onFork()

> **onFork**(`event`): `void`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:330](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L330)

#### Parameters

##### event

`FlowForkEvent`

#### Returns

`void`

#### Implementation of

`CombinedRecorder.onFork`

***

### onLoop()

> **onLoop**(`event`): `void`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:376](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L376)

#### Parameters

##### event

`FlowLoopEvent`

#### Returns

`void`

#### Implementation of

`CombinedRecorder.onLoop`

***

### onRunEnd()

> **onRunEnd**(`event`): `void`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:316](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L316)

Called once per top-level `executor.run()` AFTER traversal completes
cleanly. Carries `event.payload = chart's return value`. NOT fired on
pause (the run didn't end) or uncaught error.

#### Parameters

##### event

`FlowRunEvent`

#### Returns

`void`

#### Implementation of

`CombinedRecorder.onRunEnd`

***

### onRunStart()

> **onRunStart**(`event`): `void`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:312](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L312)

Called once per top-level `executor.run()` BEFORE traversal begins.
Carries `event.payload = run({input})`. Subflow-traversers don't fire it.

#### Parameters

##### event

`FlowRunEvent`

#### Returns

`void`

#### Implementation of

`CombinedRecorder.onRunStart`

***

### onSubflowEntry()

> **onSubflowEntry**(`event`): `void`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:320](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L320)

#### Parameters

##### event

`FlowSubflowEvent`

#### Returns

`void`

#### Implementation of

`CombinedRecorder.onSubflowEntry`

***

### onSubflowExit()

> **onSubflowExit**(`event`): `void`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:325](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L325)

#### Parameters

##### event

`FlowSubflowEvent`

#### Returns

`void`

#### Implementation of

`CombinedRecorder.onSubflowExit`

***

### subscribe()

> **subscribe**(`dispatcher`): [`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:399](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L399)

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

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:616](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L616)

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

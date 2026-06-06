[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LiveStateRecorder

# Class: LiveStateRecorder

Defined in: [src/recorders/observability/LiveStateRecorder.ts:414](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LiveStateRecorder.ts#L414)

One-stop façade bundling `LiveLLMTracker` + `LiveToolTracker` +
`LiveAgentTurnTracker`. Consumers attach this once and get O(1)
reads across all three live-state slices.

Use the bundled façade unless you ONLY need one slice — using a
single tracker directly avoids subscribing to events you don't read.

**Lifecycle**: call `subscribe(runner)` to wire all three trackers,
then `unsubscribe()` to detach. `clear()` resets all transient state
across the three (called automatically by consumers like Lens between
runs).

**What this is NOT for:**
  - Time-travel queries (Tier 1 only — live state)
  - Aggregations (use SequenceStore.aggregate)
  - Stage-level observation (use Recorder.onStageStart/End)

**Composition over inheritance:** the façade does NOT extend
`BoundaryStateStore` itself — different boundary kinds need
separate active maps to avoid key collisions between LLM and tool
boundaries. Each sub-tracker keeps its own state.

## Constructors

### Constructor

> **new LiveStateRecorder**(): `LiveStateRecorder`

Defined in: [src/recorders/observability/LiveStateRecorder.ts:427](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LiveStateRecorder.ts#L427)

#### Returns

`LiveStateRecorder`

## Properties

### id

> `readonly` **id**: `"live-state"` = `'live-state'`

Defined in: [src/recorders/observability/LiveStateRecorder.ts:415](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LiveStateRecorder.ts#L415)

***

### llm

> `readonly` **llm**: [`LiveLLMTracker`](/agentfootprint/api/generated/classes/LiveLLMTracker.md)

Defined in: [src/recorders/observability/LiveStateRecorder.ts:418](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LiveStateRecorder.ts#L418)

LLM call live state.

***

### tool

> `readonly` **tool**: [`LiveToolTracker`](/agentfootprint/api/generated/classes/LiveToolTracker.md)

Defined in: [src/recorders/observability/LiveStateRecorder.ts:420](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LiveStateRecorder.ts#L420)

Tool execution live state.

***

### turn

> `readonly` **turn**: [`LiveAgentTurnTracker`](/agentfootprint/api/generated/classes/LiveAgentTurnTracker.md)

Defined in: [src/recorders/observability/LiveStateRecorder.ts:422](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LiveStateRecorder.ts#L422)

Agent turn live state.

## Methods

### clear()

> **clear**(): `void`

Defined in: [src/recorders/observability/LiveStateRecorder.ts:470](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LiveStateRecorder.ts#L470)

Reset transient state across all three trackers. Called by the
 executor / consumer between runs.

#### Returns

`void`

***

### getCurrentTurnIndex()

> **getCurrentTurnIndex**(): `number`

Defined in: [src/recorders/observability/LiveStateRecorder.ts:504](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LiveStateRecorder.ts#L504)

Current turn index (-1 if not in a turn).

#### Returns

`number`

***

### getExecutingToolNames()

> **getExecutingToolNames**(): readonly `string`[]

Defined in: [src/recorders/observability/LiveStateRecorder.ts:494](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LiveStateRecorder.ts#L494)

Names of tools currently executing.

#### Returns

readonly `string`[]

***

### getPartialLLM()

> **getPartialLLM**(): `string`

Defined in: [src/recorders/observability/LiveStateRecorder.ts:484](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LiveStateRecorder.ts#L484)

Accumulated partial content of the most-recently started LLM call.

#### Returns

`string`

***

### isAgentInTurn()

> **isAgentInTurn**(): `boolean`

Defined in: [src/recorders/observability/LiveStateRecorder.ts:499](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LiveStateRecorder.ts#L499)

True if the agent is currently inside a turn.

#### Returns

`boolean`

***

### isLLMInFlight()

> **isLLMInFlight**(): `boolean`

Defined in: [src/recorders/observability/LiveStateRecorder.ts:479](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LiveStateRecorder.ts#L479)

True if any LLM call is currently in flight.

#### Returns

`boolean`

***

### isToolExecuting()

> **isToolExecuting**(): `boolean`

Defined in: [src/recorders/observability/LiveStateRecorder.ts:489](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LiveStateRecorder.ts#L489)

True if any tool is currently executing.

#### Returns

`boolean`

***

### subscribe()

> **subscribe**(`runner`): [`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)

Defined in: [src/recorders/observability/LiveStateRecorder.ts:442](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LiveStateRecorder.ts#L442)

Subscribe all three trackers to one runner. Idempotent — calling
 twice on the same recorder unsubscribes the prior subscription
 first to avoid double-counting.

 Adds a wildcard `*` listener that observes runId on EVERY event
 (regardless of which tracker subscribes to it) and calls
 `clear()` on all three trackers when the runId changes. This
 closes the gap where a tracker that never saw events in run 1
 would fail to reset in run 2.

#### Parameters

##### runner

[`LiveStateRunnerLike`](/agentfootprint/api/generated/interfaces/LiveStateRunnerLike.md)

#### Returns

[`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)

***

### unsubscribe()

> **unsubscribe**(): `void`

Defined in: [src/recorders/observability/LiveStateRecorder.ts:461](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LiveStateRecorder.ts#L461)

Detach all three trackers from the current runner. Idempotent.

#### Returns

`void`

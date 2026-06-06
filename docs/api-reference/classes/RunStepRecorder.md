[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RunStepRecorder

# Class: RunStepRecorder

Defined in: [src/recorders/observability/RunStepRecorder.ts:181](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/RunStepRecorder.ts#L181)

Real-time slider-step recorder. Emits a `RunStep` whenever an event
marks a meaningful slider transition. State persists on the instance
so successive events update bookkeeping in O(1).

Attach via `runner.attach(rec)` for FlowRecorder events; call
`rec.subscribe(runner.dispatcher)` for actor-arrow events. The
`getSteps(drillPath?)` method returns the already-built list (no
walking) with optional drill-scope filtering.

## Implements

- [`CombinedRecorder`](/agentfootprint/api/generated/type-aliases/CombinedRecorder.md)

## Constructors

### Constructor

> **new RunStepRecorder**(`options?`): `RunStepRecorder`

Defined in: [src/recorders/observability/RunStepRecorder.ts:211](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/RunStepRecorder.ts#L211)

#### Parameters

##### options?

[`RunStepRecorderOptions`](/agentfootprint/api/generated/interfaces/RunStepRecorderOptions.md) = `{}`

#### Returns

`RunStepRecorder`

## Properties

### id

> `readonly` **id**: `string`

Defined in: [src/recorders/observability/RunStepRecorder.ts:182](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/RunStepRecorder.ts#L182)

#### Implementation of

`CombinedRecorder.id`

## Methods

### clear()

> **clear**(): `void`

Defined in: [src/recorders/observability/RunStepRecorder.ts:231](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/RunStepRecorder.ts#L231)

#### Returns

`void`

#### Implementation of

`CombinedRecorder.clear`

***

### getSteps()

> **getSteps**(`drillPath?`): readonly [`RunStep`](/agentfootprint/api/generated/interfaces/RunStep.md)[]

Defined in: [src/recorders/observability/RunStepRecorder.ts:680](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/RunStepRecorder.ts#L680)

Read-only query — returns the already-built step list filtered to
`drillPath` scope. O(1) per call when scope is empty; O(N) filter
otherwise. Composition-vs-leaf root filter is applied so the
slider semantics match the user's mental model:

  - **Leaf root** (single Agent / LLMCall): show `react` steps only.
  - **Composition root** (Sequence / Parallel / Conditional / Loop):
    show composition steps; hide intra-leaf `react` steps.

Drill-down filters by `anchor.subflowPath` prefix and re-applies
the leaf-vs-composition rule for the drilled scope.

#### Parameters

##### drillPath?

readonly `string`[]

#### Returns

readonly [`RunStep`](/agentfootprint/api/generated/interfaces/RunStep.md)[]

***

### ingestDomainEvent()

> **ingestDomainEvent**(`e`): `void`

Defined in: [src/recorders/observability/RunStepRecorder.ts:547](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/RunStepRecorder.ts#L547)

Feed a single recorded `DomainEvent` (from BoundaryRecorder) into
this recorder as if it had fired live. Used by `buildRunSteps`
for snapshot replay; tests use it for fixture-driven projection.

Live consumers should use `runner.attach(rec)` +
`rec.subscribe(dispatcher)` instead — the recorder's hooks fire
naturally during traversal.

#### Parameters

##### e

[`DomainEvent`](/agentfootprint/api/generated/type-aliases/DomainEvent.md)

#### Returns

`void`

***

### onDecision()

> **onDecision**(`event`): `void`

Defined in: [src/recorders/observability/RunStepRecorder.ts:410](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/RunStepRecorder.ts#L410)

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

Defined in: [src/recorders/observability/RunStepRecorder.ts:375](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/RunStepRecorder.ts#L375)

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

Defined in: [src/recorders/observability/RunStepRecorder.ts:447](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/RunStepRecorder.ts#L447)

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

Defined in: [src/recorders/observability/RunStepRecorder.ts:266](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/RunStepRecorder.ts#L266)

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

### onRunStart()

> **onRunStart**(`event`): `void`

Defined in: [src/recorders/observability/RunStepRecorder.ts:260](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/RunStepRecorder.ts#L260)

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

Defined in: [src/recorders/observability/RunStepRecorder.ts:274](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/RunStepRecorder.ts#L274)

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

Defined in: [src/recorders/observability/RunStepRecorder.ts:335](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/RunStepRecorder.ts#L335)

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

Defined in: [src/recorders/observability/RunStepRecorder.ts:483](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/RunStepRecorder.ts#L483)

Subscribe to the runner's typed-event dispatcher and emit a
`react` RunStep on every `llm.start` / `llm.end`. The recorder
classifies `actorArrow` locally (mirrors BoundaryRecorder's
pattern) so consumers don't have to depend on BoundaryRecorder's
own subscription order.

#### Parameters

##### dispatcher

[`EventDispatcher`](/agentfootprint/api/generated/classes/EventDispatcher.md)

#### Returns

[`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)

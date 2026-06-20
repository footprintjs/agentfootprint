---
title: FlowRecorder
---

# Interface: FlowRecorder

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:341

FlowRecorder — Pluggable observer for control flow events.

Mirrors the scope-level ScopeRecorder pattern for the engine layer.
All methods are optional — implement only the hooks you need.
Recorders are invoked synchronously in attachment order.
If a recorder throws, the error is caught and swallowed; execution continues.

## Example

```typescript
const metricsRecorder: FlowRecorder = {
  id: 'metrics',
  onLoop: (event) => recordMetric('loop.iteration', event.iteration),
  onDecision: (event) => recordMetric('decision', event.chosen),
};
executor.attachFlowRecorder(metricsRecorder);
```

## Properties

### id

> `readonly` **id**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:342

## Methods

### clear()?

> `optional` **clear**(): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:376

Called before each run to reset per-run state. Implement for stateful recorders.

#### Returns

`void`

***

### onBreak()?

> `optional` **onBreak**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:353

#### Parameters

##### event

[`FlowBreakEvent`](/docs/api/interfaces/FlowBreakEvent)

#### Returns

`void`

***

### onDecision()?

> `optional` **onDecision**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:345

#### Parameters

##### event

[`FlowDecisionEvent`](/docs/api/interfaces/FlowDecisionEvent)

#### Returns

`void`

***

### onError()?

> `optional` **onError**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:354

#### Parameters

##### event

[`FlowErrorEvent`](/docs/api/interfaces/FlowErrorEvent)

#### Returns

`void`

***

### onFork()?

> `optional` **onFork**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:346

#### Parameters

##### event

[`FlowForkEvent`](/docs/api/interfaces/FlowForkEvent)

#### Returns

`void`

***

### onLoop()?

> `optional` **onLoop**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:352

#### Parameters

##### event

[`FlowLoopEvent`](/docs/api/interfaces/FlowLoopEvent)

#### Returns

`void`

***

### onNext()?

> `optional` **onNext**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:344

#### Parameters

##### event

[`FlowNextEvent`](/docs/api/interfaces/FlowNextEvent)

#### Returns

`void`

***

### onPause()?

> `optional` **onPause**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:355

#### Parameters

##### event

`FlowPauseEvent`

#### Returns

`void`

***

### onResume()?

> `optional` **onResume**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:356

#### Parameters

##### event

`FlowResumeEvent`

#### Returns

`void`

***

### onRunEnd()?

> `optional` **onRunEnd**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:367

Called once per top-level `executor.run()` AFTER traversal completes
cleanly. Carries `event.payload = chart's return value`. NOT fired on
pause (the run didn't end) or uncaught error.

#### Parameters

##### event

`FlowRunEvent`

#### Returns

`void`

***

### onRunFailed()?

> `optional` **onRunFailed**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:374

Called once per top-level `executor.run()` when the run throws a
non-pause error, BEFORE the exception propagates. The TERMINAL
counterpart to `onRunEnd` — lets a monitor close the run boundary on
failure instead of waiting forever. NOT fired on pause.

#### Parameters

##### event

`FlowRunFailedEvent`

#### Returns

`void`

***

### onRunStart()?

> `optional` **onRunStart**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:361

Called once per top-level `executor.run()` BEFORE traversal begins.
Carries `event.payload = run({input})`. Subflow-traversers don't fire it.

#### Parameters

##### event

`FlowRunEvent`

#### Returns

`void`

***

### onSelected()?

> `optional` **onSelected**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:347

#### Parameters

##### event

[`FlowSelectedEvent`](/docs/api/interfaces/FlowSelectedEvent)

#### Returns

`void`

***

### onStageExecuted()?

> `optional` **onStageExecuted**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:343

#### Parameters

##### event

[`FlowStageEvent`](/docs/api/interfaces/FlowStageEvent)

#### Returns

`void`

***

### onSubflowEntry()?

> `optional` **onSubflowEntry**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:348

#### Parameters

##### event

[`FlowSubflowEvent`](/docs/api/interfaces/FlowSubflowEvent)

#### Returns

`void`

***

### onSubflowExit()?

> `optional` **onSubflowExit**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:349

#### Parameters

##### event

[`FlowSubflowEvent`](/docs/api/interfaces/FlowSubflowEvent)

#### Returns

`void`

***

### onSubflowRegistered()?

> `optional` **onSubflowRegistered**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:351

Called when a dynamic subflow is registered during traversal.

#### Parameters

##### event

[`FlowSubflowRegisteredEvent`](/docs/api/interfaces/FlowSubflowRegisteredEvent)

#### Returns

`void`

***

### toSnapshot()?

> `optional` **toSnapshot**(): `object`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:378

Optional: expose collected data for inclusion in snapshots.

#### Returns

`object`

##### data

> **data**: `unknown`

##### description?

> `optional` **description?**: `string`

##### name

> **name**: `string`

##### preferredOperation?

> `optional` **preferredOperation?**: `"translate"` \| `"accumulate"` \| `"aggregate"`

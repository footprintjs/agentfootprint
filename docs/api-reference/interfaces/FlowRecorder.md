[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / FlowRecorder

# Interface: FlowRecorder

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:313

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

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:314

## Methods

### clear()?

> `optional` **clear**(): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:348

Called before each run to reset per-run state. Implement for stateful recorders.

#### Returns

`void`

***

### onBreak()?

> `optional` **onBreak**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:325

#### Parameters

##### event

[`FlowBreakEvent`](/agentfootprint/api/generated/interfaces/FlowBreakEvent.md)

#### Returns

`void`

***

### onDecision()?

> `optional` **onDecision**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:317

#### Parameters

##### event

[`FlowDecisionEvent`](/agentfootprint/api/generated/interfaces/FlowDecisionEvent.md)

#### Returns

`void`

***

### onError()?

> `optional` **onError**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:326

#### Parameters

##### event

[`FlowErrorEvent`](/agentfootprint/api/generated/interfaces/FlowErrorEvent.md)

#### Returns

`void`

***

### onFork()?

> `optional` **onFork**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:318

#### Parameters

##### event

[`FlowForkEvent`](/agentfootprint/api/generated/interfaces/FlowForkEvent.md)

#### Returns

`void`

***

### onLoop()?

> `optional` **onLoop**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:324

#### Parameters

##### event

[`FlowLoopEvent`](/agentfootprint/api/generated/interfaces/FlowLoopEvent.md)

#### Returns

`void`

***

### onNext()?

> `optional` **onNext**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:316

#### Parameters

##### event

[`FlowNextEvent`](/agentfootprint/api/generated/interfaces/FlowNextEvent.md)

#### Returns

`void`

***

### onPause()?

> `optional` **onPause**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:327

#### Parameters

##### event

`FlowPauseEvent`

#### Returns

`void`

***

### onResume()?

> `optional` **onResume**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:328

#### Parameters

##### event

`FlowResumeEvent`

#### Returns

`void`

***

### onRunEnd()?

> `optional` **onRunEnd**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:339

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

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:346

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

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:333

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

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:319

#### Parameters

##### event

[`FlowSelectedEvent`](/agentfootprint/api/generated/interfaces/FlowSelectedEvent.md)

#### Returns

`void`

***

### onStageExecuted()?

> `optional` **onStageExecuted**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:315

#### Parameters

##### event

[`FlowStageEvent`](/agentfootprint/api/generated/interfaces/FlowStageEvent.md)

#### Returns

`void`

***

### onSubflowEntry()?

> `optional` **onSubflowEntry**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:320

#### Parameters

##### event

[`FlowSubflowEvent`](/agentfootprint/api/generated/interfaces/FlowSubflowEvent.md)

#### Returns

`void`

***

### onSubflowExit()?

> `optional` **onSubflowExit**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:321

#### Parameters

##### event

[`FlowSubflowEvent`](/agentfootprint/api/generated/interfaces/FlowSubflowEvent.md)

#### Returns

`void`

***

### onSubflowRegistered()?

> `optional` **onSubflowRegistered**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:323

Called when a dynamic subflow is registered during traversal.

#### Parameters

##### event

[`FlowSubflowRegisteredEvent`](/agentfootprint/api/generated/interfaces/FlowSubflowRegisteredEvent.md)

#### Returns

`void`

***

### toSnapshot()?

> `optional` **toSnapshot**(): `object`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:350

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

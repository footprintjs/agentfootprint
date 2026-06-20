---
title: CombinedRecorder
---

# Type Alias: CombinedRecorder

> **CombinedRecorder** = `Partial`\<`Omit`\<[`ScopeRecorder`](/docs/api/interfaces/ScopeRecorder), `SharedLifecycleOverlap` \| `SharedLifecycle`\>\> & `Partial`\<`Omit`\<[`FlowRecorder`](/docs/api/interfaces/FlowRecorder), `SharedLifecycleOverlap` \| `SharedLifecycle`\>\> & `Partial`\<`Omit`\<[`EmitRecorder`](/docs/api/interfaces/EmitRecorder), `SharedLifecycle`\>\> & `object`

Defined in: node\_modules/footprintjs/dist/types/lib/recorder/CombinedRecorder.d.ts:94

A recorder that MAY observe any combination of supported event streams.

Today's streams:
  - Scope data-flow (`ScopeRecorder`: onRead/onWrite/onCommit/onStageStart/…)
  - Control-flow (`FlowRecorder`: onDecision/onSubflowEntry/onLoop/…)

All event handlers are optional — implement only what you care about.
`id` is required so the library can deduplicate re-attaches.

## Shared method names (onError / onPause / onResume)

Both `ScopeRecorder` and `FlowRecorder` declare these with DIFFERENT payload
shapes. In a combined recorder, each such handler is called by BOTH
channels with its own variant. The parameter type is a union — consumers
can either handle both variants uniformly, or discriminate with
`isFlowEvent()` (explicit `channel` discriminant stamped by the engine).

## Forward compatibility

When a third observer type ships (e.g. `OperationRecorder`), the type
gains another `& Partial<…>` clause. Because every clause is `Partial`,
existing `CombinedRecorder` implementations remain type-valid.

## Type Declaration

### clear()?

> `optional` **clear**(): `void`

#### Returns

`void`

### delivery?

> `readonly` `optional` **delivery?**: `"inline"` \| `"deferred"`

Delivery tier for this recorder (RFC-001) — the FIELD form of the
`attachCombinedRecorder(r, { delivery })` options bag, so a recorder
can DECLARE its tier (`{ id, delivery: 'deferred', ...hooks }`) and
every attach site honors it. `'deferred'` routes the recorder's
events through the executor's bounded capture queue ("one beat
behind"); absent / `'inline'` keeps the historical synchronous call.
NOT an event method — channel routing detection counts event-METHOD
properties only, so this string field never affects which channels
the recorder lands on.

### id

> `readonly` **id**: `string`

### onError()?

> `optional` **onError**(`event`): `void`

#### Parameters

##### event

[`ErrorEvent`](/docs/api/interfaces/ErrorEvent) \| [`FlowErrorEvent`](/docs/api/interfaces/FlowErrorEvent)

#### Returns

`void`

### onPause()?

> `optional` **onPause**(`event`): `void`

#### Parameters

##### event

`PauseEvent` \| `FlowPauseEvent`

#### Returns

`void`

### onResume()?

> `optional` **onResume**(`event`): `void`

#### Parameters

##### event

`ResumeEvent` \| `FlowResumeEvent`

#### Returns

`void`

### toSnapshot()?

> `optional` **toSnapshot**(): `object`

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

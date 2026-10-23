---
title: CheckInRecorder
---

# Class: CheckInRecorder

Defined in: [src/recorders/core/CheckInRecorder.ts:95](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/CheckInRecorder.ts#L95)

A queryable store of every check-in ask + decision. Attach once; read after
the run (or between runs — it accumulates across `agent.run()` calls until
you detach or make a fresh one).

## Example

```ts
const checkins = new CheckInRecorder();
  agent.attach(checkins);
  await agent.run({ message });
  // ...human approves...
  await agent.resume(
    outcome.checkpoint,
    checkInApproved({ request: outcome.checkIn, by: 'alice' }),
  );
  checkins.getStats();     // { requested: 1, approved: 1, declined: 0, pending: 0 }
  checkins.getDecisions(); // [{ toolName, approved: true, by: 'alice', ... }]
```

## Implements

- [`CombinedRecorder`](/docs/api/type-aliases/CombinedRecorder)

## Constructors

### Constructor

> **new CheckInRecorder**(`id?`): `CheckInRecorder`

Defined in: [src/recorders/core/CheckInRecorder.ts:104](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/CheckInRecorder.ts#L104)

#### Parameters

##### id?

`string` = `'agentfootprint.checkin-recorder'`

Stable recorder id for idempotent attach/detach. Give distinct
          ids if you attach more than one to the same agent.

#### Returns

`CheckInRecorder`

## Properties

### id

> `readonly` **id**: `string`

Defined in: [src/recorders/core/CheckInRecorder.ts:96](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/CheckInRecorder.ts#L96)

#### Implementation of

`CombinedRecorder.id`

## Methods

### getDecisions()

> **getDecisions**(): readonly [`CheckInDecisionRecord`](/docs/api/interfaces/CheckInDecisionRecord)[]

Defined in: [src/recorders/core/CheckInRecorder.ts:138](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/CheckInRecorder.ts#L138)

Every human decision captured, oldest first.

#### Returns

readonly [`CheckInDecisionRecord`](/docs/api/interfaces/CheckInDecisionRecord)[]

***

### getRequests()

> **getRequests**(): readonly [`CheckInRequestRecord`](/docs/api/interfaces/CheckInRequestRecord)[]

Defined in: [src/recorders/core/CheckInRecorder.ts:133](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/CheckInRecorder.ts#L133)

Every check-in ask captured, oldest first.

#### Returns

readonly [`CheckInRequestRecord`](/docs/api/interfaces/CheckInRequestRecord)[]

***

### getStats()

> **getStats**(): [`CheckInStats`](/docs/api/interfaces/CheckInStats)

Defined in: [src/recorders/core/CheckInRecorder.ts:143](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/CheckInRecorder.ts#L143)

Roll-up counts. `pending` = asks still awaiting a decision.

#### Returns

[`CheckInStats`](/docs/api/interfaces/CheckInStats)

***

### onEmit()

> **onEmit**(`event`): `void`

Defined in: [src/recorders/core/CheckInRecorder.ts:108](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/CheckInRecorder.ts#L108)

Fires for every `scope.$emit(name, payload)` call during a stage.
Optional — implement only if you want to observe consumer-emitted
structured events. See `EmitRecorder` for the focused interface
(structurally compatible; this field is the same shape).

#### Parameters

##### event

[`EmitEvent`](/docs/api/interfaces/scope-events#interface-emitevent)

#### Returns

`void`

#### See

EmitRecorder in `src/lib/recorder/EmitRecorder.ts`

#### Implementation of

[`ScopeRecorder`](/docs/api/interfaces/ScopeRecorder).[`onEmit`](/docs/api/interfaces/ScopeRecorder#onemit)

***

### reset()

> **reset**(): `void`

Defined in: [src/recorders/core/CheckInRecorder.ts:156](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/CheckInRecorder.ts#L156)

Drop all captured records (e.g. between runs when reusing the recorder).

#### Returns

`void`

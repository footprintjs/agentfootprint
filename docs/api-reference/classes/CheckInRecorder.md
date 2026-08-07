[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CheckInRecorder

# Class: CheckInRecorder

Defined in: [src/recorders/core/CheckInRecorder.ts:87](https://github.com/footprintjs/agentfootprint/blob/095851064601e5ceb1fe1d6417a01f0c1cb4d731/src/recorders/core/CheckInRecorder.ts#L87)

A queryable store of every check-in ask + decision. Attach once; read after
the run (or between runs — it accumulates across `agent.run()` calls until
you detach or make a fresh one).

## Example

```ts
const checkins = new CheckInRecorder();
  agent.attach(checkins);
  await agent.run({ message });
  // ...human approves...
  await agent.resume(outcome.checkpoint, checkInApproved({ by: 'alice' }));
  checkins.getStats();     // { requested: 1, approved: 1, declined: 0, pending: 0 }
  checkins.getDecisions(); // [{ toolName, approved: true, by: 'alice', ... }]
```

## Implements

- [`CombinedRecorder`](/agentfootprint/api/generated/type-aliases/CombinedRecorder.md)

## Constructors

### Constructor

> **new CheckInRecorder**(`id?`): `CheckInRecorder`

Defined in: [src/recorders/core/CheckInRecorder.ts:96](https://github.com/footprintjs/agentfootprint/blob/095851064601e5ceb1fe1d6417a01f0c1cb4d731/src/recorders/core/CheckInRecorder.ts#L96)

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

Defined in: [src/recorders/core/CheckInRecorder.ts:88](https://github.com/footprintjs/agentfootprint/blob/095851064601e5ceb1fe1d6417a01f0c1cb4d731/src/recorders/core/CheckInRecorder.ts#L88)

#### Implementation of

`CombinedRecorder.id`

## Methods

### getDecisions()

> **getDecisions**(): readonly [`CheckInDecisionRecord`](/agentfootprint/api/generated/interfaces/CheckInDecisionRecord.md)[]

Defined in: [src/recorders/core/CheckInRecorder.ts:128](https://github.com/footprintjs/agentfootprint/blob/095851064601e5ceb1fe1d6417a01f0c1cb4d731/src/recorders/core/CheckInRecorder.ts#L128)

Every human decision captured, oldest first.

#### Returns

readonly [`CheckInDecisionRecord`](/agentfootprint/api/generated/interfaces/CheckInDecisionRecord.md)[]

***

### getRequests()

> **getRequests**(): readonly [`CheckInRequestRecord`](/agentfootprint/api/generated/interfaces/CheckInRequestRecord.md)[]

Defined in: [src/recorders/core/CheckInRecorder.ts:123](https://github.com/footprintjs/agentfootprint/blob/095851064601e5ceb1fe1d6417a01f0c1cb4d731/src/recorders/core/CheckInRecorder.ts#L123)

Every check-in ask captured, oldest first.

#### Returns

readonly [`CheckInRequestRecord`](/agentfootprint/api/generated/interfaces/CheckInRequestRecord.md)[]

***

### getStats()

> **getStats**(): [`CheckInStats`](/agentfootprint/api/generated/interfaces/CheckInStats.md)

Defined in: [src/recorders/core/CheckInRecorder.ts:133](https://github.com/footprintjs/agentfootprint/blob/095851064601e5ceb1fe1d6417a01f0c1cb4d731/src/recorders/core/CheckInRecorder.ts#L133)

Roll-up counts. `pending` = asks still awaiting a decision.

#### Returns

[`CheckInStats`](/agentfootprint/api/generated/interfaces/CheckInStats.md)

***

### onEmit()

> **onEmit**(`event`): `void`

Defined in: [src/recorders/core/CheckInRecorder.ts:100](https://github.com/footprintjs/agentfootprint/blob/095851064601e5ceb1fe1d6417a01f0c1cb4d731/src/recorders/core/CheckInRecorder.ts#L100)

Fires for every `scope.$emit(name, payload)` call during a stage.
Optional — implement only if you want to observe consumer-emitted
structured events. See `EmitRecorder` for the focused interface
(structurally compatible; this field is the same shape).

#### Parameters

##### event

[`EmitEvent`](/agentfootprint/api/generated/interfaces/EmitEvent.md)

#### Returns

`void`

#### See

EmitRecorder in `src/lib/recorder/EmitRecorder.ts`

#### Implementation of

[`ScopeRecorder`](/agentfootprint/api/generated/interfaces/ScopeRecorder.md).[`onEmit`](/agentfootprint/api/generated/interfaces/ScopeRecorder.md#onemit)

***

### reset()

> **reset**(): `void`

Defined in: [src/recorders/core/CheckInRecorder.ts:146](https://github.com/footprintjs/agentfootprint/blob/095851064601e5ceb1fe1d6417a01f0c1cb4d731/src/recorders/core/CheckInRecorder.ts#L146)

Drop all captured records (e.g. between runs when reusing the recorder).

#### Returns

`void`

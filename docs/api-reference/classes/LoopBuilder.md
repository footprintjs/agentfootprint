[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LoopBuilder

# Class: LoopBuilder

Defined in: [agentfootprint/src/core-flow/Loop.ts:262](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core-flow/Loop.ts#L262)

Fluent builder. Reads as natural English:
  Loop.create().repeat(runner).times(10).forAtMost(30_000).until(fn).build()
  →  "Loop: repeat runner, up to 10 times, for at most 30 seconds, until fn."

Enforces a body runner is supplied before .build(). Default budget is
10 iterations (hard ceiling 500). Any of .times / .forAtMost / .until
can fire to exit the loop.

## Constructors

### Constructor

> **new LoopBuilder**(`opts`): `LoopBuilder`

Defined in: [agentfootprint/src/core-flow/Loop.ts:269](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core-flow/Loop.ts#L269)

#### Parameters

##### opts

[`LoopOptions`](/agentfootprint/api/generated/interfaces/LoopOptions.md)

#### Returns

`LoopBuilder`

## Methods

### build()

> **build**(): [`Loop`](/agentfootprint/api/generated/classes/Loop.md)

Defined in: [agentfootprint/src/core-flow/Loop.ts:312](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core-flow/Loop.ts#L312)

#### Returns

[`Loop`](/agentfootprint/api/generated/classes/Loop.md)

***

### forAtMost()

> **forAtMost**(`ms`): `this`

Defined in: [agentfootprint/src/core-flow/Loop.ts:298](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core-flow/Loop.ts#L298)

Wall-clock time budget in milliseconds. The loop exits at the next
guard check after this elapses.

#### Parameters

##### ms

`number`

#### Returns

`this`

***

### repeat()

> **repeat**(`runner`): `this`

Defined in: [agentfootprint/src/core-flow/Loop.ts:277](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core-flow/Loop.ts#L277)

The runner that executes each iteration. Required.
Each iteration's output string becomes the next iteration's input `{ message }`.

#### Parameters

##### runner

`BodyChild`

#### Returns

`this`

***

### times()

> **times**(`n`): `this`

Defined in: [agentfootprint/src/core-flow/Loop.ts:289](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core-flow/Loop.ts#L289)

Maximum iteration count. Default 10 if only `.repeat()` is called.
Hard ceiling 500 — larger values are clamped.

#### Parameters

##### n

`number`

#### Returns

`this`

***

### until()

> **until**(`guard`): `this`

Defined in: [agentfootprint/src/core-flow/Loop.ts:307](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core-flow/Loop.ts#L307)

Exit predicate evaluated after each iteration. Return `true` to exit.
Receives `{ iteration, latestOutput, startMs }`.

#### Parameters

##### guard

[`UntilGuard`](/agentfootprint/api/generated/type-aliases/UntilGuard.md)

#### Returns

`this`

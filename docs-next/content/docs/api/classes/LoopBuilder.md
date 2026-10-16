---
title: LoopBuilder
---

# Class: LoopBuilder

Defined in: [src/core-flow/Loop.ts:447](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Loop.ts#L447)

## Constructors

### Constructor

> **new LoopBuilder**(`opts`): `LoopBuilder`

Defined in: [src/core-flow/Loop.ts:455](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Loop.ts#L455)

#### Parameters

##### opts

[`LoopOptions`](/docs/api/interfaces/LoopOptions)

#### Returns

`LoopBuilder`

## Methods

### build()

> **build**(): [`Loop`](/docs/api/classes/Loop)

Defined in: [src/core-flow/Loop.ts:509](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Loop.ts#L509)

#### Returns

[`Loop`](/docs/api/classes/Loop)

***

### forAtMost()

> **forAtMost**(`ms`): `this`

Defined in: [src/core-flow/Loop.ts:491](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Loop.ts#L491)

Wall-clock time budget in milliseconds. The loop exits at the next
guard check after this elapses.

#### Parameters

##### ms

`number`

#### Returns

`this`

***

### repeat()

> **repeat**(`runner`, `opts?`): `this`

Defined in: [src/core-flow/Loop.ts:467](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Loop.ts#L467)

The runner that executes each iteration. Required.
Each iteration's output string becomes the next iteration's input `{ message }`.

Optional second arg `opts.groupTranslator` overrides the body
runner's own translator for THIS loop only — only its
`member.uiGroup` flips to the override's output.

#### Parameters

##### runner

`BodyChild`

##### opts?

`LoopRepeatOptions`

#### Returns

`this`

***

### times()

> **times**(`n`): `this`

Defined in: [src/core-flow/Loop.ts:482](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Loop.ts#L482)

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

Defined in: [src/core-flow/Loop.ts:504](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Loop.ts#L504)

Exit predicate evaluated after each iteration. Return `true` to exit.
Receives `{ iteration, latestOutput, startMs }`.

`latestOutput` is the body's string output. For structured exit
conditions, emit JSON from the body and parse it inside the guard —
see the `UntilGuard` JSDoc for the pattern and the design rationale.

#### Parameters

##### guard

[`UntilGuard`](/docs/api/type-aliases/UntilGuard)

#### Returns

`this`

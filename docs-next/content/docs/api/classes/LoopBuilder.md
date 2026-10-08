---
title: LoopBuilder
---

# Class: LoopBuilder

Defined in: [src/core-flow/Loop.ts:397](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Loop.ts#L397)

## Constructors

### Constructor

> **new LoopBuilder**(`opts`): `LoopBuilder`

Defined in: [src/core-flow/Loop.ts:405](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Loop.ts#L405)

#### Parameters

##### opts

[`LoopOptions`](/docs/api/interfaces/LoopOptions)

#### Returns

`LoopBuilder`

## Methods

### build()

> **build**(): [`Loop`](/docs/api/classes/Loop)

Defined in: [src/core-flow/Loop.ts:459](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Loop.ts#L459)

#### Returns

[`Loop`](/docs/api/classes/Loop)

***

### forAtMost()

> **forAtMost**(`ms`): `this`

Defined in: [src/core-flow/Loop.ts:441](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Loop.ts#L441)

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

Defined in: [src/core-flow/Loop.ts:417](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Loop.ts#L417)

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

Defined in: [src/core-flow/Loop.ts:432](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Loop.ts#L432)

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

Defined in: [src/core-flow/Loop.ts:454](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Loop.ts#L454)

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

---
title: LoopBuilder
---

# Class: LoopBuilder

Defined in: [src/core-flow/Loop.ts:356](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/core-flow/Loop.ts#L356)

## Constructors

### Constructor

> **new LoopBuilder**(`opts`): `LoopBuilder`

Defined in: [src/core-flow/Loop.ts:364](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/core-flow/Loop.ts#L364)

#### Parameters

##### opts

[`LoopOptions`](/docs/api/interfaces/LoopOptions)

#### Returns

`LoopBuilder`

## Methods

### build()

> **build**(): [`Loop`](/docs/api/classes/Loop)

Defined in: [src/core-flow/Loop.ts:418](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/core-flow/Loop.ts#L418)

#### Returns

[`Loop`](/docs/api/classes/Loop)

***

### forAtMost()

> **forAtMost**(`ms`): `this`

Defined in: [src/core-flow/Loop.ts:400](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/core-flow/Loop.ts#L400)

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

Defined in: [src/core-flow/Loop.ts:376](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/core-flow/Loop.ts#L376)

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

Defined in: [src/core-flow/Loop.ts:391](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/core-flow/Loop.ts#L391)

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

Defined in: [src/core-flow/Loop.ts:413](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/core-flow/Loop.ts#L413)

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

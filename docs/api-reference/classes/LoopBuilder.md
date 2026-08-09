[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LoopBuilder

# Class: LoopBuilder

Defined in: [src/core-flow/Loop.ts:361](https://github.com/footprintjs/agentfootprint/blob/b523c2fedb76df5519470c43583559bfaafdfff4/src/core-flow/Loop.ts#L361)

## Constructors

### Constructor

> **new LoopBuilder**(`opts`): `LoopBuilder`

Defined in: [src/core-flow/Loop.ts:369](https://github.com/footprintjs/agentfootprint/blob/b523c2fedb76df5519470c43583559bfaafdfff4/src/core-flow/Loop.ts#L369)

#### Parameters

##### opts

[`LoopOptions`](/agentfootprint/api/generated/interfaces/LoopOptions.md)

#### Returns

`LoopBuilder`

## Methods

### build()

> **build**(): [`Loop`](/agentfootprint/api/generated/classes/Loop.md)

Defined in: [src/core-flow/Loop.ts:423](https://github.com/footprintjs/agentfootprint/blob/b523c2fedb76df5519470c43583559bfaafdfff4/src/core-flow/Loop.ts#L423)

#### Returns

[`Loop`](/agentfootprint/api/generated/classes/Loop.md)

***

### forAtMost()

> **forAtMost**(`ms`): `this`

Defined in: [src/core-flow/Loop.ts:405](https://github.com/footprintjs/agentfootprint/blob/b523c2fedb76df5519470c43583559bfaafdfff4/src/core-flow/Loop.ts#L405)

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

Defined in: [src/core-flow/Loop.ts:381](https://github.com/footprintjs/agentfootprint/blob/b523c2fedb76df5519470c43583559bfaafdfff4/src/core-flow/Loop.ts#L381)

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

Defined in: [src/core-flow/Loop.ts:396](https://github.com/footprintjs/agentfootprint/blob/b523c2fedb76df5519470c43583559bfaafdfff4/src/core-flow/Loop.ts#L396)

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

Defined in: [src/core-flow/Loop.ts:418](https://github.com/footprintjs/agentfootprint/blob/b523c2fedb76df5519470c43583559bfaafdfff4/src/core-flow/Loop.ts#L418)

Exit predicate evaluated after each iteration. Return `true` to exit.
Receives `{ iteration, latestOutput, startMs }`.

`latestOutput` is the body's string output. For structured exit
conditions, emit JSON from the body and parse it inside the guard —
see the `UntilGuard` JSDoc for the pattern and the design rationale.

#### Parameters

##### guard

[`UntilGuard`](/agentfootprint/api/generated/type-aliases/UntilGuard.md)

#### Returns

`this`

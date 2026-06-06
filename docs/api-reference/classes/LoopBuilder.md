[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LoopBuilder

# Class: LoopBuilder

Defined in: [src/core-flow/Loop.ts:337](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/core-flow/Loop.ts#L337)

## Constructors

### Constructor

> **new LoopBuilder**(`opts`): `LoopBuilder`

Defined in: [src/core-flow/Loop.ts:345](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/core-flow/Loop.ts#L345)

#### Parameters

##### opts

[`LoopOptions`](/agentfootprint/api/generated/interfaces/LoopOptions.md)

#### Returns

`LoopBuilder`

## Methods

### build()

> **build**(): [`Loop`](/agentfootprint/api/generated/classes/Loop.md)

Defined in: [src/core-flow/Loop.ts:395](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/core-flow/Loop.ts#L395)

#### Returns

[`Loop`](/agentfootprint/api/generated/classes/Loop.md)

***

### forAtMost()

> **forAtMost**(`ms`): `this`

Defined in: [src/core-flow/Loop.ts:381](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/core-flow/Loop.ts#L381)

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

Defined in: [src/core-flow/Loop.ts:357](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/core-flow/Loop.ts#L357)

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

Defined in: [src/core-flow/Loop.ts:372](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/core-flow/Loop.ts#L372)

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

Defined in: [src/core-flow/Loop.ts:390](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/core-flow/Loop.ts#L390)

Exit predicate evaluated after each iteration. Return `true` to exit.
Receives `{ iteration, latestOutput, startMs }`.

#### Parameters

##### guard

[`UntilGuard`](/agentfootprint/api/generated/type-aliases/UntilGuard.md)

#### Returns

`this`

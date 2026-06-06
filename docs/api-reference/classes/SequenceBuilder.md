[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / SequenceBuilder

# Class: SequenceBuilder

Defined in: [src/core-flow/Sequence.ts:285](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/core-flow/Sequence.ts#L285)

Fluent builder. Reads as natural English:
  Sequence.create().step('a', A).pipeVia(fn).step('b', B).build()
  →  "Sequence: step A, pipe via fn, step B."

`step(id, runner)` adds a sequential step. `pipeVia(fn)` customises
the transformation of the previous step's output before it feeds the
next step (otherwise the default string-chain mapper is used).

## Constructors

### Constructor

> **new SequenceBuilder**(`opts`): `SequenceBuilder`

Defined in: [src/core-flow/Sequence.ts:292](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/core-flow/Sequence.ts#L292)

#### Parameters

##### opts

[`SequenceOptions`](/agentfootprint/api/generated/interfaces/SequenceOptions.md)

#### Returns

`SequenceBuilder`

## Methods

### build()

> **build**(): [`Sequence`](/agentfootprint/api/generated/classes/Sequence.md)

Defined in: [src/core-flow/Sequence.ts:337](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/core-flow/Sequence.ts#L337)

#### Returns

[`Sequence`](/agentfootprint/api/generated/classes/Sequence.md)

***

### pipeVia()

> **pipeVia**(`fn`): `this`

Defined in: [src/core-flow/Sequence.ts:332](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/core-flow/Sequence.ts#L332)

Transform the previous step's string output before it reaches the
next step. Consumed once by the next `.step()` call. Default
mapping is `(prev) => ({ message: prev })`.

Reads as English: `.step('a', A).pipeVia(fn).step('b', B)`
→  "step A, pipe via fn, step B"

#### Parameters

##### fn

(`prev`) => `object`

#### Returns

`this`

***

### step()

> **step**(`id`, `runner`, `opts?`): `this`

Defined in: [src/core-flow/Sequence.ts:306](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/core-flow/Sequence.ts#L306)

Add a step. Runner must accept `{ message: string }` and return `string`.
First step receives the Sequence input; subsequent steps receive the
previous step's output (via the default string-chain mapper, or via
the transformer set by a preceding `.pipeVia(fn)` call).

Optional third arg `opts.groupTranslator` overrides the runner's
own constructor-level translator for THIS step only — only its
`member.uiGroup` flips to the override's output.

#### Parameters

##### id

`string`

##### runner

`StepChild`

##### opts?

`SequenceStepOptions`

#### Returns

`this`

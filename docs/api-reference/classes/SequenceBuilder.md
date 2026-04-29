[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / SequenceBuilder

# Class: SequenceBuilder

Defined in: [agentfootprint/src/core-flow/Sequence.ts:219](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core-flow/Sequence.ts#L219)

Fluent builder. Reads as natural English:
  Sequence.create().step('a', A).pipeVia(fn).step('b', B).build()
  →  "Sequence: step A, pipe via fn, step B."

`step(id, runner)` adds a sequential step. `pipeVia(fn)` customises
the transformation of the previous step's output before it feeds the
next step (otherwise the default string-chain mapper is used).

## Constructors

### Constructor

> **new SequenceBuilder**(`opts`): `SequenceBuilder`

Defined in: [agentfootprint/src/core-flow/Sequence.ts:226](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core-flow/Sequence.ts#L226)

#### Parameters

##### opts

[`SequenceOptions`](/agentfootprint/api/generated/interfaces/SequenceOptions.md)

#### Returns

`SequenceBuilder`

## Methods

### build()

> **build**(): [`Sequence`](/agentfootprint/api/generated/classes/Sequence.md)

Defined in: [agentfootprint/src/core-flow/Sequence.ts:260](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core-flow/Sequence.ts#L260)

#### Returns

[`Sequence`](/agentfootprint/api/generated/classes/Sequence.md)

***

### pipeVia()

> **pipeVia**(`fn`): `this`

Defined in: [agentfootprint/src/core-flow/Sequence.ts:255](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core-flow/Sequence.ts#L255)

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

> **step**(`id`, `runner`): `this`

Defined in: [agentfootprint/src/core-flow/Sequence.ts:236](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core-flow/Sequence.ts#L236)

Add a step. Runner must accept `{ message: string }` and return `string`.
First step receives the Sequence input; subsequent steps receive the
previous step's output (via the default string-chain mapper, or via
the transformer set by a preceding `.pipeVia(fn)` call).

#### Parameters

##### id

`string`

##### runner

`StepChild`

#### Returns

`this`

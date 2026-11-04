---
title: ConditionalBuilder
---

# Class: ConditionalBuilder

Defined in: [src/core-flow/Conditional.ts:359](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Conditional.ts#L359)

Fluent builder. Branches evaluate in registration order; first matching
predicate wins. `.otherwise()` is the mandatory fallback.

## Constructors

### Constructor

> **new ConditionalBuilder**(`opts`): `ConditionalBuilder`

Defined in: [src/core-flow/Conditional.ts:366](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Conditional.ts#L366)

#### Parameters

##### opts

[`ConditionalOptions`](/docs/api/interfaces/ConditionalOptions)

#### Returns

`ConditionalBuilder`

## Methods

### build()

> **build**(): [`Conditional`](/docs/api/classes/Conditional)

Defined in: [src/core-flow/Conditional.ts:443](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Conditional.ts#L443)

#### Returns

[`Conditional`](/docs/api/classes/Conditional)

***

### otherwise()

> **otherwise**(`id`, `runner`, `nameOrOpts?`): `this`

Defined in: [src/core-flow/Conditional.ts:416](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Conditional.ts#L416)

Register the fallback branch. Exactly ONE must be registered before build().
Third arg accepts a legacy `name` string OR a `ConditionalBranchOptions`
bag (same shape as `.when()`).

#### Parameters

##### id

`string`

##### runner

`BranchChild`

##### nameOrOpts?

`string` \| `ConditionalBranchOptions`

#### Returns

`this`

***

### when()

> **when**(`id`, `predicate`, `runner`, `nameOrOpts?`): `this`

Defined in: [src/core-flow/Conditional.ts:380](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Conditional.ts#L380)

Register a predicate-gated branch. `predicate` is a pure sync function
of the Conditional's input; if it returns true, the corresponding
runner executes. Branches evaluate in registration order.

Fourth arg accepts EITHER a legacy bare `name` string OR a
`ConditionalBranchOptions` bag containing `name` and/or a per-method
`groupTranslator` override. The override applies ONLY to this
branch's `member.uiGroup`.

#### Parameters

##### id

`string`

##### predicate

[`Predicate`](/docs/api/type-aliases/Predicate)

##### runner

`BranchChild`

##### nameOrOpts?

`string` \| `ConditionalBranchOptions`

#### Returns

`this`

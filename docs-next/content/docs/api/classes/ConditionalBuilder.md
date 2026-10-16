---
title: ConditionalBuilder
---

# Class: ConditionalBuilder

Defined in: [src/core-flow/Conditional.ts:419](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Conditional.ts#L419)

Fluent builder. Branches evaluate in registration order; first matching
predicate wins. `.otherwise()` is the mandatory fallback.

## Constructors

### Constructor

> **new ConditionalBuilder**(`opts`): `ConditionalBuilder`

Defined in: [src/core-flow/Conditional.ts:426](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Conditional.ts#L426)

#### Parameters

##### opts

[`ConditionalOptions`](/docs/api/interfaces/ConditionalOptions)

#### Returns

`ConditionalBuilder`

## Methods

### build()

> **build**(): [`Conditional`](/docs/api/classes/Conditional)

Defined in: [src/core-flow/Conditional.ts:503](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Conditional.ts#L503)

#### Returns

[`Conditional`](/docs/api/classes/Conditional)

***

### otherwise()

> **otherwise**(`id`, `runner`, `nameOrOpts?`): `this`

Defined in: [src/core-flow/Conditional.ts:476](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Conditional.ts#L476)

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

Defined in: [src/core-flow/Conditional.ts:440](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Conditional.ts#L440)

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

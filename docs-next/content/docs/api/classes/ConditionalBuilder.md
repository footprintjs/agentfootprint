---
title: ConditionalBuilder
---

# Class: ConditionalBuilder

Defined in: [src/core-flow/Conditional.ts:331](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/core-flow/Conditional.ts#L331)

Fluent builder. Branches evaluate in registration order; first matching
predicate wins. `.otherwise()` is the mandatory fallback.

## Constructors

### Constructor

> **new ConditionalBuilder**(`opts`): `ConditionalBuilder`

Defined in: [src/core-flow/Conditional.ts:338](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/core-flow/Conditional.ts#L338)

#### Parameters

##### opts

[`ConditionalOptions`](/docs/api/interfaces/ConditionalOptions)

#### Returns

`ConditionalBuilder`

## Methods

### build()

> **build**(): [`Conditional`](/docs/api/classes/Conditional)

Defined in: [src/core-flow/Conditional.ts:410](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/core-flow/Conditional.ts#L410)

#### Returns

[`Conditional`](/docs/api/classes/Conditional)

***

### otherwise()

> **otherwise**(`id`, `runner`, `nameOrOpts?`): `this`

Defined in: [src/core-flow/Conditional.ts:384](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/core-flow/Conditional.ts#L384)

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

Defined in: [src/core-flow/Conditional.ts:352](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/core-flow/Conditional.ts#L352)

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

[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ConditionalBuilder

# Class: ConditionalBuilder

Defined in: [src/core-flow/Conditional.ts:331](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core-flow/Conditional.ts#L331)

Fluent builder. Branches evaluate in registration order; first matching
predicate wins. `.otherwise()` is the mandatory fallback.

## Constructors

### Constructor

> **new ConditionalBuilder**(`opts`): `ConditionalBuilder`

Defined in: [src/core-flow/Conditional.ts:338](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core-flow/Conditional.ts#L338)

#### Parameters

##### opts

[`ConditionalOptions`](/agentfootprint/api/generated/interfaces/ConditionalOptions.md)

#### Returns

`ConditionalBuilder`

## Methods

### build()

> **build**(): [`Conditional`](/agentfootprint/api/generated/classes/Conditional.md)

Defined in: [src/core-flow/Conditional.ts:410](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core-flow/Conditional.ts#L410)

#### Returns

[`Conditional`](/agentfootprint/api/generated/classes/Conditional.md)

***

### otherwise()

> **otherwise**(`id`, `runner`, `nameOrOpts?`): `this`

Defined in: [src/core-flow/Conditional.ts:384](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core-flow/Conditional.ts#L384)

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

Defined in: [src/core-flow/Conditional.ts:352](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core-flow/Conditional.ts#L352)

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

[`Predicate`](/agentfootprint/api/generated/type-aliases/Predicate.md)

##### runner

`BranchChild`

##### nameOrOpts?

`string` \| `ConditionalBranchOptions`

#### Returns

`this`

[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ConditionalBuilder

# Class: ConditionalBuilder

Defined in: [src/core-flow/Conditional.ts:333](https://github.com/footprintjs/agentfootprint/blob/a056409d5d117d220bc61985a6eed33349eeca8f/src/core-flow/Conditional.ts#L333)

Fluent builder. Branches evaluate in registration order; first matching
predicate wins. `.otherwise()` is the mandatory fallback.

## Constructors

### Constructor

> **new ConditionalBuilder**(`opts`): `ConditionalBuilder`

Defined in: [src/core-flow/Conditional.ts:340](https://github.com/footprintjs/agentfootprint/blob/a056409d5d117d220bc61985a6eed33349eeca8f/src/core-flow/Conditional.ts#L340)

#### Parameters

##### opts

[`ConditionalOptions`](/agentfootprint/api/generated/interfaces/ConditionalOptions.md)

#### Returns

`ConditionalBuilder`

## Methods

### build()

> **build**(): [`Conditional`](/agentfootprint/api/generated/classes/Conditional.md)

Defined in: [src/core-flow/Conditional.ts:412](https://github.com/footprintjs/agentfootprint/blob/a056409d5d117d220bc61985a6eed33349eeca8f/src/core-flow/Conditional.ts#L412)

#### Returns

[`Conditional`](/agentfootprint/api/generated/classes/Conditional.md)

***

### otherwise()

> **otherwise**(`id`, `runner`, `nameOrOpts?`): `this`

Defined in: [src/core-flow/Conditional.ts:386](https://github.com/footprintjs/agentfootprint/blob/a056409d5d117d220bc61985a6eed33349eeca8f/src/core-flow/Conditional.ts#L386)

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

Defined in: [src/core-flow/Conditional.ts:354](https://github.com/footprintjs/agentfootprint/blob/a056409d5d117d220bc61985a6eed33349eeca8f/src/core-flow/Conditional.ts#L354)

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

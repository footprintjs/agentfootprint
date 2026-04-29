[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ConditionalBuilder

# Class: ConditionalBuilder

Defined in: [agentfootprint/src/core-flow/Conditional.ts:268](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core-flow/Conditional.ts#L268)

Fluent builder. Branches evaluate in registration order; first matching
predicate wins. `.otherwise()` is the mandatory fallback.

## Constructors

### Constructor

> **new ConditionalBuilder**(`opts`): `ConditionalBuilder`

Defined in: [agentfootprint/src/core-flow/Conditional.ts:275](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core-flow/Conditional.ts#L275)

#### Parameters

##### opts

[`ConditionalOptions`](/agentfootprint/api/generated/interfaces/ConditionalOptions.md)

#### Returns

`ConditionalBuilder`

## Methods

### build()

> **build**(): [`Conditional`](/agentfootprint/api/generated/classes/Conditional.md)

Defined in: [agentfootprint/src/core-flow/Conditional.ts:310](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core-flow/Conditional.ts#L310)

#### Returns

[`Conditional`](/agentfootprint/api/generated/classes/Conditional.md)

***

### otherwise()

> **otherwise**(`id`, `runner`, `name?`): `this`

Defined in: [agentfootprint/src/core-flow/Conditional.ts:296](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core-flow/Conditional.ts#L296)

Register the fallback branch. Exactly ONE must be registered before build().

#### Parameters

##### id

`string`

##### runner

`BranchChild`

##### name?

`string`

#### Returns

`this`

***

### when()

> **when**(`id`, `predicate`, `runner`, `name?`): `this`

Defined in: [agentfootprint/src/core-flow/Conditional.ts:284](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core-flow/Conditional.ts#L284)

Register a predicate-gated branch. `predicate` is a pure sync function
of the Conditional's input; if it returns true, the corresponding
runner executes. Branches evaluate in registration order.

#### Parameters

##### id

`string`

##### predicate

[`Predicate`](/agentfootprint/api/generated/type-aliases/Predicate.md)

##### runner

`BranchChild`

##### name?

`string`

#### Returns

`this`

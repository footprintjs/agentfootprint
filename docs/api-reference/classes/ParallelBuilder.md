[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ParallelBuilder

# Class: ParallelBuilder

Defined in: [src/core-flow/Parallel.ts:790](https://github.com/footprintjs/agentfootprint/blob/32e104eb37eda8e9e784e72e32543ab6d97d2318/src/core-flow/Parallel.ts#L790)

Fluent builder. Requires at least 2 branches + one merge strategy.

## Constructors

### Constructor

> **new ParallelBuilder**(`opts`): `ParallelBuilder`

Defined in: [src/core-flow/Parallel.ts:796](https://github.com/footprintjs/agentfootprint/blob/32e104eb37eda8e9e784e72e32543ab6d97d2318/src/core-flow/Parallel.ts#L796)

#### Parameters

##### opts

[`ParallelOptions`](/agentfootprint/api/generated/interfaces/ParallelOptions.md)

#### Returns

`ParallelBuilder`

## Methods

### branch()

> **branch**(`id`, `runner`, `nameOrOpts?`): `this`

Defined in: [src/core-flow/Parallel.ts:809](https://github.com/footprintjs/agentfootprint/blob/32e104eb37eda8e9e784e72e32543ab6d97d2318/src/core-flow/Parallel.ts#L809)

Add a branch. All branches run concurrently with the same input.

Third arg accepts EITHER a legacy bare `name` string (back-compat
with pre-L1c callers) OR a `ParallelBranchOptions` bag containing
`name` and/or a per-method `groupTranslator` override. The
override applies ONLY to this branch's `member.uiGroup` and does
not affect any other branch or the runner's own translator.

#### Parameters

##### id

`string`

##### runner

`BranchChild`

##### nameOrOpts?

`string` \| [`ParallelBranchOptions`](/agentfootprint/api/generated/interfaces/ParallelBranchOptions.md)

#### Returns

`this`

***

### build()

> **build**(): [`Parallel`](/agentfootprint/api/generated/classes/Parallel.md)

Defined in: [src/core-flow/Parallel.ts:880](https://github.com/footprintjs/agentfootprint/blob/32e104eb37eda8e9e784e72e32543ab6d97d2318/src/core-flow/Parallel.ts#L880)

#### Returns

[`Parallel`](/agentfootprint/api/generated/classes/Parallel.md)

***

### mergeOutcomesWithFn()

> **mergeOutcomesWithFn**(`fn`): `this`

Defined in: [src/core-flow/Parallel.ts:872](https://github.com/footprintjs/agentfootprint/blob/32e104eb37eda8e9e784e72e32543ab6d97d2318/src/core-flow/Parallel.ts#L872)

Tolerant merge — receives `{ [branchId]: BranchOutcome }` including
both successes (`{ ok: true, value }`) and failures (`{ ok: false, error }`).
Parallel does NOT throw on partial failure when this merge variant is
used; the consumer's `fn` decides how to handle it (fall back, surface
a warning, retry at a higher level, etc.).

Use the default `mergeWithFn` / `mergeWithLLM` variants when you want
a single failing branch to abort the whole Parallel loudly.

#### Parameters

##### fn

[`MergeOutcomesFn`](/agentfootprint/api/generated/type-aliases/MergeOutcomesFn.md)

#### Returns

`this`

***

### mergeWithFn()

> **mergeWithFn**(`fn`): `this`

Defined in: [src/core-flow/Parallel.ts:845](https://github.com/footprintjs/agentfootprint/blob/32e104eb37eda8e9e784e72e32543ab6d97d2318/src/core-flow/Parallel.ts#L845)

Merge branch results via a pure function.
`fn` receives `{ [branchId]: string }` and returns the merged string.

#### Parameters

##### fn

[`MergeFn`](/agentfootprint/api/generated/type-aliases/MergeFn.md)

#### Returns

`this`

***

### mergeWithLLM()

> **mergeWithLLM**(`opts`): `this`

Defined in: [src/core-flow/Parallel.ts:854](https://github.com/footprintjs/agentfootprint/blob/32e104eb37eda8e9e784e72e32543ab6d97d2318/src/core-flow/Parallel.ts#L854)

Merge branch results by feeding them to an LLM for synthesis.

#### Parameters

##### opts

[`MergeWithLLMOptions`](/agentfootprint/api/generated/interfaces/MergeWithLLMOptions.md)

#### Returns

`this`

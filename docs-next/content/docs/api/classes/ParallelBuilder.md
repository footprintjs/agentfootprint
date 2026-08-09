---
title: ParallelBuilder
---

# Class: ParallelBuilder

Defined in: [src/core-flow/Parallel.ts:790](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Parallel.ts#L790)

Fluent builder. Requires at least 2 branches + one merge strategy.

## Constructors

### Constructor

> **new ParallelBuilder**(`opts`): `ParallelBuilder`

Defined in: [src/core-flow/Parallel.ts:796](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Parallel.ts#L796)

#### Parameters

##### opts

[`ParallelOptions`](/docs/api/interfaces/ParallelOptions)

#### Returns

`ParallelBuilder`

## Methods

### branch()

> **branch**(`id`, `runner`, `nameOrOpts?`): `this`

Defined in: [src/core-flow/Parallel.ts:809](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Parallel.ts#L809)

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

`string` \| [`ParallelBranchOptions`](/docs/api/interfaces/ParallelBranchOptions)

#### Returns

`this`

***

### build()

> **build**(): [`Parallel`](/docs/api/classes/Parallel)

Defined in: [src/core-flow/Parallel.ts:880](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Parallel.ts#L880)

#### Returns

[`Parallel`](/docs/api/classes/Parallel)

***

### mergeOutcomesWithFn()

> **mergeOutcomesWithFn**(`fn`): `this`

Defined in: [src/core-flow/Parallel.ts:872](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Parallel.ts#L872)

Tolerant merge — receives `{ [branchId]: BranchOutcome }` including
both successes (`{ ok: true, value }`) and failures (`{ ok: false, error }`).
Parallel does NOT throw on partial failure when this merge variant is
used; the consumer's `fn` decides how to handle it (fall back, surface
a warning, retry at a higher level, etc.).

Use the default `mergeWithFn` / `mergeWithLLM` variants when you want
a single failing branch to abort the whole Parallel loudly.

#### Parameters

##### fn

[`MergeOutcomesFn`](/docs/api/type-aliases/MergeOutcomesFn)

#### Returns

`this`

***

### mergeWithFn()

> **mergeWithFn**(`fn`): `this`

Defined in: [src/core-flow/Parallel.ts:845](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Parallel.ts#L845)

Merge branch results via a pure function.
`fn` receives `{ [branchId]: string }` and returns the merged string.

#### Parameters

##### fn

[`MergeFn`](/docs/api/type-aliases/MergeFn)

#### Returns

`this`

***

### mergeWithLLM()

> **mergeWithLLM**(`opts`): `this`

Defined in: [src/core-flow/Parallel.ts:854](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Parallel.ts#L854)

Merge branch results by feeding them to an LLM for synthesis.

#### Parameters

##### opts

[`MergeWithLLMOptions`](/docs/api/interfaces/MergeWithLLMOptions)

#### Returns

`this`

[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ParallelBuilder

# Class: ParallelBuilder

Defined in: [agentfootprint/src/core-flow/Parallel.ts:340](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core-flow/Parallel.ts#L340)

Fluent builder. Requires at least 2 branches + one merge strategy.

## Constructors

### Constructor

> **new ParallelBuilder**(`opts`): `ParallelBuilder`

Defined in: [agentfootprint/src/core-flow/Parallel.ts:346](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core-flow/Parallel.ts#L346)

#### Parameters

##### opts

[`ParallelOptions`](/agentfootprint/api/generated/interfaces/ParallelOptions.md)

#### Returns

`ParallelBuilder`

## Methods

### branch()

> **branch**(`id`, `runner`, `name?`): `this`

Defined in: [agentfootprint/src/core-flow/Parallel.ts:351](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core-flow/Parallel.ts#L351)

Add a branch. All branches run concurrently with the same input.

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

### build()

> **build**(): [`Parallel`](/agentfootprint/api/generated/classes/Parallel.md)

Defined in: [agentfootprint/src/core-flow/Parallel.ts:399](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core-flow/Parallel.ts#L399)

#### Returns

[`Parallel`](/agentfootprint/api/generated/classes/Parallel.md)

***

### mergeOutcomesWithFn()

> **mergeOutcomesWithFn**(`fn`): `this`

Defined in: [agentfootprint/src/core-flow/Parallel.ts:391](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core-flow/Parallel.ts#L391)

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

Defined in: [agentfootprint/src/core-flow/Parallel.ts:364](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core-flow/Parallel.ts#L364)

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

Defined in: [agentfootprint/src/core-flow/Parallel.ts:373](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core-flow/Parallel.ts#L373)

Merge branch results by feeding them to an LLM for synthesis.

#### Parameters

##### opts

[`MergeWithLLMOptions`](/agentfootprint/api/generated/interfaces/MergeWithLLMOptions.md)

#### Returns

`this`

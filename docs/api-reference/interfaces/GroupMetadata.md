[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / GroupMetadata

# Interface: GroupMetadata

Defined in: [src/core/translator.ts:72](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/translator.ts#L72)

What a composition hands to its `groupTranslator` at build time.
All composition kinds emit the same shape — the `kind` discriminator
+ the `extra` bag carry per-composition specifics.

## Properties

### extra?

> `readonly` `optional` **extra?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/translator.ts:84](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/translator.ts#L84)

Composition-specific extras. Carried verbatim from the
composition's own state — `Parallel` puts the merge strategy
here, `Loop` puts iteration budgets, `Conditional` puts the
fallback branch id, etc. Closed enough per kind that consumers
can switch on `kind` to read it safely.

***

### id

> `readonly` **id**: `string`

Defined in: [src/core/translator.ts:74](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/translator.ts#L74)

***

### kind

> `readonly` **kind**: [`GroupKind`](/agentfootprint/api/generated/type-aliases/GroupKind.md)

Defined in: [src/core/translator.ts:73](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/translator.ts#L73)

***

### members

> `readonly` **members**: readonly [`GroupMember`](/agentfootprint/api/generated/interfaces/GroupMember.md)[]

Defined in: [src/core/translator.ts:76](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/translator.ts#L76)

***

### name

> `readonly` **name**: `string`

Defined in: [src/core/translator.ts:75](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/translator.ts#L75)

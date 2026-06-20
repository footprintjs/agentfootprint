---
title: GroupMetadata
---

# Interface: GroupMetadata

Defined in: [src/core/translator.ts:72](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/core/translator.ts#L72)

What a composition hands to its `groupTranslator` at build time.
All composition kinds emit the same shape — the `kind` discriminator
+ the `extra` bag carry per-composition specifics.

## Properties

### extra?

> `readonly` `optional` **extra?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/translator.ts:84](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/core/translator.ts#L84)

Composition-specific extras. Carried verbatim from the
composition's own state — `Parallel` puts the merge strategy
here, `Loop` puts iteration budgets, `Conditional` puts the
fallback branch id, etc. Closed enough per kind that consumers
can switch on `kind` to read it safely.

***

### id

> `readonly` **id**: `string`

Defined in: [src/core/translator.ts:74](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/core/translator.ts#L74)

***

### kind

> `readonly` **kind**: [`GroupKind`](/docs/api/type-aliases/GroupKind)

Defined in: [src/core/translator.ts:73](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/core/translator.ts#L73)

***

### members

> `readonly` **members**: readonly [`GroupMember`](/docs/api/interfaces/GroupMember)[]

Defined in: [src/core/translator.ts:76](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/core/translator.ts#L76)

***

### name

> `readonly` **name**: `string`

Defined in: [src/core/translator.ts:75](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/core/translator.ts#L75)

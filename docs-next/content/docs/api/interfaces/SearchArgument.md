---
title: SearchArgument
---

# Interface: SearchArgument

Defined in: [src/semantics/coverage/search/types.ts:43](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/search/types.ts#L43)

One input argument, classified. EVERY property of `inputSchema` needs one.

## Properties

### name

> `readonly` **name**: `string`

Defined in: [src/semantics/coverage/search/types.ts:44](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/search/types.ts#L44)

***

### role

> `readonly` **role**: [`SearchRole`](/docs/api/type-aliases/SearchRole)

Defined in: [src/semantics/coverage/search/types.ts:45](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/search/types.ts#L45)

***

### said?

> `readonly` `optional` **said?**: `Readonly`\<`Record`\<`string`, readonly `string`[]\>\>

Defined in: [src/semantics/coverage/search/types.ts:52](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/search/types.ts#L52)

The words a claim may use for each VALUE of a `filter` or `source`
argument — `{ critical: ['critical', 'sev1'] }`. Allowed on those two
roles only.

***

### whenOmitted?

> `readonly` `optional` **whenOmitted?**: `WhenOmitted`

Defined in: [src/semantics/coverage/search/types.ts:46](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/search/types.ts#L46)

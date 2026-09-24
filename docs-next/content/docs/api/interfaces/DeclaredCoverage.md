---
title: DeclaredCoverage
---

# Interface: DeclaredCoverage

Defined in: [src/core/agent/coverage/types.ts:186](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L186)

One coverage statement as the RUN recorded it — what the event carries and
what accumulates in `AgentState.coverageDeclared`.

`kind` is kept because the two read differently at the answer boundary: a
`'ledger'` bounds a verdict the answer is probably built on, an
`'absence'` bounds a search that found nothing.

## Extends

- [`Coverage`](/docs/api/interfaces/Coverage)

## Properties

### cannotCover

> `readonly` **cannotCover**: readonly [`CoverageItem`](/docs/api/interfaces/CoverageItem)[]

Defined in: [src/core/agent/coverage/types.ts:56](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L56)

#### Inherited from

[`Coverage`](/docs/api/interfaces/Coverage).[`cannotCover`](/docs/api/interfaces/Coverage#cannotcover)

***

### checked

> `readonly` **checked**: readonly [`CoverageItem`](/docs/api/interfaces/CoverageItem)[]

Defined in: [src/core/agent/coverage/types.ts:54](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L54)

#### Inherited from

[`Coverage`](/docs/api/interfaces/Coverage).[`checked`](/docs/api/interfaces/Coverage#checked)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/coverage/types.ts:190](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L190)

***

### kind

> `readonly` **kind**: `"absence"` \| `"ledger"`

Defined in: [src/core/agent/coverage/types.ts:187](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L187)

***

### lookedFor?

> `readonly` `optional` **lookedFor?**: `string`

Defined in: [src/core/agent/coverage/types.ts:192](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L192)

Present for `'absence'` only — what the search was for.

***

### notChecked

> `readonly` **notChecked**: readonly [`CoverageItem`](/docs/api/interfaces/CoverageItem)[]

Defined in: [src/core/agent/coverage/types.ts:55](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L55)

#### Inherited from

[`Coverage`](/docs/api/interfaces/Coverage).[`notChecked`](/docs/api/interfaces/Coverage#notchecked)

***

### toolCallId?

> `readonly` `optional` **toolCallId?**: `string`

Defined in: [src/core/agent/coverage/types.ts:189](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L189)

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/core/agent/coverage/types.ts:188](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L188)

---
title: DeclaredCoverage
---

# Interface: DeclaredCoverage

Defined in: [src/core/agent/coverage/types.ts:217](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L217)

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

Defined in: [src/core/agent/coverage/types.ts:87](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L87)

#### Inherited from

[`Coverage`](/docs/api/interfaces/Coverage).[`cannotCover`](/docs/api/interfaces/Coverage#cannotcover)

***

### checked

> `readonly` **checked**: readonly [`CoverageItem`](/docs/api/interfaces/CoverageItem)[]

Defined in: [src/core/agent/coverage/types.ts:85](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L85)

#### Inherited from

[`Coverage`](/docs/api/interfaces/Coverage).[`checked`](/docs/api/interfaces/Coverage#checked)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/coverage/types.ts:221](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L221)

***

### kind

> `readonly` **kind**: `"absence"` \| `"ledger"`

Defined in: [src/core/agent/coverage/types.ts:218](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L218)

***

### lookedFor?

> `readonly` `optional` **lookedFor?**: `string`

Defined in: [src/core/agent/coverage/types.ts:223](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L223)

Present for `'absence'` only — what the search was for.

***

### notChecked

> `readonly` **notChecked**: readonly [`CoverageItem`](/docs/api/interfaces/CoverageItem)[]

Defined in: [src/core/agent/coverage/types.ts:86](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L86)

#### Inherited from

[`Coverage`](/docs/api/interfaces/Coverage).[`notChecked`](/docs/api/interfaces/Coverage#notchecked)

***

### toolCallId?

> `readonly` `optional` **toolCallId?**: `string`

Defined in: [src/core/agent/coverage/types.ts:220](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L220)

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/core/agent/coverage/types.ts:219](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L219)

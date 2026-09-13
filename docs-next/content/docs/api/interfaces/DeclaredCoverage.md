---
title: DeclaredCoverage
---

# Interface: DeclaredCoverage

Defined in: src/core/agent/coverage/types.ts:143

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

Defined in: src/core/agent/coverage/types.ts:56

#### Inherited from

[`Coverage`](/docs/api/interfaces/Coverage).[`cannotCover`](/docs/api/interfaces/Coverage#cannotcover)

***

### checked

> `readonly` **checked**: readonly [`CoverageItem`](/docs/api/interfaces/CoverageItem)[]

Defined in: src/core/agent/coverage/types.ts:54

#### Inherited from

[`Coverage`](/docs/api/interfaces/Coverage).[`checked`](/docs/api/interfaces/Coverage#checked)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: src/core/agent/coverage/types.ts:147

***

### kind

> `readonly` **kind**: `"absence"` \| `"ledger"`

Defined in: src/core/agent/coverage/types.ts:144

***

### lookedFor?

> `readonly` `optional` **lookedFor?**: `string`

Defined in: src/core/agent/coverage/types.ts:149

Present for `'absence'` only — what the search was for.

***

### notChecked

> `readonly` **notChecked**: readonly [`CoverageItem`](/docs/api/interfaces/CoverageItem)[]

Defined in: src/core/agent/coverage/types.ts:55

#### Inherited from

[`Coverage`](/docs/api/interfaces/Coverage).[`notChecked`](/docs/api/interfaces/Coverage#notchecked)

***

### toolCallId?

> `readonly` `optional` **toolCallId?**: `string`

Defined in: src/core/agent/coverage/types.ts:146

***

### toolName

> `readonly` **toolName**: `string`

Defined in: src/core/agent/coverage/types.ts:145

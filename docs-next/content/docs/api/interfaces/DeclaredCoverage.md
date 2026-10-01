---
title: DeclaredCoverage
---

# Interface: DeclaredCoverage

Defined in: src/core/agent/coverage/types.ts:315

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

Defined in: src/core/agent/coverage/types.ts:127

#### Inherited from

[`Coverage`](/docs/api/interfaces/Coverage).[`cannotCover`](/docs/api/interfaces/Coverage#cannotcover)

***

### checked

> `readonly` **checked**: readonly [`CoverageItem`](/docs/api/interfaces/CoverageItem)[]

Defined in: src/core/agent/coverage/types.ts:125

#### Inherited from

[`Coverage`](/docs/api/interfaces/Coverage).[`checked`](/docs/api/interfaces/Coverage#checked)

***

### inProgress?

> `readonly` `optional` **inProgress?**: readonly [`InProgressItem`](/docs/api/interfaces/InProgressItem)[]

Defined in: src/core/agent/coverage/types.ts:335

What the call found still running — its outcome not known yet — as the
`coverage()` declared it (copied item by item; `short` and `count` when
valid). Present only on a `'ledger'` row whose envelope declared a
well-formed, non-empty `in_progress`.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: src/core/agent/coverage/types.ts:319

***

### kind

> `readonly` **kind**: `"absence"` \| `"ledger"`

Defined in: src/core/agent/coverage/types.ts:316

***

### lookedFor?

> `readonly` `optional` **lookedFor?**: `string`

Defined in: src/core/agent/coverage/types.ts:321

Present for `'absence'` only — what the search was for.

***

### notChecked

> `readonly` **notChecked**: readonly [`CoverageItem`](/docs/api/interfaces/CoverageItem)[]

Defined in: src/core/agent/coverage/types.ts:126

#### Inherited from

[`Coverage`](/docs/api/interfaces/Coverage).[`notChecked`](/docs/api/interfaces/Coverage#notchecked)

***

### period?

> `readonly` `optional` **period?**: [`DeclaredPeriod`](/docs/api/interfaces/DeclaredPeriod)

Defined in: src/core/agent/coverage/types.ts:328

The period the declaration said its read covered, in the record's
camelCase form (honesty step 7b) — present only when the envelope declared
a well-formed one. A described result with a period and no coverage lists
files a `'ledger'` row whose three lists are empty.

***

### toolCallId?

> `readonly` `optional` **toolCallId?**: `string`

Defined in: src/core/agent/coverage/types.ts:318

***

### toolName

> `readonly` **toolName**: `string`

Defined in: src/core/agent/coverage/types.ts:317

---
title: DeclaredCoverage
---

# Interface: DeclaredCoverage

Defined in: [src/core/agent/coverage/types.ts:271](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L271)

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

Defined in: [src/core/agent/coverage/types.ts:97](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L97)

#### Inherited from

[`Coverage`](/docs/api/interfaces/Coverage).[`cannotCover`](/docs/api/interfaces/Coverage#cannotcover)

***

### checked

> `readonly` **checked**: readonly [`CoverageItem`](/docs/api/interfaces/CoverageItem)[]

Defined in: [src/core/agent/coverage/types.ts:95](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L95)

#### Inherited from

[`Coverage`](/docs/api/interfaces/Coverage).[`checked`](/docs/api/interfaces/Coverage#checked)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/coverage/types.ts:275](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L275)

***

### kind

> `readonly` **kind**: `"absence"` \| `"ledger"`

Defined in: [src/core/agent/coverage/types.ts:272](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L272)

***

### lookedFor?

> `readonly` `optional` **lookedFor?**: `string`

Defined in: [src/core/agent/coverage/types.ts:277](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L277)

Present for `'absence'` only — what the search was for.

***

### notChecked

> `readonly` **notChecked**: readonly [`CoverageItem`](/docs/api/interfaces/CoverageItem)[]

Defined in: [src/core/agent/coverage/types.ts:96](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L96)

#### Inherited from

[`Coverage`](/docs/api/interfaces/Coverage).[`notChecked`](/docs/api/interfaces/Coverage#notchecked)

***

### period?

> `readonly` `optional` **period?**: [`DeclaredPeriod`](/docs/api/interfaces/DeclaredPeriod)

Defined in: [src/core/agent/coverage/types.ts:284](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L284)

The period the declaration said its read covered, in the record's
camelCase form (honesty step 7b) — present only when the envelope declared
a well-formed one. A described result with a period and no coverage lists
files a `'ledger'` row whose three lists are empty.

***

### toolCallId?

> `readonly` `optional` **toolCallId?**: `string`

Defined in: [src/core/agent/coverage/types.ts:274](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L274)

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/core/agent/coverage/types.ts:273](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L273)

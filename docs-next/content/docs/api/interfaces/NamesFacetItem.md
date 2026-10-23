---
title: NamesFacetItem
---

# Interface: NamesFacetItem

Defined in: [src/semantics/coverage/types.ts:285](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L285)

The names facet an `among` miss composes — the first `checked` item. A
[CoverageItem](/docs/api/interfaces/CoverageItem) whose `what` the library writes from the declaration
(never from the looked-for value).

## Extends

- [`CoverageItem`](/docs/api/interfaces/CoverageItem)

## Properties

### argument

> `readonly` **argument**: `string`

Defined in: [src/semantics/coverage/types.ts:288](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L288)

The input argument whose value was looked up.

***

### authoritative?

> `readonly` `optional` **authoritative?**: `object`

Defined in: [src/semantics/coverage/types.ts:296](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L296)

Present only when the author declared the list authoritative.

#### why

> `readonly` **why**: `string`

***

### count

> `readonly` **count**: `number`

Defined in: [src/semantics/coverage/types.ts:290](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L290)

How many names the list holds.

***

### facet

> `readonly` **facet**: `"names"`

Defined in: [src/semantics/coverage/types.ts:286](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L286)

***

### from

> `readonly` **from**: `"result"`

Defined in: [src/semantics/coverage/types.ts:294](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L294)

The names came from the tool's own read.

***

### kind?

> `readonly` `optional` **kind?**: `"scope"` \| `"existence"`

Defined in: [src/semantics/coverage/types.ts:69](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L69)

What kind of ground a `notChecked` or `cannotCover` item is — a CLOSED
set, read by the answer account's existence check:

  • `'existence'` — whether the thing asked about exists at all, or is
    the kind of thing the question assumes ("whether that name is a
    storage array").
  • `'scope'` — a population, family or source outside what this tool
    reaches ("hosts that are not VMware").

Refused on `checked`. RECORD-ONLY, like `short`. Absent = not declared:
a reader never infers a kind from `what`. Library code never switches
EXHAUSTIVELY over this union (every switch has a `default` arm), so a
later member is an additive change for producers.

#### Inherited from

[`CoverageItem`](/docs/api/interfaces/CoverageItem).[`kind`](/docs/api/interfaces/CoverageItem#kind)

***

### short?

> `readonly` `optional` **short?**: `string`

Defined in: [src/semantics/coverage/types.ts:53](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L53)

A short plain form of `what`, for a person reading a report — "every VM
disk in the RVTools export of 2026-09-19" for a `what` that names the two
tables it read. Optional; at most 80 characters, one line, and never
longer than `what`.

RECORD-ONLY: it rides the events (`tools.absent`,
`tools.coverage_declared`), the tracked `coverageDeclared` rows and the
answer account, and is REMOVED from what the model is served
(`read.ts` · `servedToModel`). It is also withheld from the evidence
corpus (`evidence.ts`), because it is the field an author is most tempted
to personalise: NEVER interpolate the caller's arguments into it — a true
short form restates `what`, so no value should live only here.

#### Inherited from

[`CoverageItem`](/docs/api/interfaces/CoverageItem).[`short`](/docs/api/interfaces/CoverageItem#short)

***

### source

> `readonly` **source**: `string`

Defined in: [src/semantics/coverage/types.ts:292](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L292)

The list, as declared.

***

### what

> `readonly` **what**: `string`

Defined in: [src/semantics/coverage/types.ts:31](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L31)

The source, window, filter or population. Non-empty.

#### Inherited from

[`CoverageItem`](/docs/api/interfaces/CoverageItem).[`what`](/docs/api/interfaces/CoverageItem#what)

***

### why?

> `readonly` `optional` **why?**: `string`

Defined in: [src/semantics/coverage/types.ts:38](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L38)

Why it sits where it does. REQUIRED on `cannotCover` (a permanent blind
spot is a claim about capability, and a claim with no reason cannot be
acted on or disproved); optional on `checked` and `notChecked`, where
"we did" and "we did not need to" are often the whole story.

#### Inherited from

[`CoverageItem`](/docs/api/interfaces/CoverageItem).[`why`](/docs/api/interfaces/CoverageItem#why)

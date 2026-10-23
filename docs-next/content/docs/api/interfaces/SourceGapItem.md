---
title: SourceGapItem
---

# Interface: SourceGapItem

Defined in: [src/semantics/coverage/types.ts:306](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L306)

The gap an `among` miss adds and its author cannot remove — the first
`not_checked` item: names outside the source the tool read. It bears on the
source facet: a claim that leaves the source open (a flat "X does not
exist") rests on ground this search never covered. `kind` is record-only,
like every item's.

## Extends

- [`CoverageItem`](/docs/api/interfaces/CoverageItem)

## Properties

### bears

> `readonly` **bears**: `"source"`

Defined in: [src/semantics/coverage/types.ts:309](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L309)

***

### kind

> `readonly` **kind**: `"scope"`

Defined in: [src/semantics/coverage/types.ts:307](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L307)

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

#### Overrides

[`CoverageItem`](/docs/api/interfaces/CoverageItem).[`kind`](/docs/api/interfaces/CoverageItem#kind)

***

### relevance

> `readonly` **relevance**: `"bears"`

Defined in: [src/semantics/coverage/types.ts:308](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L308)

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

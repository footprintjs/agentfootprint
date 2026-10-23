---
title: ComposedItem
---

# Interface: ComposedItem

Defined in: [src/semantics/coverage/composedCoverage.ts:90](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/composedCoverage.ts#L90)

One piece of ground the library composed. `what` is library-composed text
— `<argument>: <value>`, `<argument>: any`, `<name>: <value>` for a fixed
qualifier, or the declared source's `what` — never a sentence the tool
wrote.

## Extends

- [`CoverageItem`](/docs/api/interfaces/CoverageItem)

## Properties

### any?

> `readonly` `optional` **any?**: `true`

Defined in: [src/semantics/coverage/composedCoverage.ts:106](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/composedCoverage.ts#L106)

Omission narrows nothing (`whenOmitted: { any: true }`).

***

### argument?

> `readonly` `optional` **argument?**: `string`

Defined in: [src/semantics/coverage/composedCoverage.ts:93](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/composedCoverage.ts#L93)

The input argument (or fixed qualifier) this facet is — absent for the declared source.

***

### facet

> `readonly` **facet**: `CoverageFacet`

Defined in: [src/semantics/coverage/composedCoverage.ts:91](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/composedCoverage.ts#L91)

***

### from

> `readonly` **from**: `FacetOrigin`

Defined in: [src/semantics/coverage/composedCoverage.ts:107](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/composedCoverage.ts#L107)

***

### kind?

> `readonly` `optional` **kind?**: `"scope"` \| `"existence"`

Defined in: [src/semantics/coverage/types.ts:70](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L70)

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

### quote?

> `readonly` `optional` **quote?**: `true`

Defined in: [src/semantics/coverage/composedCoverage.ts:104](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/composedCoverage.ts#L104)

The value (or `resolved`) came from outside the declaration — the call or
the result — so a writer that puts it in a statement QUOTES it, strips it
to one line and caps it. Stored raw here; marked, never rewritten.

***

### resolved?

> `readonly` `optional` **resolved?**: `ResolvedEntity`

Defined in: [src/semantics/coverage/composedCoverage.ts:109](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/composedCoverage.ts#L109)

The entity a population value resolved to — see ResolvedEntity.

***

### said?

> `readonly` `optional` **said?**: readonly `string`[]

Defined in: [src/semantics/coverage/composedCoverage.ts:116](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/composedCoverage.ts#L116)

The declared words for this facet value — `source.said`, a fixed
qualifier's `said`, a filter value's `said` entry. Carried on the row so a
checker reading committed rows only can match a claim's words; never
served to the model.

***

### short?

> `readonly` `optional` **short?**: `string`

Defined in: [src/semantics/coverage/types.ts:54](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L54)

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

### span?

> `readonly` `optional` **span?**: `ComposedSpan`

Defined in: [src/semantics/coverage/composedCoverage.ts:122](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/composedCoverage.ts#L122)

A period facet's span: a relative window (`'2h'`) resolved against the
TURN's clock, so the same spelling in one turn is the same span; or the
result's own `period.queried` (`from: 'result'`).

***

### value?

> `readonly` `optional` **value?**: `unknown`

Defined in: [src/semantics/coverage/composedCoverage.ts:98](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/composedCoverage.ts#L98)

The value in effect, RAW. Absent when `any` is set and for the declared
source; an IdentityReference for a host-filled facet.

***

### what

> `readonly` **what**: `string`

Defined in: [src/semantics/coverage/types.ts:32](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L32)

The source, window, filter or population. Non-empty.

#### Inherited from

[`CoverageItem`](/docs/api/interfaces/CoverageItem).[`what`](/docs/api/interfaces/CoverageItem#what)

***

### why?

> `readonly` `optional` **why?**: `string`

Defined in: [src/semantics/coverage/types.ts:39](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L39)

Why it sits where it does. REQUIRED on `cannotCover` (a permanent blind
spot is a claim about capability, and a claim with no reason cannot be
acted on or disproved); optional on `checked` and `notChecked`, where
"we did" and "we did not need to" are often the whole story.

#### Inherited from

[`CoverageItem`](/docs/api/interfaces/CoverageItem).[`why`](/docs/api/interfaces/CoverageItem#why)

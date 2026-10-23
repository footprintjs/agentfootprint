---
title: AbsenceAmongDeclaration
---

# Interface: AbsenceAmongDeclaration

Defined in: [src/semantics/coverage/types.ts:302](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L302)

`absent()` given an [AmongDeclaration](/docs/api/interfaces/AmongDeclaration): `checked` becomes optional (the
mint composes the names facet first) and `provenance` is refused — `among`
composes it from its own `source` and `measuredAt`.

## Extends

- `Omit`\<[`AbsenceDeclaration`](/docs/api/interfaces/AbsenceDeclaration), `"checked"` \| `"provenance"`\>

## Properties

### among

> `readonly` **among**: [`AmongDeclaration`](/docs/api/interfaces/AmongDeclaration)

Defined in: [src/semantics/coverage/types.ts:305](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L305)

The list the missed name was looked up in.

***

### cannotCover?

> `readonly` `optional` **cannotCover?**: readonly [`CoverageInput`](/docs/api/type-aliases/CoverageInput)[]

Defined in: [src/semantics/coverage/types.ts:178](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L178)

Ground no search by this tool can reach. Each needs a `why`.

#### Inherited from

[`AbsenceDeclaration`](/docs/api/interfaces/AbsenceDeclaration).[`cannotCover`](/docs/api/interfaces/AbsenceDeclaration#cannotcover)

***

### checked?

> `readonly` `optional` **checked?**: readonly [`CoverageInput`](/docs/api/type-aliases/CoverageInput)[]

Defined in: [src/semantics/coverage/types.ts:307](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L307)

Further ground the search covered, after the composed names facet.

***

### notChecked?

> `readonly` `optional` **notChecked?**: readonly [`CoverageInput`](/docs/api/type-aliases/CoverageInput)[]

Defined in: [src/semantics/coverage/types.ts:176](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L176)

Ground the search did not reach this time — an absence here proves
 nothing about it.

#### Inherited from

[`AbsenceDeclaration`](/docs/api/interfaces/AbsenceDeclaration).[`notChecked`](/docs/api/interfaces/AbsenceDeclaration#notchecked)

***

### paging?

> `readonly` `optional` **paging?**: `PagingDeclaration`

Defined in: [src/semantics/coverage/types.ts:230](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L230)

Whether there is a next page — `{ next: null }` says there is none. A tool
with a `page` argument whose result declares no `paging` is never complete.

#### Inherited from

[`AbsenceDeclaration`](/docs/api/interfaces/AbsenceDeclaration).[`paging`](/docs/api/interfaces/AbsenceDeclaration#paging)

***

### period?

> `readonly` `optional` **period?**: [`DeclaredPeriod`](/docs/api/interfaces/DeclaredPeriod)

Defined in: [src/semantics/coverage/types.ts:218](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L218)

What the search's READ covered in time — the instants it asked for, and
what the store holds (or `'unknown'`, said out loud) — honesty step 7b.
Every value is an ISO 8601 instant with a zone; a malformed period is
refused here. The results layer files its verdict (covered · partly held ·
not held · unknown), and `.limitsTravelWithTheAnswer()` prints it.

#### Inherited from

[`AbsenceDeclaration`](/docs/api/interfaces/AbsenceDeclaration).[`period`](/docs/api/interfaces/AbsenceDeclaration#period)

***

### resolved?

> `readonly` `optional` **resolved?**: readonly `ResolvedDeclaration`[]

Defined in: [src/semantics/coverage/types.ts:225](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L225)

The entity each population value RESOLVED to — `[{ argument, id, name?,
aliases? }]` — the tool's own claim, said out loud. Read by a tool that
declares its `search`: it binds the value the call was SENT for and no
other entity. Refused here when malformed.

#### Inherited from

[`AbsenceDeclaration`](/docs/api/interfaces/AbsenceDeclaration).[`resolved`](/docs/api/interfaces/AbsenceDeclaration#resolved)

***

### tryInstead?

> `readonly` `optional` **tryInstead?**: `string`

Defined in: [src/semantics/coverage/types.ts:189](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L189)

Where to go INSTEAD, in one sentence ("widen the window with
`window: '7d'`, or ask for a different interface"). Optional, and the
highest-value optional field in the shape: the loop this primitive stops
is a model with nowhere else to go.

Prose for the model. Nothing in this library reads a tool name out of it:
when the sentence points at another tool, name that tool in
[AbsenceDeclaration.tryInsteadTool](/docs/api/interfaces/AbsenceDeclaration#tryinsteadtool) as well.

#### Inherited from

[`AbsenceDeclaration`](/docs/api/interfaces/AbsenceDeclaration).[`tryInstead`](/docs/api/interfaces/AbsenceDeclaration#tryinstead)

***

### tryInsteadTool?

> `readonly` `optional` **tryInsteadTool?**: [`TryInsteadTool`](/docs/api/interfaces/TryInsteadTool)

Defined in: [src/semantics/coverage/types.ts:199](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L199)

The other TOOL the suggestion points at, as data (9.113.0) —
`{ tool, why? }`. Beside the sentence, not instead of it: the sentence is
what the model is told, this is what a reader reads without parsing
prose. Either may be given without the other; when both are given they
must name the same tool, and the library cannot check that they do — it
would have to read a tool name out of the sentence. ONE tool; a list is
refused (see `absent.ts` · `readToolSuggestion` for why).

#### Inherited from

[`AbsenceDeclaration`](/docs/api/interfaces/AbsenceDeclaration).[`tryInsteadTool`](/docs/api/interfaces/AbsenceDeclaration#tryinsteadtool)

***

### what

> `readonly` **what**: `string`

Defined in: [src/semantics/coverage/types.ts:166](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L166)

What was looked for, in the author's own words ("FLOGI entries on
fc1/3"). Required: an absence that cannot say what it did not find is
indistinguishable from a tool that returned nothing by accident.

#### Inherited from

[`AbsenceDeclaration`](/docs/api/interfaces/AbsenceDeclaration).[`what`](/docs/api/interfaces/AbsenceDeclaration#what)

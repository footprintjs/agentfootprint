---
title: AbsenceDeclaration
---

# Interface: AbsenceDeclaration

Defined in: [src/semantics/coverage/types.ts:160](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L160)

What a tool author passes to import('./absent.js').absent.

## Properties

### cannotCover?

> `readonly` `optional` **cannotCover?**: readonly [`CoverageInput`](/docs/api/type-aliases/CoverageInput)[]

Defined in: [src/semantics/coverage/types.ts:178](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L178)

Ground no search by this tool can reach. Each needs a `why`.

***

### checked

> `readonly` **checked**: readonly [`CoverageInput`](/docs/api/type-aliases/CoverageInput)[]

Defined in: [src/semantics/coverage/types.ts:173](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L173)

The coverage of the search — REQUIRED and non-empty. An absence that
names no coverage is a `null` with extra steps: the reader still cannot
tell "I looked and there is nothing" from "I could not look", which is
the entire failure this primitive exists to prevent.

***

### notChecked?

> `readonly` `optional` **notChecked?**: readonly [`CoverageInput`](/docs/api/type-aliases/CoverageInput)[]

Defined in: [src/semantics/coverage/types.ts:176](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L176)

Ground the search did not reach this time — an absence here proves
 nothing about it.

***

### paging?

> `readonly` `optional` **paging?**: `PagingDeclaration`

Defined in: [src/semantics/coverage/types.ts:230](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L230)

Whether there is a next page — `{ next: null }` says there is none. A tool
with a `page` argument whose result declares no `paging` is never complete.

***

### period?

> `readonly` `optional` **period?**: [`DeclaredPeriod`](/docs/api/interfaces/DeclaredPeriod)

Defined in: [src/semantics/coverage/types.ts:218](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L218)

What the search's READ covered in time — the instants it asked for, and
what the store holds (or `'unknown'`, said out loud) — honesty step 7b.
Every value is an ISO 8601 instant with a zone; a malformed period is
refused here. The results layer files its verdict (covered · partly held ·
not held · unknown), and `.limitsTravelWithTheAnswer()` prints it.

***

### provenance?

> `readonly` `optional` **provenance?**: `object`

Defined in: [src/semantics/coverage/types.ts:210](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L210)

Where the search looked and how old that source is — the SAME shape
`describedResult()` declares (`measuredAt`, `source`, and optionally
`ageSeconds`, `sourceExportDate`), respelled to the same snake_case wire
(honesty step 7b). `measuredAt` and `source` are both required once it is
present. So the found branch and the not-found branch of one `execute`
carry their source and time in one shape: "searched the 02:00 export —
nothing" as data, not prose in `checked`. `measuredAt` is the tool's own
words, never parsed.

#### ageSeconds?

> `readonly` `optional` **ageSeconds?**: `number`

How stale the data was when the tool answered, in seconds.

#### measuredAt

> `readonly` **measuredAt**: `string`

When the WORLD was measured, in the tool's own clock words — never
parsed. Take it from the data: the export's time for a file, the moment
of the read for a live query, the newest sample for a series, and the END
of the window for a value computed over one.

#### source

> `readonly` **source**: `string`

The system of record the values were read from.

#### sourceExportDate?

> `readonly` `optional` **sourceExportDate?**: `string`

For file-fed collectors: the export the values rode in on.

***

### resolved?

> `readonly` `optional` **resolved?**: readonly `ResolvedDeclaration`[]

Defined in: [src/semantics/coverage/types.ts:225](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L225)

The entity each population value RESOLVED to — `[{ argument, id, name?,
aliases? }]` — the tool's own claim, said out loud. Read by a tool that
declares its `search`: it binds the value the call was SENT for and no
other entity. Refused here when malformed.

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

***

### what

> `readonly` **what**: `string`

Defined in: [src/semantics/coverage/types.ts:166](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L166)

What was looked for, in the author's own words ("FLOGI entries on
fc1/3"). Required: an absence that cannot say what it did not find is
indistinguishable from a tool that returned nothing by accident.

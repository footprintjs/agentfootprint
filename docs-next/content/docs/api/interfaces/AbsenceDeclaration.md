---
title: AbsenceDeclaration
---

# Interface: AbsenceDeclaration

Defined in: [src/core/agent/coverage/types.ts:162](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L162)

What a tool author passes to import('./absent.js').absent.

## Properties

### cannotCover?

> `readonly` `optional` **cannotCover?**: readonly [`CoverageInput`](/docs/api/type-aliases/CoverageInput)[]

Defined in: [src/core/agent/coverage/types.ts:180](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L180)

Ground no search by this tool can reach. Each needs a `why`.

***

### checked

> `readonly` **checked**: readonly [`CoverageInput`](/docs/api/type-aliases/CoverageInput)[]

Defined in: [src/core/agent/coverage/types.ts:175](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L175)

The coverage of the search — REQUIRED and non-empty. An absence that
names no coverage is a `null` with extra steps: the reader still cannot
tell "I looked and there is nothing" from "I could not look", which is
the entire failure this primitive exists to prevent.

***

### notChecked?

> `readonly` `optional` **notChecked?**: readonly [`CoverageInput`](/docs/api/type-aliases/CoverageInput)[]

Defined in: [src/core/agent/coverage/types.ts:178](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L178)

Ground the search did not reach this time — an absence here proves
 nothing about it.

***

### period?

> `readonly` `optional` **period?**: [`DeclaredPeriod`](/docs/api/interfaces/DeclaredPeriod)

Defined in: [src/core/agent/coverage/types.ts:220](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L220)

What the search's READ covered in time — the instants it asked for, and
what the store holds (or `'unknown'`, said out loud) — honesty step 7b.
Every value is an ISO 8601 instant with a zone; a malformed period is
refused here. The results layer files its verdict (covered · partly held ·
not held · unknown), and `.limitsTravelWithTheAnswer()` prints it.

***

### provenance?

> `readonly` `optional` **provenance?**: `object`

Defined in: [src/core/agent/coverage/types.ts:212](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L212)

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

### tryInstead?

> `readonly` `optional` **tryInstead?**: `string`

Defined in: [src/core/agent/coverage/types.ts:191](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L191)

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

Defined in: [src/core/agent/coverage/types.ts:201](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L201)

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

Defined in: [src/core/agent/coverage/types.ts:168](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L168)

What was looked for, in the author's own words ("FLOGI entries on
fc1/3"). Required: an absence that cannot say what it did not find is
indistinguishable from a tool that returned nothing by accident.

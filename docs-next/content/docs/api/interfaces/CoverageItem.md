---
title: CoverageItem
---

# Interface: CoverageItem

Defined in: [src/core/agent/coverage/types.ts:22](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L22)

One piece of ground, and (optionally) why it is where it is.

`what` is prose the TOOL AUTHOR wrote — a source, a window, a filter, a
fleet ("the fcns database on shq-fab-a", "the last 24h", "all four
arrays"). It is never composed from the model's arguments by this library,
because the library does not know which of them are real.

## Properties

### kind?

> `readonly` `optional` **kind?**: `"scope"` \| `"existence"`

Defined in: [src/core/agent/coverage/types.ts:62](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L62)

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

***

### short?

> `readonly` `optional` **short?**: `string`

Defined in: [src/core/agent/coverage/types.ts:46](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L46)

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

***

### what

> `readonly` **what**: `string`

Defined in: [src/core/agent/coverage/types.ts:24](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L24)

The source, window, filter or population. Non-empty.

***

### why?

> `readonly` `optional` **why?**: `string`

Defined in: [src/core/agent/coverage/types.ts:31](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L31)

Why it sits where it does. REQUIRED on `cannotCover` (a permanent blind
spot is a claim about capability, and a claim with no reason cannot be
acted on or disproved); optional on `checked` and `notChecked`, where
"we did" and "we did not need to" are often the whole story.

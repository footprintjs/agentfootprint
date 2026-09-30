---
title: CallWindowRow
---

# Interface: CallWindowRow

Defined in: [src/core/time/rows.ts:168](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L168)

Which window one call to a tool that declares period forms carries (time
design § 7.3) — one row per such call, filed by the inputs layer beside the
call's `argument` rows, before the call dispatches.

| `how` | Means |
|-------|-------|
| `filled` | the model left the period out; the turn's one window (`person`) went into form `form` exactly (`rounded`: an epoch-seconds bound or a look-back's length moved outward) |
| `bound` | the sent window IS the person's window `person` — named by the model's quote (`by: 'quote'`) or equal in value (`by: 'value'`) |
| `model-chosen` | the sent window (`asked`) differs from the person's (`person`, when one window is theirs): it ran as sent (the v1 law) |
| `model` | the sent window, and no window of the person's this turn |
| `unread` | a period argument was sent and no form reads the call back as a range |
| `not-filled` | the period was left out and nothing was filled (`why`) — the tool's own rule applied |
| `refused` | refused before dispatch (`refused`: a fact the window breaks, `multi-day`, `dst-gap` with its `argument`) — the call did not run |

`asked` is the half-open range the call asks for: the person's on a fill,
the sent value read back otherwise — what `ctx.time.asked` hands the tool.
A WIDENED fill (no form holds the window exactly — § 7.2) carries `sent`,
the range the tool reads, and either `differs.extra` (the parts read but
not asked — `period-differs-from-asked`) or `trimmedByTool` (the tool
declares `filtersToAsked`). `partlyBeyondRetention` marks a window that
starts before the source's oldest data and ends after it: it dispatched.

## Properties

### argument?

> `readonly` `optional` **argument?**: `string`

Defined in: [src/core/time/rows.ts:192](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L192)

On a `dst-gap` refusal: the argument whose wall time the zone skips.

***

### asked?

> `readonly` `optional` **asked?**: [`TimeRange`](/docs/api/interfaces/TimeRange)

Defined in: [src/core/time/rows.ts:177](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L177)

***

### by?

> `readonly` `optional` **by?**: `"quote"` \| `"value"`

Defined in: [src/core/time/rows.ts:179](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L179)

***

### differs?

> `readonly` `optional` **differs?**: `object`

Defined in: [src/core/time/rows.ts:185](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L185)

A widened fill the tool does not trim: the parts read but not asked.

#### extra

> `readonly` **extra**: readonly [`TimeRange`](/docs/api/interfaces/TimeRange)[]

***

### form?

> `readonly` `optional` **form?**: `number`

Defined in: [src/core/time/rows.ts:176](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L176)

The index of the tool's form the call used (filled into, or read back from).

***

### how

> `readonly` **how**: `"refused"` \| `"model"` \| `"filled"` \| `"bound"` \| `"model-chosen"` \| `"unread"` \| `"not-filled"`

Defined in: [src/core/time/rows.ts:174](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L174)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/time/rows.ts:171](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L171)

***

### kind

> `readonly` **kind**: `"call-window"`

Defined in: [src/core/time/rows.ts:169](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L169)

***

### partlyBeyondRetention?

> `readonly` `optional` **partlyBeyondRetention?**: `true`

Defined in: [src/core/time/rows.ts:188](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L188)

***

### person?

> `readonly` `optional` **person?**: [`PersonWindow`](/docs/api/interfaces/PersonWindow)

Defined in: [src/core/time/rows.ts:178](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L178)

***

### refused?

> `readonly` `optional` **refused?**: `TimeRefusal`

Defined in: [src/core/time/rows.ts:190](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L190)

Why the call was refused before dispatch.

***

### rounded?

> `readonly` `optional` **rounded?**: `true`

Defined in: [src/core/time/rows.ts:180](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L180)

***

### sent?

> `readonly` `optional` **sent?**: [`TimeRange`](/docs/api/interfaces/TimeRange)

Defined in: [src/core/time/rows.ts:183](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L183)

A widened fill: the range the tool reads with the sent values.

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/time/rows.ts:172](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L172)

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/core/time/rows.ts:173](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L173)

***

### trimmedByTool?

> `readonly` `optional` **trimmedByTool?**: `true`

Defined in: [src/core/time/rows.ts:187](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L187)

A widened fill to a tool that declares `filtersToAsked`.

***

### turn

> `readonly` **turn**: `number`

Defined in: [src/core/time/rows.ts:170](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L170)

***

### why?

> `readonly` `optional` **why?**: `"no-window"` \| `"several-mentions"` \| `"open-reading"` \| `"no-exact-form"`

Defined in: [src/core/time/rows.ts:181](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L181)

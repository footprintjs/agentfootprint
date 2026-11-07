---
title: CallWindowRow
---

# Interface: CallWindowRow

Defined in: [src/time/rows/types.ts:171](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L171)

Which window one call to a tool that declares period forms carries (time
design § 7.3) — one row per such call (two when the time ask filled it, below), filed by the inputs layer beside the
call's `argument` rows, before the call dispatches.

| `how` | Means |
|-------|-------|
| `filled` | the model left the period out; the turn's one window (`person`) went into form `form` exactly (`rounded`: an epoch-seconds bound or a look-back's length moved outward) |
| `bound` | the sent window IS the person's window `person` — named by the model's quote (`by: 'quote'`) or equal in value (`by: 'value'`) |
| `model-chosen` | the sent window (`asked`) differs from the person's (`person`, when one window is theirs): it ran as sent (the v1 law) |
| `model` | the sent window, and no window of the person's this turn |
| `unread` | a period argument was sent and no form reads the call back as a range |
| `not-filled` | the period was left out and nothing was filled (`why`) — the tool's own rule applied (`no-exact-form` is no longer filed: a window no form holds is refused, `no-form-holds`; the word is kept so an older record reads) |
| `refused` | refused before dispatch (`refused`: a fact the window breaks, `multi-day`, `no-form-holds`, `dst-gap` with its `argument`; no range at all when an open reading was refused in every reading) — the call did not run |

`asked` is the half-open range the call asks for: the person's on a fill,
the sent value read back otherwise — what `ctx.time.asked` hands the tool.
A WIDENED fill (no form holds the window exactly — § 7.2) carries `sent`,
the range the tool reads, and either `differs.extra` (the parts read but
not asked — `period-differs-from-asked`) or `trimmedByTool` (the tool
declares `filtersToAsked`). `partlyBeyondRetention` marks a window that
starts before the source's oldest data and ends after it: it dispatched.

A call the time ask filled (the person confirmed or gave the window when
asked what their words meant) has TWO rows: `not-filled` / `open-reading`
before the ask, then `filled` with `person.source: 'answered'` when the
answer is bound (`arguments/ask.ts` · `bindAnswer`). The LATEST row of a
call is the window it runs with (`callWindowOfCall`).

## Properties

### argument?

> `readonly` `optional` **argument?**: `string`

Defined in: [src/time/rows/types.ts:195](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L195)

On a `dst-gap` refusal: the argument whose wall time the zone skips.

***

### asked?

> `readonly` `optional` **asked?**: [`TimeRange`](/docs/api/interfaces/TimeRange)

Defined in: [src/time/rows/types.ts:180](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L180)

***

### by?

> `readonly` `optional` **by?**: `"quote"` \| `"value"`

Defined in: [src/time/rows/types.ts:182](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L182)

***

### differs?

> `readonly` `optional` **differs?**: `object`

Defined in: [src/time/rows/types.ts:188](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L188)

A widened fill the tool does not trim: the parts read but not asked.

#### extra

> `readonly` **extra**: readonly [`TimeRange`](/docs/api/interfaces/TimeRange)[]

***

### form?

> `readonly` `optional` **form?**: `number`

Defined in: [src/time/rows/types.ts:179](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L179)

The index of the tool's form the call used (filled into, or read back from).

***

### how

> `readonly` **how**: `"refused"` \| `"model"` \| `"filled"` \| `"bound"` \| `"model-chosen"` \| `"unread"` \| `"not-filled"`

Defined in: [src/time/rows/types.ts:177](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L177)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/time/rows/types.ts:174](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L174)

***

### kind

> `readonly` **kind**: `"call-window"`

Defined in: [src/time/rows/types.ts:172](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L172)

***

### partlyBeyondRetention?

> `readonly` `optional` **partlyBeyondRetention?**: `true`

Defined in: [src/time/rows/types.ts:191](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L191)

***

### person?

> `readonly` `optional` **person?**: [`PersonWindow`](/docs/api/interfaces/PersonWindow)

Defined in: [src/time/rows/types.ts:181](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L181)

***

### refused?

> `readonly` `optional` **refused?**: `TimeRefusal`

Defined in: [src/time/rows/types.ts:193](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L193)

Why the call was refused before dispatch.

***

### rounded?

> `readonly` `optional` **rounded?**: `true`

Defined in: [src/time/rows/types.ts:183](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L183)

***

### sent?

> `readonly` `optional` **sent?**: [`TimeRange`](/docs/api/interfaces/TimeRange)

Defined in: [src/time/rows/types.ts:186](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L186)

A widened fill: the range the tool reads with the sent values.

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/time/rows/types.ts:175](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L175)

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/time/rows/types.ts:176](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L176)

***

### trimmedByTool?

> `readonly` `optional` **trimmedByTool?**: `true`

Defined in: [src/time/rows/types.ts:190](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L190)

A widened fill to a tool that declares `filtersToAsked`.

***

### turn

> `readonly` **turn**: `number`

Defined in: [src/time/rows/types.ts:173](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L173)

***

### why?

> `readonly` `optional` **why?**: `"no-window"` \| `"several-mentions"` \| `"open-reading"` \| `"no-exact-form"`

Defined in: [src/time/rows/types.ts:184](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L184)

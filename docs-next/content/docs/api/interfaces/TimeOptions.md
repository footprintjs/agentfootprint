---
title: TimeOptions
---

# Interface: TimeOptions

Defined in: [src/core/time/clock.ts:90](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/clock.ts#L90)

The builder's `.time(options)` — the fallback zone, the reader and its policy (time design § 11).

## Properties

### messages?

> `readonly` `optional` **messages?**: `Partial`\<`Readonly`\<`Record`\<`"answer.not-an-instant"` \| `"answer.no-offset"` \| `"answer.not-a-range"` \| `"answer.out-of-order"` \| `"answer.dst-gap"` \| `"answer.not-a-zone"` \| `"answer.time-future"` \| `"answer.time-past"` \| `"answer.beyond-retention"` \| `"answer.over-max-range"` \| `"ask.which"` \| `"ask.confirm"` \| `"ask.zone"` \| `"choice.confirm"`, `string`\>\>\>

Defined in: [src/core/time/clock.ts:115](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/clock.ts#L115)

Your words for the time ask (`defaultTimeAskMessages` keys → sentence):
the reason a refused time answer is re-asked with, the ask's questions,
the label on a reading to confirm. A key you leave out keeps the default.

***

### policy?

> `readonly` `optional` **policy?**: `object`

Defined in: [src/core/time/clock.ts:106](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/clock.ts#L106)

How the library picks among a reading's candidates (needs `reader`).
`dateOrder` (default `'ask'`): a numeric date's orders become choices,
or the one order your people write (`'MDY'`, `'DMY'`, `'YMD'`), recorded
as assumed. `year` (default `'ask'`): a date said without a year is
asked, or `'current'` — the clock's year, recorded as assumed.

#### dateOrder?

> `readonly` `optional` **dateOrder?**: `"ask"` \| `"MDY"` \| `"DMY"` \| `"YMD"`

#### year?

> `readonly` `optional` **year?**: `"ask"` \| `"current"`

***

### reader?

> `readonly` `optional` **reader?**: [`TimeReader`](/docs/api/interfaces/TimeReader)

Defined in: [src/core/time/clock.ts:98](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/clock.ts#L98)

The strategy that reads the person's words into time parts (`TimeReader`).
No default: without one, the person's words are not read — no
`time-reading` row is filed.

***

### zone?

> `readonly` `optional` **zone?**: `string`

Defined in: [src/core/time/clock.ts:92](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/clock.ts#L92)

The fallback zone for a run that names none. Omitted: every run must name its own.

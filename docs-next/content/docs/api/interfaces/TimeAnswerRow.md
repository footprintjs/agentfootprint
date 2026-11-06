---
title: TimeAnswerRow
---

# Interface: TimeAnswerRow

Defined in: [src/time/rows/types.ts:110](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L110)

The window the person settled for one mention in the time ask — the ONLY
door by which a window of words becomes the person's (the owner's decision
"Always confirm", time design TQ29). Filed by the batch ask when a window
answer binds (`arguments/ask.ts` · `bindAnswer`); read back by
`bind.ts` · `turnWindowsOf`, so the rest of the turn uses it as an
`answered` window and the served sentence names it with its source.

## Extends

- [`TimeRange`](/docs/api/interfaces/TimeRange)

## Properties

### corrected?

> `readonly` `optional` **corrected?**: `object`

Defined in: [src/time/rows/types.ts:125](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L125)

Canonical corrected meaning; absent preserves the original reading. Never raw words.

#### lookback?

> `readonly` `optional` **lookback?**: `string`

***

### from

> `readonly` **from**: `string`

Defined in: [src/time/range.ts:60](https://github.com/footprintjs/agentfootprint/blob/main/src/time/range.ts#L60)

#### Inherited from

[`TimeRange`](/docs/api/interfaces/TimeRange).[`from`](/docs/api/interfaces/TimeRange#from)

***

### how

> `readonly` **how**: `"confirmed"` \| `"edited"`

Defined in: [src/time/rows/types.ts:123](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L123)

`confirmed`: the person picked a reading the library offered (the
pre-filled choice — their click); `edited`: they wrote a window of their
own. Both are the person's answer.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/time/rows/types.ts:113](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L113)

***

### kind

> `readonly` **kind**: `"time-answer"`

Defined in: [src/time/rows/types.ts:111](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L111)

***

### mention

> `readonly` **mention**: `number`

Defined in: [src/time/rows/types.ts:115](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L115)

The `time-reading` row's mention the answer settles.

***

### to

> `readonly` **to**: `string`

Defined in: [src/time/range.ts:61](https://github.com/footprintjs/agentfootprint/blob/main/src/time/range.ts#L61)

#### Inherited from

[`TimeRange`](/docs/api/interfaces/TimeRange).[`to`](/docs/api/interfaces/TimeRange#to)

***

### turn

> `readonly` **turn**: `number`

Defined in: [src/time/rows/types.ts:112](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L112)

***

### zone

> `readonly` **zone**: `string`

Defined in: [src/time/rows/types.ts:117](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L117)

The zone the window was answered in — the reading's, or the turn's clock for free entry.

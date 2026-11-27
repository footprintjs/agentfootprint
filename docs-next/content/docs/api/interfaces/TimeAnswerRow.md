---
title: TimeAnswerRow
---

# Interface: TimeAnswerRow

Defined in: [src/time/rows/types.ts:137](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L137)

The window the person settled for one mention in the time ask — the ONLY
door by which a window of words becomes the person's (the owner's decision
"Always confirm", time design TQ29). Filed by the batch ask when a window
answer binds (`arguments/ask.ts` · `bindAnswer`); read back by
`bind.ts` · `turnWindowsOf`, so the rest of the turn uses it as an
`answered` window and the served sentence names it with its source.

## Extends

- `RecordedWindow`

## Properties

### corrected?

> `readonly` `optional` **corrected?**: `object`

Defined in: [src/time/rows/types.ts:152](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L152)

Canonical corrected meaning; absent preserves the original reading. Never raw words.

#### lookback?

> `readonly` `optional` **lookback?**: `string`

***

### endpoint?

> `readonly` `optional` **endpoint?**: `WindowEndpoint`

Defined in: [src/time/windowEndpoint.ts:14](https://github.com/footprintjs/agentfootprint/blob/main/src/time/windowEndpoint.ts#L14)

#### Inherited from

`RecordedWindow.endpoint`

***

### from

> `readonly` **from**: `string`

Defined in: [src/time/range.ts:60](https://github.com/footprintjs/agentfootprint/blob/main/src/time/range.ts#L60)

#### Inherited from

`RecordedWindow.from`

***

### how

> `readonly` **how**: `"confirmed"` \| `"edited"`

Defined in: [src/time/rows/types.ts:150](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L150)

`confirmed`: the person picked a reading the library offered (the
pre-filled choice — their click); `edited`: they wrote a window of their
own. Both are the person's answer.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/time/rows/types.ts:140](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L140)

***

### kind

> `readonly` **kind**: `"time-answer"`

Defined in: [src/time/rows/types.ts:138](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L138)

***

### mention

> `readonly` **mention**: `number`

Defined in: [src/time/rows/types.ts:142](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L142)

The `time-reading` row's mention the answer settles.

***

### to

> `readonly` **to**: `string`

Defined in: [src/time/range.ts:61](https://github.com/footprintjs/agentfootprint/blob/main/src/time/range.ts#L61)

#### Inherited from

`RecordedWindow.to`

***

### turn

> `readonly` **turn**: `number`

Defined in: [src/time/rows/types.ts:139](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L139)

***

### zone

> `readonly` **zone**: `string`

Defined in: [src/time/rows/types.ts:144](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L144)

The zone the window was answered in — the reading's, or the turn's clock for free entry.

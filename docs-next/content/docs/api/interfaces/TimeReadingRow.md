---
title: TimeReadingRow
---

# Interface: TimeReadingRow

Defined in: [src/time/rows/types.ts:100](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L100)

One mention the armed reader found in the person's message (time design
§ 5.2) — or, with `mentions: 0` and no mention fields, the record that the
message was read and held none. Read back, never re-read: a resume and a
retry of the same turn find these rows and do not call the reader.

## Properties

### candidates?

> `readonly` `optional` **candidates?**: readonly [`TimeCandidate`](/docs/api/interfaces/TimeCandidate)[]

Defined in: [src/time/rows/types.ts:118](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L118)

Every window `resolve.ts` made of the parts.

***

### choice?

> `readonly` `optional` **choice?**: [`ReadingChoice`](/docs/api/type-aliases/ReadingChoice)

Defined in: [src/time/rows/types.ts:120](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L120)

How the reading settled under the policy — `open` waits for the person.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/time/rows/types.ts:103](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L103)

***

### kind

> `readonly` **kind**: `"time-reading"`

Defined in: [src/time/rows/types.ts:101](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L101)

***

### mention?

> `readonly` `optional` **mention?**: `number`

Defined in: [src/time/rows/types.ts:110](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L110)

This row's mention, 0-based — absent on the `mentions: 0` row.

***

### mentions

> `readonly` **mentions**: `number`

Defined in: [src/time/rows/types.ts:108](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L108)

How many mentions the reading held.

***

### parses?

> `readonly` `optional` **parses?**: readonly [`TimeParts`](/docs/api/interfaces/TimeParts)[]

Defined in: [src/time/rows/types.ts:113](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L113)

***

### problem?

> `readonly` `optional` **problem?**: `"unreadable"`

Defined in: [src/time/rows/types.ts:114](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L114)

***

### qualifiedLookback?

> `readonly` `optional` **qualifiedLookback?**: `object`

Defined in: [src/time/rows/types.ts:122](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L122)

The proof and original input position recorded at native seed.

#### clockNow

> `readonly` **clockNow**: `string`

#### inputPosition

> `readonly` **inputPosition**: `number`

#### receipt

> `readonly` **receipt**: `string`

***

### quote?

> `readonly` `optional` **quote?**: `string`

Defined in: [src/time/rows/types.ts:112](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L112)

A verbatim substring of the person's message.

***

### reader

> `readonly` **reader**: [`TimeReaderStamp`](/docs/api/interfaces/TimeReaderStamp)

Defined in: [src/time/rows/types.ts:104](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L104)

***

### refused?

> `readonly` `optional` **refused?**: `MentionRefusal`

Defined in: [src/time/rows/types.ts:116](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L116)

Why the mention was refused — its quote was not in the message, or its parts were malformed. It keeps no text.

***

### turn

> `readonly` **turn**: `number`

Defined in: [src/time/rows/types.ts:102](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L102)

***

### tzdata

> `readonly` **tzdata**: `string`

Defined in: [src/time/rows/types.ts:106](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L106)

The tz database the candidates were resolved with (`process.versions.tz`), else `'unknown'`.

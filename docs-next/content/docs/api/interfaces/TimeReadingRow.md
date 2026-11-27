---
title: TimeReadingRow
---

# Interface: TimeReadingRow

Defined in: [src/time/rows/types.ts:103](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L103)

One mention the armed reader found in the person's message (time design
§ 5.2) — or, with `mentions: 0` and no mention fields, the record that the
message was read and held none. Read back, never re-read: a resume and a
retry of the same turn find these rows and do not call the reader.

## Properties

### candidates?

> `readonly` `optional` **candidates?**: readonly [`TimeCandidate`](/docs/api/interfaces/TimeCandidate)[]

Defined in: [src/time/rows/types.ts:121](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L121)

Every window `resolve.ts` made of the parts.

***

### choice?

> `readonly` `optional` **choice?**: [`ReadingChoice`](/docs/api/type-aliases/ReadingChoice)

Defined in: [src/time/rows/types.ts:123](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L123)

How the reading settled under the policy — `open` waits for the person.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/time/rows/types.ts:106](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L106)

***

### kind

> `readonly` **kind**: `"time-reading"`

Defined in: [src/time/rows/types.ts:104](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L104)

***

### mention?

> `readonly` `optional` **mention?**: `number`

Defined in: [src/time/rows/types.ts:113](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L113)

This row's mention, 0-based — absent on the `mentions: 0` row.

***

### mentions

> `readonly` **mentions**: `number`

Defined in: [src/time/rows/types.ts:111](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L111)

How many mentions the reading held.

***

### parses?

> `readonly` `optional` **parses?**: readonly [`TimeParts`](/docs/api/interfaces/TimeParts)[]

Defined in: [src/time/rows/types.ts:116](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L116)

***

### problem?

> `readonly` `optional` **problem?**: `"unreadable"`

Defined in: [src/time/rows/types.ts:117](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L117)

***

### qualifiedLookback?

> `readonly` `optional` **qualifiedLookback?**: `object`

Defined in: [src/time/rows/types.ts:125](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L125)

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

Defined in: [src/time/rows/types.ts:115](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L115)

A verbatim substring of the person's message.

***

### reader

> `readonly` **reader**: [`TimeReaderStamp`](/docs/api/interfaces/TimeReaderStamp)

Defined in: [src/time/rows/types.ts:107](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L107)

***

### refused?

> `readonly` `optional` **refused?**: `MentionRefusal`

Defined in: [src/time/rows/types.ts:119](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L119)

Why the mention was refused — its quote was not in the message, or its parts were malformed. It keeps no text.

***

### turn

> `readonly` **turn**: `number`

Defined in: [src/time/rows/types.ts:105](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L105)

***

### tzdata

> `readonly` **tzdata**: `string`

Defined in: [src/time/rows/types.ts:109](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L109)

The tz database the candidates were resolved with (`process.versions.tz`), else `'unknown'`.

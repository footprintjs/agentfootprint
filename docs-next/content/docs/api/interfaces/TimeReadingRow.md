---
title: TimeReadingRow
---

# Interface: TimeReadingRow

Defined in: [src/time/rows/types.ts:79](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L79)

One mention the armed reader found in the person's message (time design
§ 5.2) — or, with `mentions: 0` and no mention fields, the record that the
message was read and held none. Read back, never re-read: a resume and a
retry of the same turn find these rows and do not call the reader.

## Properties

### candidates?

> `readonly` `optional` **candidates?**: readonly [`TimeCandidate`](/docs/api/interfaces/TimeCandidate)[]

Defined in: [src/time/rows/types.ts:97](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L97)

Every window `resolve.ts` made of the parts.

***

### choice?

> `readonly` `optional` **choice?**: [`ReadingChoice`](/docs/api/type-aliases/ReadingChoice)

Defined in: [src/time/rows/types.ts:99](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L99)

How the reading settled under the policy — `open` waits for the person.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/time/rows/types.ts:82](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L82)

***

### kind

> `readonly` **kind**: `"time-reading"`

Defined in: [src/time/rows/types.ts:80](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L80)

***

### mention?

> `readonly` `optional` **mention?**: `number`

Defined in: [src/time/rows/types.ts:89](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L89)

This row's mention, 0-based — absent on the `mentions: 0` row.

***

### mentions

> `readonly` **mentions**: `number`

Defined in: [src/time/rows/types.ts:87](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L87)

How many mentions the reading held.

***

### parses?

> `readonly` `optional` **parses?**: readonly [`TimeParts`](/docs/api/interfaces/TimeParts)[]

Defined in: [src/time/rows/types.ts:92](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L92)

***

### problem?

> `readonly` `optional` **problem?**: `"unreadable"`

Defined in: [src/time/rows/types.ts:93](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L93)

***

### quote?

> `readonly` `optional` **quote?**: `string`

Defined in: [src/time/rows/types.ts:91](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L91)

A verbatim substring of the person's message.

***

### reader

> `readonly` **reader**: [`TimeReaderStamp`](/docs/api/interfaces/TimeReaderStamp)

Defined in: [src/time/rows/types.ts:83](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L83)

***

### refused?

> `readonly` `optional` **refused?**: `MentionRefusal`

Defined in: [src/time/rows/types.ts:95](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L95)

Why the mention was refused — its quote was not in the message, or its parts were malformed. It keeps no text.

***

### turn

> `readonly` **turn**: `number`

Defined in: [src/time/rows/types.ts:81](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L81)

***

### tzdata

> `readonly` **tzdata**: `string`

Defined in: [src/time/rows/types.ts:85](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L85)

The tz database the candidates were resolved with (`process.versions.tz`), else `'unknown'`.

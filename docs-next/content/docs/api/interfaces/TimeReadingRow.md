---
title: TimeReadingRow
---

# Interface: TimeReadingRow

Defined in: [src/time/rows/types.ts:87](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L87)

One mention the armed reader found in the person's message (time design
§ 5.2) — or, with `mentions: 0` and no mention fields, the record that the
message was read and held none. Read back, never re-read: a resume and a
retry of the same turn find these rows and do not call the reader.

## Properties

### candidates?

> `readonly` `optional` **candidates?**: readonly [`TimeCandidate`](/docs/api/interfaces/TimeCandidate)[]

Defined in: [src/time/rows/types.ts:105](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L105)

Every window `resolve.ts` made of the parts.

***

### choice?

> `readonly` `optional` **choice?**: [`ReadingChoice`](/docs/api/type-aliases/ReadingChoice)

Defined in: [src/time/rows/types.ts:107](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L107)

How the reading settled under the policy — `open` waits for the person.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/time/rows/types.ts:90](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L90)

***

### kind

> `readonly` **kind**: `"time-reading"`

Defined in: [src/time/rows/types.ts:88](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L88)

***

### mention?

> `readonly` `optional` **mention?**: `number`

Defined in: [src/time/rows/types.ts:97](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L97)

This row's mention, 0-based — absent on the `mentions: 0` row.

***

### mentions

> `readonly` **mentions**: `number`

Defined in: [src/time/rows/types.ts:95](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L95)

How many mentions the reading held.

***

### parses?

> `readonly` `optional` **parses?**: readonly [`TimeParts`](/docs/api/interfaces/TimeParts)[]

Defined in: [src/time/rows/types.ts:100](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L100)

***

### problem?

> `readonly` `optional` **problem?**: `"unreadable"`

Defined in: [src/time/rows/types.ts:101](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L101)

***

### quote?

> `readonly` `optional` **quote?**: `string`

Defined in: [src/time/rows/types.ts:99](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L99)

A verbatim substring of the person's message.

***

### reader

> `readonly` **reader**: [`TimeReaderStamp`](/docs/api/interfaces/TimeReaderStamp)

Defined in: [src/time/rows/types.ts:91](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L91)

***

### refused?

> `readonly` `optional` **refused?**: `MentionRefusal`

Defined in: [src/time/rows/types.ts:103](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L103)

Why the mention was refused — its quote was not in the message, or its parts were malformed. It keeps no text.

***

### turn

> `readonly` **turn**: `number`

Defined in: [src/time/rows/types.ts:89](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L89)

***

### tzdata

> `readonly` **tzdata**: `string`

Defined in: [src/time/rows/types.ts:93](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L93)

The tz database the candidates were resolved with (`process.versions.tz`), else `'unknown'`.

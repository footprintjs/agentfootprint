---
title: TimeReadingRow
---

# Interface: TimeReadingRow

Defined in: [src/time/rows/types.ts:84](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L84)

One mention the armed reader found in the person's message (time design
§ 5.2) — or, with `mentions: 0` and no mention fields, the record that the
message was read and held none. Read back, never re-read: a resume and a
retry of the same turn find these rows and do not call the reader.

## Properties

### candidates?

> `readonly` `optional` **candidates?**: readonly [`TimeCandidate`](/docs/api/interfaces/TimeCandidate)[]

Defined in: [src/time/rows/types.ts:102](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L102)

Every window `resolve.ts` made of the parts.

***

### choice?

> `readonly` `optional` **choice?**: [`ReadingChoice`](/docs/api/type-aliases/ReadingChoice)

Defined in: [src/time/rows/types.ts:104](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L104)

How the reading settled under the policy — `open` waits for the person.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/time/rows/types.ts:87](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L87)

***

### kind

> `readonly` **kind**: `"time-reading"`

Defined in: [src/time/rows/types.ts:85](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L85)

***

### mention?

> `readonly` `optional` **mention?**: `number`

Defined in: [src/time/rows/types.ts:94](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L94)

This row's mention, 0-based — absent on the `mentions: 0` row.

***

### mentions

> `readonly` **mentions**: `number`

Defined in: [src/time/rows/types.ts:92](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L92)

How many mentions the reading held.

***

### parses?

> `readonly` `optional` **parses?**: readonly [`TimeParts`](/docs/api/interfaces/TimeParts)[]

Defined in: [src/time/rows/types.ts:97](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L97)

***

### problem?

> `readonly` `optional` **problem?**: `"unreadable"`

Defined in: [src/time/rows/types.ts:98](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L98)

***

### quote?

> `readonly` `optional` **quote?**: `string`

Defined in: [src/time/rows/types.ts:96](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L96)

A verbatim substring of the person's message.

***

### reader

> `readonly` **reader**: [`TimeReaderStamp`](/docs/api/interfaces/TimeReaderStamp)

Defined in: [src/time/rows/types.ts:88](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L88)

***

### refused?

> `readonly` `optional` **refused?**: `MentionRefusal`

Defined in: [src/time/rows/types.ts:100](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L100)

Why the mention was refused — its quote was not in the message, or its parts were malformed. It keeps no text.

***

### turn

> `readonly` **turn**: `number`

Defined in: [src/time/rows/types.ts:86](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L86)

***

### tzdata

> `readonly` **tzdata**: `string`

Defined in: [src/time/rows/types.ts:90](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L90)

The tz database the candidates were resolved with (`process.versions.tz`), else `'unknown'`.

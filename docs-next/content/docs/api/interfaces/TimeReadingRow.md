---
title: TimeReadingRow
---

# Interface: TimeReadingRow

Defined in: [src/core/time/rows.ts:115](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L115)

One mention the armed reader found in the person's message (time design
§ 5.2) — or, with `mentions: 0` and no mention fields, the record that the
message was read and held none. Read back, never re-read: a resume and a
retry of the same turn find these rows and do not call the reader.

## Properties

### candidates?

> `readonly` `optional` **candidates?**: readonly [`TimeCandidate`](/docs/api/interfaces/TimeCandidate)[]

Defined in: [src/core/time/rows.ts:133](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L133)

Every window `resolve.ts` made of the parts.

***

### choice?

> `readonly` `optional` **choice?**: [`ReadingChoice`](/docs/api/type-aliases/ReadingChoice)

Defined in: [src/core/time/rows.ts:135](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L135)

How the reading settled under the policy — `open` waits for the person.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/time/rows.ts:118](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L118)

***

### kind

> `readonly` **kind**: `"time-reading"`

Defined in: [src/core/time/rows.ts:116](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L116)

***

### mention?

> `readonly` `optional` **mention?**: `number`

Defined in: [src/core/time/rows.ts:125](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L125)

This row's mention, 0-based — absent on the `mentions: 0` row.

***

### mentions

> `readonly` **mentions**: `number`

Defined in: [src/core/time/rows.ts:123](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L123)

How many mentions the reading held.

***

### parses?

> `readonly` `optional` **parses?**: readonly [`TimeParts`](/docs/api/interfaces/TimeParts)[]

Defined in: [src/core/time/rows.ts:128](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L128)

***

### problem?

> `readonly` `optional` **problem?**: `"unreadable"`

Defined in: [src/core/time/rows.ts:129](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L129)

***

### quote?

> `readonly` `optional` **quote?**: `string`

Defined in: [src/core/time/rows.ts:127](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L127)

A verbatim substring of the person's message.

***

### reader

> `readonly` **reader**: [`TimeReaderStamp`](/docs/api/interfaces/TimeReaderStamp)

Defined in: [src/core/time/rows.ts:119](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L119)

***

### refused?

> `readonly` `optional` **refused?**: `MentionRefusal`

Defined in: [src/core/time/rows.ts:131](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L131)

Why the mention was refused — its quote was not in the message, or its parts were malformed. It keeps no text.

***

### turn

> `readonly` **turn**: `number`

Defined in: [src/core/time/rows.ts:117](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L117)

***

### tzdata

> `readonly` **tzdata**: `string`

Defined in: [src/core/time/rows.ts:121](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L121)

The tz database the candidates were resolved with (`process.versions.tz`), else `'unknown'`.

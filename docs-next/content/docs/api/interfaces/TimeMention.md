---
title: TimeMention
---

# Interface: TimeMention

Defined in: [src/core/time/reader.ts:79](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/reader.ts#L79)

One mention of a time in the text.

## Properties

### parses

> `readonly` **parses**: readonly [`TimeParts`](/docs/api/interfaces/TimeParts)[]

Defined in: [src/core/time/reader.ts:83](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/reader.ts#L83)

Usually one; more only when the TOKENS split two ways. Empty when `problem` is set.

***

### problem?

> `readonly` `optional` **problem?**: `"unreadable"`

Defined in: [src/core/time/reader.ts:85](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/reader.ts#L85)

The reader saw a time here and could not read it.

***

### quote

> `readonly` **quote**: `string`

Defined in: [src/core/time/reader.ts:81](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/reader.ts#L81)

A VERBATIM substring of the text — the library checks it.

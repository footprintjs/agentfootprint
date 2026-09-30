---
title: TimeMention
---

# Interface: TimeMention

Defined in: [src/core/time/reader.ts:88](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/reader.ts#L88)

One mention of a time in the text.

## Properties

### parses

> `readonly` **parses**: readonly [`TimeParts`](/docs/api/interfaces/TimeParts)[]

Defined in: [src/core/time/reader.ts:92](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/reader.ts#L92)

Usually one; more only when the TOKENS split two ways. Empty when `problem` is set.

***

### problem?

> `readonly` `optional` **problem?**: `"unreadable"`

Defined in: [src/core/time/reader.ts:94](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/reader.ts#L94)

The reader saw a time here and could not read it.

***

### quote

> `readonly` **quote**: `string`

Defined in: [src/core/time/reader.ts:90](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/reader.ts#L90)

A VERBATIM substring of the text — the library checks it.

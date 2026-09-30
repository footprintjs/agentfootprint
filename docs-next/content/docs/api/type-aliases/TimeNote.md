---
title: TimeNote
---

# Type Alias: TimeNote

> **TimeNote** = \{ `kind`: `"end-of-grain"`; \} \| \{ `end?`: `"from"` \| `"to"`; `kind`: `"dst-overlap"`; `which`: `"earlier"` \| `"later"`; \} \| \{ `end?`: `"from"` \| `"to"`; `kind`: `"dst-gap"`; `which`: `"earlier"` \| `"later"`; \} \| \{ `kind`: `"offset-said"`; `offset`: `string`; \} \| \{ `century`: `number`; `kind`: `"century-implied"`; \}

Defined in: [src/core/time/resolve.ts:99](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolve.ts#L99)

A library-written note on how a window was read.

## Union Members

### Type Literal

\{ `kind`: `"end-of-grain"`; \}

The range runs to the end of its last said grain ("to 8:40" → `08:41`).

***

### Type Literal

\{ `end?`: `"from"` \| `"to"`; `kind`: `"dst-overlap"`; `which`: `"earlier"` \| `"later"`; \}

A wall time the clocks go back through: which of its two instants this is (`end`: which end of a range).

***

### Type Literal

\{ `end?`: `"from"` \| `"to"`; `kind`: `"dst-gap"`; `which`: `"earlier"` \| `"later"`; \}

A wall time the clocks skip: which of Temporal's two readings this is.

***

### Type Literal

\{ `kind`: `"offset-said"`; `offset`: `string`; \}

The person said a numeric offset, not a zone: the instants carry it; `zone` is the clock's.

***

### Type Literal

\{ `century`: `number`; `kind`: `"century-implied"`; \}

A two-digit year, read in the clock's century.

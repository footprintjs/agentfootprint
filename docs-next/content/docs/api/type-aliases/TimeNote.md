---
title: TimeNote
---

# Type Alias: TimeNote

> **TimeNote** = \{ `kind`: `"end-of-grain"`; \} \| \{ `end?`: `"from"` \| `"to"`; `kind`: `"dst-overlap"`; `which`: `"earlier"` \| `"later"`; \} \| \{ `end?`: `"from"` \| `"to"`; `kind`: `"dst-gap"`; `which`: `"earlier"` \| `"later"`; \} \| \{ `kind`: `"offset-said"`; `offset`: `string`; \} \| \{ `century`: `number`; `kind`: `"century-implied"`; \} \| \{ `as`: `"place"` \| `"abbreviation"` \| `"abbreviation-literal"`; `kind`: `"zone-read"`; `token`: `string`; \}

Defined in: src/core/time/resolveRecord.ts:53

A library-written note on how a window was read.

## Union Members

### Type Literal

\{ `kind`: `"end-of-grain"`; \}

The window's END was widened to the end of its last said grain: "to 8:40"
→ `08:41`, a day → the next midnight, a lone "9 AM" → `[09:00, 10:00)`.
Never on a range end said as an o'clock hour ("8 AM to 9 AM" ends AT
`09:00`, § 3.3). Ask widenedGrain, never `grain` alone.

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

***

### Type Literal

\{ `as`: `"place"` \| `"abbreviation"` \| `"abbreviation-literal"`; `kind`: `"zone-read"`; `token`: `string`; \}

The person named the zone in words that are no zone name (`London time`,
`PST`): `token` as written, and how the library read it — the one IANA
zone the place names (`place`), the app's abbreviation map's zone
(`abbreviation`), or the fixed offset the abbreviation spells
(`abbreviation-literal`). A proposal like every reading: the person
confirms the zone with the window.

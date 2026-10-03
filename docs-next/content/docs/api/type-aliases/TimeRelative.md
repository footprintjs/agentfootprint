---
title: TimeRelative
---

# Type Alias: TimeRelative

> **TimeRelative** = \{ `offset`: `number`; `unit`: `"minute"` \| `"hour"` \| `"day"` \| `"week"` \| `"month"` \| `"year"`; \} \| \{ `count`: `number`; `unit`: `"second"` \| `"minute"` \| `"hour"` \| `"day"` \| `"week"`; \}

Defined in: src/core/time/reader.ts:125

A time said relative to the message's moment.

## Union Members

### Type Literal

\{ `offset`: `number`; `unit`: `"minute"` \| `"hour"` \| `"day"` \| `"week"` \| `"month"` \| `"year"`; \}

`'yesterday'` = `{ unit: 'day', offset: -1 }`.

***

### Type Literal

\{ `count`: `number`; `unit`: `"second"` \| `"minute"` \| `"hour"` \| `"day"` \| `"week"`; \}

`'last 40 minutes'` = `{ unit: 'minute', count: 40 }` — a look-back.

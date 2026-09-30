---
title: TimeWindow
---

# Type Alias: TimeWindow

> **TimeWindow** = \{ `kind`: `"range"`; `range`: [`TimeRange`](/docs/api/interfaces/TimeRange); \} \| \{ `duration`: `DurationText`; `kind`: `"lookback"`; \}

Defined in: [src/core/time/resolveRecord.ts:45](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L45)

What was asked, before the clock is applied.

## Union Members

### Type Literal

\{ `kind`: `"range"`; `range`: [`TimeRange`](/docs/api/interfaces/TimeRange); \}

***

### Type Literal

\{ `duration`: `DurationText`; `kind`: `"lookback"`; \}

Always "until the clock's now".

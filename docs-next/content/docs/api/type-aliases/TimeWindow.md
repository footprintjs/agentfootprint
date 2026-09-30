---
title: TimeWindow
---

# Type Alias: TimeWindow

> **TimeWindow** = \{ `kind`: `"range"`; `range`: [`TimeRange`](/docs/api/interfaces/TimeRange); \} \| \{ `duration`: `DurationText`; `kind`: `"lookback"`; \}

Defined in: [src/core/time/resolve.ts:93](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolve.ts#L93)

What was asked, before the clock is applied.

## Union Members

### Type Literal

\{ `kind`: `"range"`; `range`: [`TimeRange`](/docs/api/interfaces/TimeRange); \}

***

### Type Literal

\{ `duration`: `DurationText`; `kind`: `"lookback"`; \}

Always "until the clock's now".

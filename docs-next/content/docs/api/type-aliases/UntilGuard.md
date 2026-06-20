---
title: UntilGuard
---

# Type Alias: UntilGuard

> **UntilGuard** = (`ctx`) => `boolean`

Defined in: [src/core-flow/Loop.ts:88](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Loop.ts#L88)

Predicate evaluated AFTER each body iteration. Return true to exit the loop.

`latestOutput` is the body's STRING output — by design (B15): the whole
core-flow layer composes `Runner<{ message: string }, string>`, and the
Loop chart's outputMapper coerces any non-string body output to `''`.
For structured exit conditions today, have the body emit JSON (e.g. an
Agent with `.outputSchema(...)`) and parse inside the guard:

```ts
.until(({ latestOutput }) => {
  try { return (JSON.parse(latestOutput) as { done: boolean }).done; }
  catch { return false; } // not JSON (yet) — keep looping
})
```

A typed guard (`Loop<T>` with a structured body output) would require
genericizing the Runner output contract shared by Sequence / Parallel /
Conditional — tracked as a future enhancement, not in core today.

## Parameters

### ctx

#### iteration

`number`

#### latestOutput

`string`

#### startMs

`number`

## Returns

`boolean`

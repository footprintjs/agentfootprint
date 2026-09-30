---
title: periodVerdict
---

# Function: periodVerdict()

> **periodVerdict**(`period`): `"unknown"` \| `"covered"` \| `"partly-held"` \| `"not-held"`

Defined in: [src/core/agent/coverage/period.ts:427](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/period.ts#L427)

How far a declared period's READ covered what it asked for — ONE pure rule
over the instants the tool declared; bounds are inclusive:

```text
held === 'unknown'                                  → 'unknown'
held.from ≤ queried.from and queried.to ≤ held.to   → 'covered'
queried.to < held.from or queried.from > held.to    → 'not-held'
otherwise                                           → 'partly-held'
```

No clock is read and no duration is parsed: the tool declared both spans.
Throws a `TypeError` naming the fault when handed a period that is not well
formed — a caller error; every period the library files was checked first.

## Parameters

### period

[`DeclaredPeriod`](/docs/api/interfaces/DeclaredPeriod)

## Returns

`"unknown"` \| `"covered"` \| `"partly-held"` \| `"not-held"`

## Example

```ts
periodVerdict({
  queried: { from: '2026-09-26T09:00:00Z', to: '2026-09-26T10:00:00Z' },
  held: { from: '2026-08-27T02:00:00Z', to: '2026-09-26T02:00:00Z' },
}); // 'not-held' — the data ends at 02:00; the hour asked about is after it
```

---
type: fixed
bump: patch
---

When a host rule denies a tool result, the answer's standing reports
`result-withheld` once without naming the tool or exposing its result.
The per-call settlement record keeps that warning even after a history window
evicts the result.
When a rule rewrites a result, the standing assesses the replacement.

---
title: NormalisedAxis
---

# Type Alias: NormalisedAxis

> **NormalisedAxis** = \{ `counts`: [`AxisCounts`](/docs/api/interfaces/AxisCounts); `notes`: readonly [`AxisOverlapNote`](/docs/api/interfaces/AxisOverlapNote)[]; `points`: readonly [`AxisPoint`](/docs/api/interfaces/AxisPoint)[]; `precision`: [`AxisPrecision`](/docs/api/type-aliases/AxisPrecision); `status`: `"instants"`; \} \| \{ `count`: `number`; `counts`: [`AxisCounts`](/docs/api/interfaces/AxisCounts); `notes`: readonly [`AxisOverlapNote`](/docs/api/interfaces/AxisOverlapNote)[]; `points`: readonly [`AxisPoint`](/docs/api/interfaces/AxisPoint)[]; `precision`: [`AxisPrecision`](/docs/api/type-aliases/AxisPrecision); `status`: `"naive-values"`; \} \| \{ `count`: `number`; `counts`: [`AxisCounts`](/docs/api/interfaces/AxisCounts); `reason`: `"naive-values"`; `status`: `"refused"`; \}

Defined in: src/core/time/axis.ts:374

The read-side view of a declared time column.

- `instants` — every value whose clock is known was placed.
- `naive-values` — `count` values have no known clock (`naive` +
  `dstAmbiguous`); they are not in `points`, and nothing should compare or
  join the series with another source as if they were.
- `refused` — the same, under `naive: 'refuse'`: nothing is placed.

`points` are sorted in time (ties by row); `unreadable`, `missing` and
`dstGap` are counted under every status.

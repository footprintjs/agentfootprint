---
title: WriteTrackingMode
---

# Type Alias: WriteTrackingMode

> **WriteTrackingMode** = `RetentionPolicy`

Defined in: node\_modules/footprintjs/dist/types/lib/memory/frameTypes.d.ts:75

Policy for how tracked writes are recorded into `StageSnapshot.stageWrites`
(#13c-A) — the sibling of [ReadTrackingMode](/docs/api/type-aliases/ReadTrackingMode).

- `'full'` (default) — every tracked write `structuredClone`s the value into
  the stage's write view. Byte-identical to the historical behavior.
- `'summary'` — writes record a cheap [WriteSummaryMarker](/docs/api/interfaces/WriteSummaryMarker) instead of
  the cloned value.
- `'off'` — writes are not recorded at all; `stageWrites` is absent from the
  snapshot. The writes themselves still commit to shared state and still
  appear in the commit log — only the per-stage snapshot bookkeeping (and
  therefore the commit observer's mutations payload) is affected. (The
  commit log's own value encoding has its own lossless dial —
  CommitValuesMode, #13c-B.)

Set via `new FlowChartExecutor(chart, { writeTracking })` or
`executor.setWriteTracking(mode)` (before `run()`). See
`FlowChartExecutorOptions.writeTracking` for the full observable-consequence
contract (onCommit payload, redaction precedence, what is OUT of scope).

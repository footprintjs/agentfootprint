---
title: ReadTrackingMode
---

# Type Alias: ReadTrackingMode

> **ReadTrackingMode** = `RetentionPolicy`

Defined in: node\_modules/footprintjs/dist/types/lib/memory/types.d.ts:116

Policy for how tracked reads are recorded into `StageSnapshot.stageReads`.

- `'full'` (default) — every tracked read `structuredClone`s the value into
  the stage's read view. Byte-identical to the historical behavior; this is
  what snapshot consumers (lens, agentfootprint) see today.
- `'summary'` — reads record a cheap [ReadSummaryMarker](/docs/api/interfaces/ReadSummaryMarker) (type + size
  proxy + short preview) instead of the cloned value. O(1)-ish per read —
  no value clone, no serialization of large objects.
- `'off'` — reads are not recorded at all; `stageReads` is absent from the
  snapshot. Zero per-read cost. Values are still readable, and the
  `ScopeRecorder.onRead` event still fires (it passes the live reference and
  never cloned) — so narrative output is identical in every mode. The policy
  scopes ONLY the snapshot's `stageReads` payload.

Set via `new FlowChartExecutor(chart, { readTracking })` or
`executor.setReadTracking(mode)` (before `run()`).

Alias of the shared RetentionPolicy family (#13c-A) — kept as the
shipped public name for the read dial.

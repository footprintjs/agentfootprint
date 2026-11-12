---
title: ReadTrackingMode
---

# Type Alias: ReadTrackingMode

> **ReadTrackingMode** = `RetentionPolicy`

Defined in: node\_modules/footprintjs/dist/types/lib/memory/frameTypes.d.ts:54

Policy for how tracked reads are recorded into `StageSnapshot.stageReads`.

- `'full'` (default) — a tracked read keeps a `structuredClone` of the value
  in the stage's read view: what snapshot consumers (lens, agentfootprint)
  see. The clone is taken once for each object a key holds, not at every
  read (`keptReads.ts`); a text or a number needs no clone; a key the stage
  itself has written is cloned at every read from then on.
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

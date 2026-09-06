**Mixed** — past runs stored as searchable snapshots, and the nearest one served
back.
Trace: `evidenceRecorder.ts` harvests what a snapshot needs DURING the run;
`writeSnapshot.ts` persists the `(query, answer)` pair.
Lens: `loadSnapshot.ts` writes `scope.formatted`, so the slot subflow injects the
most-similar past run as a system message.

## What it reads / what it writes
- Reads the store under the run's identity, projected per `SnapshotProjection`.
- Writes `scope.formatted`. Below `minScore` it returns EMPTY rather than a
  weaker match — an honest omission instead of a degraded claim.
- Known seam: `types.ts` · `SnapshotEntry` notes the recorder integrates `executor.getSnapshot()`
  directly, an out-of-band read of an engine fold whose top level is a live view.

## The one law here
A recalled past run is served as a past run. It is never blended into the
present turn's evidence, and a weak match is no match.

## Files
- `evidenceRecorder.ts`, `writeSnapshot.ts` — the record.
- `loadSnapshot.ts` — the served view.
- `snapshotPipeline.ts`, `types.ts`, `index.ts`.

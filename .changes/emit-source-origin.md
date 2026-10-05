---
type: fixed
---
**Queued events keep their emission time and available engine coordinates.**
The shared emit bridge now uses the source timestamp rather than listener delivery
time. It projects an optional engine position into `EventMeta.sourcePosition` with
an explicit `engineRunId`, log identity, runtime mount path and committed prefix.
Missing or malformed positions remain absent. This requires an engine that supplies
coordinates; it does not reconstruct them for older recordings or claim an event
is positioned at its emitting stage's eventual commit.

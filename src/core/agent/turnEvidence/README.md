# Completed-turn evidence

`turnEvidence.ts` is the facade for two pure readers used by hosts immediately
after an answer or after they load its recording. The caller names the typed
event run ID. A terminal event cuts the evidence to that invocation and
component. The state reader additionally checks the snapshot's native address.

Coverage counts come from the current leg's committed declarations, anchored to
the engine's initial state and attributed using the recorded call occurrence.
Verdict items come from the selected terminal iteration's served evidence event.
The two reads preserve the existing compact historical account and use the same
served redaction boundary as `recordRun`. An unreadable source stays unreadable.

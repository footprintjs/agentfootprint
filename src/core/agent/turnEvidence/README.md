# Fold — completed-turn evidence

`turnEvidence.ts` is the facade for two pure readers used by hosts immediately
after an answer or after they load its recording. The caller names the typed
event run ID. A terminal event cuts the evidence to that invocation and
component. The state reader additionally checks the snapshot's native address.

Coverage counts come from the current leg's committed declarations, anchored to
the engine's initial state and attributed using the recorded call occurrence.
Verdict items come from the selected terminal iteration's served evidence event.
The two reads preserve the existing compact historical account and use the same
served redaction boundary as `recordRun`. An unreadable source stays unreadable.


The completed-turn capability also admits one explicitly addressed child of its
bound native root. Live queries use the served result under the exact execution
key. Saved queries require a complete checked recording index, open the matching
invocation once, and check authorization again. The selected child's native
address must match the whole requested path. Only its own tree and commits
enter the cause query. A missing tree or unprovable selection produces the same
fixed gap as a child whose evidence was withheld.

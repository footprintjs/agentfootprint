---
type: breaking
---
**Retire the deprecated standalone run-step builder without losing saved-event replay.**
`buildRunSteps`, `BuildRunStepsOptions`, and `RunStepGraph` are removed from
`agentfootprint/observe`. The supported `RunStepRecorder.ingestDomainEvents`
method now owns the existing saved-event replay, including grouping parallel
fork branches. Live recording and the existing single-event ingestion and
step-projection methods are unchanged.

Migration: create a fresh `runStepRecorder()`, call
`rec.ingestDomainEvents(events)` (or `boundary.getEvents()` when starting from a
`BoundaryRecorder`), then read `rec.getSteps(drillPath)`; omit `drillPath` for the
whole run. Pass one complete saved recording, with each fork's branches in the
same batch. Use `clear()` before replaying another independent recording. Live
consumers should attach the recorder and read `getSteps()` without replaying.

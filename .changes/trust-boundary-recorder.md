---
type: added
---
**Capture selected trust-boundary facts while an agent runs.** The opt-in
`trustBoundaryRecorder` keeps bounded, content-minimized middleware, permission
and credential observations, with original call/run identity and available
source-time positions. `recordRun` can own its subscription and place one
versioned bundle in the snapshot. Counts and sequence gaps disclose lost
evidence; missing events never mean approval, and a changed value is not
automatically called redacted. Existing recording defaults are unchanged.
Privacy guidance now explicitly distinguishes lean boundary data from the
ordinary event tail and engine state, which can still carry raw content.

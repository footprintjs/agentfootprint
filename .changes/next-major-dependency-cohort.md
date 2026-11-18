---
type: breaking
---
**Require FootPrint 14 and Foottrace 2.1 or later in major 2.** Agentfootprint 15
requires the FootPrint peer range `^14.0.0` and the Foottrace dependency
range `^2.1.0`.

Migration: upgrade to `footprintjs@^14.0.0` and `foottrace@^2.1.0`.
During the release train, install the published Agentfootprint 15 candidate
with the exact stable engine `footprintjs@14.0.0`. Regenerate the
application lockfile with strict peer resolution and run the consumer checks.
Verify that Agentfootprint and the engine resolve the same physical Foottrace
installation.

Public `openRecording` replay was verified for a saved plain JSON
`recordRun(agent).toRecording()` bundle from Agentfootprint 14.3.1,
FootPrint 11.1.0, and Foottrace 1.11.1. The check reopens the saved snapshot,
inspects the original tool call, and finds its result in the commit log.

The native record carries `beganAt` and `sawUntil` read windows when available.
These fields count commits. Preserve them when saving records. The trace tools'
use of those windows to attribute reads is tracked in a follow-up.

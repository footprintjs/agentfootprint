---
type: added
---
**Capture trust facts and receive the exact hosted recording.** Supply a fresh
`trustBoundaryRecorder` factory in `artifacts.recordings.trustBoundaries` to add
one bounded trust bundle per invocation. A bound `HostReply.turnArtifacts` hook can read
`turn.recording` for the root recording that was published to its own scope.

The SQLite store now reads only metadata for artifact heads, lists, and parent
checks. Full reads still load the payload and verify its recorded digest.

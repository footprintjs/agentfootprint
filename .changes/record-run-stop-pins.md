---
type: changed
---

**`recordRun(...).stop()` pins the run's snapshot in every mode.** With
`trustBoundaries` on, `stop()` pinned the snapshot; without it, a later
`toRecording()` still read the runner live — so after the runner ran again, the
recording paired this run's events and boundary log with ANOTHER run's
snapshot. `stop()` now pins the snapshot whether `trustBoundaries` is on or
off (stopped before any run, it stays `undefined`), and in every mode it
attempts every listener's cleanup even when one fails. `toRecording()` before
`stop()` still reads the runner as the run grows.

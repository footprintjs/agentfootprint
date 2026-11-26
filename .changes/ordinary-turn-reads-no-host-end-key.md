---
type: fixed
---
**An ordinary turn no longer reads the host-end key `modelReplyRunId`.** Every turn's final stage asked whether a settled reply had a model run id, the key only a `hostEndedTurns: true` agent writes; the engine records that presence check as a read of an unset key, and since footprintjs 14.1.0 names it in a saved snapshot's `undefinedReadKeys`, so an ordinary turn's record carried a host-end name. The final stage now asks only in a host-ended agent; an ordinary turn's recorded reads, saved rows and checkpoint bytes are as they were.

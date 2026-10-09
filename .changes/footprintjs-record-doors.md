---
type: changed
bump: minor
---
**Needs footprintjs 9.47.0: the record's names come from `footprintjs/trace`.** footprintjs 9.47.0
gives the record its own doors: `CommitBundle` and `applySmartMerge` leave `footprintjs/advanced` for
`footprintjs/trace` (and `SharedMemory` for the new `footprintjs/write`). The commit-log readers
(`context-bisect`, `context-ledger`, `time-travel`, `trace-toolpack`) and one example now import
`CommitBundle` and `applySmartMerge` from `footprintjs/trace`; the test helper takes `SharedMemory`
from `footprintjs/write`. So the `footprintjs` peer range is now `^9.47.0`: earlier footprintjs
releases do not hand these names out on `/trace`, and earlier agentfootprint releases do not load on
footprintjs 9.47.0 (their ES module build asks `/advanced` for `applySmartMerge`) — upgrade the two
together. Nothing an agent records, reads or returns changes; the types are footprintjs's same types.

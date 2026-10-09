---
type: changed
bump: minor
---
**Needs footprintjs 9.47.0: the record's names come from `footprintjs/trace` and `footprintjs/write`.**
footprintjs 9.47.0 gives the record its own doors: `CommitBundle` and `applySmartMerge` leave
`footprintjs/advanced` for `footprintjs/trace`, and `SharedMemory` for the new `footprintjs/write`.
agentfootprint now imports them there — the commit-log readers (`context-bisect`, `context-ledger`,
`time-travel`, `trace-toolpack`) and one example — so the `footprintjs` peer range is now
`^9.47.0`: earlier footprintjs releases do not hand these names out where agentfootprint now asks
for them, and 9.47.0 no longer hands them out where it asked before. Nothing an agent records, reads or
returns changes; the types are footprintjs's same types.

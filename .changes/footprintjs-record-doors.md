---
type: changed
bump: minor
---
**Needs footprintjs 9.47.0: the record's names come from `footprintjs/trace`.** footprintjs 9.47.0
gives the record its own doors: `CommitBundle` and `applySmartMerge` get `footprintjs/trace` as their
home (and `SharedMemory` the new `footprintjs/write`), while `footprintjs/advanced` keeps handing them
out until footprintjs 10.0.0. The commit-log readers (`context-bisect`, `context-ledger`, `time-travel`,
`trace-toolpack`) and one example now import `CommitBundle` and `applySmartMerge` from
`footprintjs/trace`; the test helper takes `SharedMemory` from `footprintjs/write`. So the
`footprintjs` peer range is now `^9.47.0`: earlier footprintjs releases do not hand these names out on
`/trace`. Earlier agentfootprint releases keep working on footprintjs 9.x. Nothing an agent records,
reads or returns changes; the types are footprintjs's same types.

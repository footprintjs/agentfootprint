---
type: internal
---
Split Agent runtime responsibilities into documented internal owners while preserving existing public contracts and behavior.

Private TypeScript configuration fields now live under a non-enumerable Symbol; instance Object.keys and JSON no longer include them.

Shared native readers remain borrowable by other RunnerBase implementations, with original snapshot, observer-drain and async-capture behavior.

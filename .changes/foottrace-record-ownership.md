---
type: breaking
---
**Breaking: boundary indexes now use Foottrace's `CommitRangeIndex` class.**
AgentFootprint depends on `foottrace ^1.0.0` and accepts `footprintjs ^9.47.0 || ^10.0.0`.
Time travel, causal queries, boundary indexes and record types use their canonical package;
engine execution, recorders and stores remain with FootPrint. This ownership change alone
removes no AgentFootprint export (the other breaking changes below retire deprecated APIs),
but `BoundaryRecorder.boundaryIndex` has a new nominal type and runtime class
identity. Recorded values and query behavior are unchanged.

Migration: import `CommitRangeIndex` from `foottrace`, not `footprintjs/trace`, for
boundary-index type annotations and `instanceof` checks. Likewise, catch errors from
AgentFootprint's record readers with `UnknownVerbError` from `foottrace`, because
the old engine class no longer matches those errors. Import other record readers
and types directly from `foottrace` as shown in the updated examples and documentation;
keep engine imports on their existing FootPrint doors.

# Trace — time row contracts

`../rows.ts` remains the synchronous row facade: its existing builders, ledger
queries, closed-kind router and checkpoint checks remain there. `types.ts`
owns the complete existing row interface/type union family, including the
bounded TimeReplyRow contract already present in the current WIP.

This is a Stage A type-only whole-unit move. The new module has only erased
type imports, never an English reader, reply parser, resolver or runtime import
back to the facade. All existing types are re-exported through rows.ts without
renaming, a wire change or a new public capability. The facade is below 600
lines; no size baseline is changed here.

Runtime builders/readers/checks, including timeReplyRow and its existing
replyRecord evidence test, are byte-identical. No clock, range, decision label,
metadata, unknown-row behavior or checkpoint acceptance changes in this move.
The heavier reading builders still belong to rowsBuild.ts and remain off the
synchronous checkpoint graph.

Existing behavior tests read the same facade at `test/time/resolve.test.ts`,
`test/time/clock.test.ts`, `test/time/bind.test.ts`, `test/time/english-run.test.ts`
and the checkpoint suites. Root's new reply-row tests remain their existing
owner. Root executes current-head type/graph/runtime checks and exact review;
this README does not carry earlier proof or claim a result.

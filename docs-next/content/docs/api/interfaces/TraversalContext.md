---
title: TraversalContext
---

# Interface: TraversalContext

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:124

Traversal context attached to every FlowRecorder event.
Created by the traverser during DFS, passed to recorders as read-only data.
Enables recorders to build trees, group by subflow, and correlate events
without maintaining their own stacks or post-processing.

Like OpenTelemetry's span context: stageId + parentStageId form a tree.

## Properties

### depth

> `readonly` **depth**: `number`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:172

Subflow nesting depth of the stage's ADDRESS: how many subflow segments its
`runtimeStageId` carries (0 = top level, 1 = inside a subflow or a
`parallelForEach` branch, 2 = a subflow inside that, …). One meaning on
every stamp — stage events, the run-boundary root (0) and `onResume`
(9.37.0; until 9.36.0 stage events stamped the parent-chain length of the
stage's context instead).

***

### forkBranch?

> `readonly` `optional` **forkBranch?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:183

Fork branch ID when inside a parallel or decider branch.

***

### loopIteration?

> `readonly` `optional` **loopIteration?**: `number`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:181

How many times this stage has executed BEFORE in this run — the loop
iteration count when a node is revisited (e.g. via `loopTo`). Absent on the
first execution; `1` on the first loop-back, `2` on the next, … (i.e.
`visitCount - 1`). Run-scoped (resets each `run()`/`resume()`) and monotonic
across subflow re-mounts. Populated for every stage kind. Mirrors the
narrative recorder's "pass N" count.

***

### parentRuntimeStageId?

> `readonly` `optional` **parentRuntimeStageId?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:159

The parent EXECUTION step's runtimeStageId — the runtime twin of
`parentStageId` (RFC-003 D1). Walk up to reconstruct the runtime
ancestor chain; loop re-entries stay unambiguous because runtime ids
(`stageId#executionIndex`) differ per iteration even when stage ids
repeat. Crosses subflow boundaries: the first stage inside a subflow
points at the MOUNT stage's runtimeStageId in the parent traverser.
Undefined only at the first stage of the top-level chart.

***

### parentStageId?

> `readonly` `optional` **parentStageId?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:149

Parent stage ID — walk up to reconstruct the tree. Undefined at root.

***

### resumedFrom?

> `readonly` `optional` **resumedFrom?**: `ResumeLink`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:191

On the `onResume` event only (9.37.0): the PAUSED execution this resumed
run continues — a link in the OpenTelemetry sense, not a parent. A resume
is a new `runId`, so the paused `(runId, runtimeStageId)` cannot be a
parent of anything in it; it is named here instead. Absent when the
checkpoint predates 9.37.0 (it did not record the paused execution).

***

### runId

> `readonly` **runId**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:140

Per-`executor.run()` identifier. Generated once at the start of every
`run()` (and again on `resume()`); shared by every event of that run;
differs across consecutive runs of the same executor.

Format: `${Date.now()}-${counter}` — sortable lexicographically (==
chronologically for runs > 1ms apart). Process-local — for cross-
process correlation use `getEnv().traceId` (consumer-supplied).

Recorders that accumulate state across runs (fork bookkeeping,
sibling-handoff state, etc.) detect "new run" via
`event.traversalContext.runId !== this.lastRunId` and reset
transient bookkeeping. Recorders that don't care about scoping
ignore the field.

***

### runtimeStageId

> `readonly` **runtimeStageId**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:145

Unique per-execution-step identifier. Format: [subflowPath/]stageId#executionIndex.
 Counter resets per executor — combine with `runId` for globally unique step keys.

***

### stageId

> `readonly` **stageId**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:142

Stable stage identifier from the builder (matches spec node id).

***

### stageName

> `readonly` **stageName**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:147

Human-readable stage name.

***

### subflowId?

> `readonly` `optional` **subflowId?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:161

Subflow ID when inside a subflow. Undefined at root level.

***

### subflowPath?

> `readonly` `optional` **subflowPath?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:163

Full subflow path for nested subflows (e.g., "sf-outer/sf-inner").

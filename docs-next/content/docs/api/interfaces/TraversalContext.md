---
title: TraversalContext
---

# Interface: TraversalContext

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:107

Traversal context attached to every FlowRecorder event.
Created by the traverser during DFS, passed to recorders as read-only data.
Enables recorders to build trees, group by subflow, and correlate events
without maintaining their own stacks or post-processing.

Like OpenTelemetry's span context: stageId + parentStageId form a tree.

## Properties

### depth

> `readonly` **depth**: `number`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:148

Nesting depth (0 = root, 1 = inside first subflow, etc.).

***

### forkBranch?

> `readonly` `optional` **forkBranch?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:159

Fork branch ID when inside a parallel or decider branch.

***

### loopIteration?

> `readonly` `optional` **loopIteration?**: `number`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:157

How many times this stage has executed BEFORE in this run — the loop
iteration count when a node is revisited (e.g. via `loopTo`). Absent on the
first execution; `1` on the first loop-back, `2` on the next, … (i.e.
`visitCount - 1`). Run-scoped (resets each `run()`/`resume()`) and monotonic
across subflow re-mounts. Populated for every stage kind. Mirrors the
narrative recorder's "pass N" count.

***

### parentRuntimeStageId?

> `readonly` `optional` **parentRuntimeStageId?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:142

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

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:132

Parent stage ID — walk up to reconstruct the tree. Undefined at root.

***

### runId

> `readonly` **runId**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:123

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

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:128

Unique per-execution-step identifier. Format: [subflowPath/]stageId#executionIndex.
 Counter resets per executor — combine with `runId` for globally unique step keys.

***

### stageId

> `readonly` **stageId**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:125

Stable stage identifier from the builder (matches spec node id).

***

### stageName

> `readonly` **stageName**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:130

Human-readable stage name.

***

### subflowId?

> `readonly` `optional` **subflowId?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:144

Subflow ID when inside a subflow. Undefined at root level.

***

### subflowPath?

> `readonly` `optional` **subflowPath?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:146

Full subflow path for nested subflows (e.g., "sf-outer/sf-inner").

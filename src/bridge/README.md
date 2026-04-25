# `src/v2/bridge/` — footprintjs ↔ v2 translation helpers

## What lives here

Helpers that translate between footprintjs's runtime context shapes and v2's event meta shape. Small, focused, pure.

```
bridge/
└── eventMeta.ts    buildEventMeta, parseSubflowPath, RunContext, StageOrigin
```

## Why this folder exists

Recorders need to enrich every v2 event with `EventMeta`:

```typescript
interface EventMeta {
  wallClockMs: number;
  runOffsetMs: number;
  runtimeStageId: string;
  subflowPath: readonly string[];
  compositionPath: readonly string[];
  runId: string;
  turnIndex?: number;
  iterIndex?: number;
  traceId?: string;
  spanId?: string;
  correlationId?: string;
}
```

Building this from footprintjs's per-event context (TraversalContext, RecorderContext, EmitEvent) involves several quirks:

- Three different shapes for `subflowPath` (string, array, or derivable from `runtimeStageId`)
- Wall-clock vs run-offset time requires a `runStartMs` anchor held by the runner
- `compositionPath` is a runner-scope concept not present in footprintjs events

Centralizing the translation in one place keeps every core recorder consistent.

## Architectural decisions

### Decision 1: One builder, three accepted input shapes

`buildEventMeta(origin, runContext)` accepts:

- `TraversalContext` (from FlowRecorder events — `subflowPath: string | undefined`)
- `RecorderContext` (from data-flow events — no `subflowPath`, derived from `runtimeStageId`)
- `EmitEvent`-shaped `StageOrigin` (subflowPath as `readonly string[]`)
- `undefined` (manual emit during tests)

The helper normalizes all of them. Recorders pass whatever they have; they don't branch.

### Decision 2: Never re-implement footprintjs parsing

Runtime stage ID parsing lives in `footprintjs/trace::parseRuntimeStageId`. We import it. The bridge's `parseSubflowPath` is a thin `.split('/')` convenience — the authoritative parser is footprintjs's.

Why: the `/`-separator is a footprintjs-owned convention. If it ever changes, footprintjs's parser changes, and our bridge inherits the fix.

### Decision 3: `RunContext` is runner-scoped and mutable

Each `Runner` holds a `currentRunContext` that refreshes on every `.run()` call:

```typescript
{
  runStartMs: Date.now(),
  runId: makeRunId(),
  compositionPath: [`Agent:${this.id}`],
  // turnIndex, iterIndex set by the runner as iterations progress
}
```

Recorders receive a `getRunContext()` closure rather than the snapshot — so they read the current value on every event, not a stale one from construction time.

This pattern also supports future concurrent-run scenarios (`runBatch`) where the runner juggles multiple contexts.

### Decision 4: Graceful degradation, never throw

`buildEventMeta(undefined, run)` returns a valid `EventMeta` with `runtimeStageId: 'unknown#0'` and empty `subflowPath`. Tests that emit events directly through the dispatcher (without a real executor context) get a usable meta.

Throwing in the meta builder would crash emit paths. The dispatcher's fire-and-forget contract means observers never break runs — the builder must never break them either.

## What this folder does NOT do

- **No event dispatching** — that's `events/dispatcher.ts`.
- **No grouping logic** — that's `recorders/core/`.
- **No scope manipulation** — the helpers are read-only over the inputs they receive.

If a helper has side effects or carries domain logic, it belongs in a recorder or core module, not here.

## When to add to this folder

Rarely. A new helper lands here only when multiple recorders need the same translation step. Criteria:

1. Pure function with no state.
2. Used by 2+ recorders (existing or planned).
3. Translates between footprintjs and v2 vocabularies.

Otherwise, keep the utility local to the caller.

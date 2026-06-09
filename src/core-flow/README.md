# `src/core-flow/` — compositions

## What lives here

The four control-flow compositions. Each is a thin wrapper over a footprintjs builder primitive, adding typed events, symmetric fluent API, and integration with the 4 core recorders.

```
core-flow/
├── Sequence.ts      Sequential chain of runners (step → step → step).
├── Parallel.ts      Fan-out: N branches run concurrently, then merge.
├── Conditional.ts   Predicate-gated routing (one of N branches runs).
└── Loop.ts          Iteration with mandatory budget guard.
```

## Architectural decisions

### Decision 1: Four compositions, not more

These are the four control-flow primitives from programming-language theory: **sequence**, **parallel**, **branch**, **iteration**. Every higher-level pattern (Swarm, MapReduce, ToT, Reflection, Debate) is expressible as a nested composition of these. Adding a fifth composition would be a sign we're modelling the wrong abstraction.

### Decision 2: Each composition wraps ONE footprintjs primitive

| Composition | Footprintjs primitive | Why |
|---|---|---|
| `Sequence` | `.addSubFlowChartNext(...)` chain | Linear continuation — matches the builder's `Next` idiom |
| `Parallel` | `.addSubFlowChart(...)` siblings → `ChildrenExecutor` fork (`Promise.allSettled`). Each branch's `getSpec()` is mounted DIRECTLY — no wrapper, no nested executor. Per-branch errors surface via a `FlowRecorder.onError` listener that correlates by the engine-prefixed `stageId`. | `addSubFlowChart` (without `Next`) auto-forks siblings under a parent |
| `Conditional` | `.addDeciderFunction(...)` + `.addSubFlowChartBranch(...)` | decider picks one branch; `setDefault` guards fallback |
| `Loop` | outer chart + `.loopTo(...)` + `scope.$break()` | iterate body subflow; guard breaks out |

Compositions do NOT reinvent control flow — they're named, typed, event-emitting adapters over footprintjs's existing primitives.

### Decision 3: Symmetric builder API

Every composition follows the same shape:

```typescript
Composition.create(opts)
  .<member>(id, runner, ...)   // add children
  .<policy>(...)                // optional policy
  .build();                      // → Runner
```

Members:
- `Sequence.step(id, runner)` / `.pipeVia(fn)` — reads "step A, pipe via fn, step B"
- `Parallel.branch(id, runner, name?)` / `.mergeWithFn(fn)` / `.mergeWithLLM(opts)`
- `Conditional.when(id, pred, runner)` / `.otherwise(id, runner)`
- `Loop.repeat(runner)` / `.times(n)` / `.forAtMost(ms)` / `.until(guard)` — reads "repeat X, N times, for at most M ms, until guard"

Consumers learn one pattern and apply it across all four.

### Decision 4: String-in / string-out Runner contract

Each child of a composition is a `Runner<{ message: string }, string>`. Input shape and output shape are uniform — **any Runner composes into any composition**:

```typescript
const pipeline = Sequence.create()
  .step('classify', classifyAgent)
  .step('review',
    Parallel.create()
      .branch('a', agentA)
      .branch('b', agentB)
      .mergeWithLLM({ provider, model, prompt: 'Synthesize:' })
      .build()
  )
  .step('respond',
    Conditional.create()
      .when('urgent', (i) => i.message.startsWith('URGENT'), urgentAgent)
      .otherwise('normal', normalAgent)
      .build()
  )
  .build();
```

No type gymnastics needed to compose — the uniformity IS the composability.

### Decision 5: Output piping between steps — via `sfOutput` TraversalResult

A runner's `.getSpec()` last-stage return becomes the subflow's TraversalResult. When mounted via `addSubFlowChart*`, the `outputMapper` receives that TraversalResult (the string directly, NOT scope state).

```typescript
outputMapper: (sfOutput) => ({
  current: typeof sfOutput === 'string' ? sfOutput : '',
})
```

This is the clean pattern — no `scope.result` side-channel needed. Every composition uses this same output-pipe mechanism.

### Decision 6: Loop budget is MANDATORY

`Loop.build()` without any budget guard fails at build time — but it's also safe by default: if you call `.body(runner).build()` with nothing else, you get `maxIterations: 10`. A hard iteration ceiling of **500** fires regardless of consumer config — runaway loops cannot happen.

Three budget axes:
- `maxIterations(n)` — hard iteration cap (default 10, hard ceiling 500)
- `maxWallclockMs(n)` — wall-clock limit
- `until(guard)` — semantic exit predicate

Any one fires → `iteration_exit` emits with the matching `reason: 'budget' | 'guard_false' | 'break' | 'body_complete'` + `composition.exit` with `status: 'budget_exhausted'` when it was a budget that fired.

### Decision 7: All 4 core recorders attached internally

Every composition's `.run()` attaches all four: ContextRecorder, StreamRecorder, AgentRecorder, CompositionRecorder. Events from NESTED runners (e.g., an Agent inside a Sequence step) propagate to the outer composition's dispatcher via footprintjs's event channels.

Consumers subscribe ONCE at the outer runner and receive events from every nested depth.

### Decision 8: Parallel branches mount the runner's chart directly (no wrapper)

Each branch is mounted into the Parallel's chart via `addSubFlowChart(branch.id, branch.runner.getSpec(), branch.name, { inputMapper, outputMapper })` — the SAME pattern Sequence / Loop / Conditional use. There is no `RunBranch` stage and no nested `FlowChartExecutor` wrapping `branch.runner.run(...)`.

Why this matters (regression guards in [`test/core-flow/integration/parallel-subflow-composition.test.ts`](../../test/core-flow/integration/parallel-subflow-composition.test.ts)):

- **One `runtimeStageId` address space** — branch-internal stages share the parent executor's execution counter. No `#0` restart inside a branch.
- **One snapshot tree** — branches contribute to `executor.getSnapshot().subflowResults` directly. Domain consumers (Lens, audit, custom recorders) reach branch detail without crossing an executor boundary.
- **Recorder events flow naturally** — branch LLM/tool/stream events reach the parent's dispatcher through footprintjs's existing channels. The old `branch.runner.on('*', e => scope.$emit(...))` forwarding hack is gone.
- **Spec faithfully reflects runtime** — `Parallel.getSpec()` returns a chart where each branch slot IS the branch runner's chart, not a synthetic shim.

Per-branch error containment: footprintjs's `ChildrenExecutor` uses `Promise.allSettled` by default — a failing branch does not cancel siblings. When a branch errors, footprintjs's `SubflowExecutor` swallows the error into `parentContext.addError(...)` and skips that branch's `outputMapper`. Parallel restores the per-branch error message via a small internal `CombinedRecorder` that listens for `FlowRecorder.onError` events and keys them by the first segment of `traversalContext.stageId` (e.g., `legal/call-llm` → branch `legal`). The merge stage reads from this map for both strict-mode aggregated error messages and tolerant-mode `BranchOutcome.error` strings.

Two refinements on top of that containment model (backlog #10):

- **Required branches** — `.branch(id, runner, { required: true })` marks a branch whose failure must reject the WHOLE run, even under a tolerant `.mergeOutcomesWithFn()` merge. When EVERY branch is required, the built chart's fork node (the seed/root — stacked `addSubFlowChart` calls fork from the builder cursor) carries footprintjs's `StageNode.failFast`, switching `ChildrenExecutor` to `Promise.all`: the first failure rejects `executor.run()` immediately, and `run()`/`resume()` re-attribute the raw rejection to its branch (plus a synthetic `composition.exit` `status:'err'` to preserve enter/exit pairing, carrying the same real `runId` as the enter). Re-attribution correlates by error IDENTITY: the recorder stores the ORIGINAL error object from `FlowErrorEvent.structuredError.raw` per branch, and the rejection is matched by reference first, bare message second — so attribution works for ANY error class (`TypeError`, provider-SDK subclasses like `RateLimitError`), not just bare `Error`. The per-branch error map is epoch-scoped per run: abandoned fail-fast siblings of a rejected run keep executing in the background, and their late errors are dropped instead of contaminating the next run's attribution. With a MIXED required/optional set, fork-level `failFast` stays OFF (it is all-or-nothing — an optional sibling's throw would also abort) and required failures are enforced at the merge join instead.
- **outputMapper error attribution** — footprintjs does NOT fire `FlowRecorder.onError` for errors thrown inside `applyOutputMapping` (they're routed to `parentContext.addError('outputMapperError', ...)`), so the recorder alone would print `unknown error` for a mapper-class failure. Every branch mount wraps its `outputMapper` in `wrapBranchOutputMapper(...)`, which records the throw against the branch id (first error wins, mirroring the recorder) before rethrowing along footprintjs's existing path.

Two semantics to know when engaging all-required fail-fast:

- **Pause pre-empts siblings.** Under `Promise.all`, a branch that PAUSES (`pauseHere()`) settles the fork the same way a failure does — still-running siblings are not awaited before the run surfaces the `RunnerPauseOutcome`. The checkpoint reflects the paused branch; `resume()` continues from there, and a required branch failing AFTER resume is re-attributed exactly like on the `run()` path. Under the default best-effort fork, a pause is only surfaced after every sibling settles.
- **Nested mounting falls back to raw engine rejection.** Attribution and the synthetic `composition.exit` live on `Parallel.run()`/`Parallel.resume()`. When the Parallel's chart is MOUNTED into an outer composition (e.g. `Sequence.step('s', parallel)`), the OUTER runner's executor runs the chart: fork-level `failFast` still aborts the fan-out, but the rejection surfaces RAW (no `required branch 'x' failed` wrapping) and the nested Parallel's `composition.enter` is left without a matching `exit`. Pinned by `test/core-flow/scenario/Parallel-required-branches.test.ts` ("nested mounting limitation"); proper support would need a protocol for mounted children to contribute recorders + rejection decorators to the parent executor.

### Decision 9: `core-flow/` has zero LLM dependency

Every file in this folder depends only on: `footprintjs`, `../core/runner.ts`, `../core/RunnerBase.ts`, `../recorders/core/*`, `../bridge/eventMeta.ts`. **Never imports from `../core/LLMCall.ts` or `../core/Agent.ts`**.

This is enforced by convention (no import paths cross the line). Compositions take `Runner<T>` generically — they don't know or care whether a child is LLM-backed. That makes them trivially testable with pure-function runner stubs.

## Events emitted

| Composition | Events |
|---|---|
| Sequence | `composition.enter`, `composition.exit` |
| Parallel | `composition.enter`, `composition.fork_start`, `composition.merge_end` (per merge), `composition.exit` + if `mergeWithLLM`: `stream.llm_start` / `stream.llm_end` |
| Conditional | `composition.enter`, `composition.route_decided` (with chosen branch + rationale), `composition.exit` |
| Loop | `composition.enter`, per iteration: `composition.iteration_start` + `composition.iteration_exit` (reason: body_complete/budget/guard_false/break), `composition.exit` |

All flow through the same dispatcher — consumers subscribe with `agent.on('agentfootprint.composition.*', handler)` or via the typed `.on(<exact type>, handler)` form.

## When to add a new composition

Very rarely. The four primitives cover all control-flow shapes from programming language theory. Before adding a fifth, verify the behavior can't be expressed as a nested combination of the existing four. If you truly need one:

1. Confirm it represents a control-flow shape NOT expressible via nesting of the existing four
2. Wrap exactly ONE footprintjs builder primitive
3. Emit `composition.*` events via `typedEmit`
4. Return a `Runner<{ message: string }, string>` implementation
5. Attach all 4 core recorders internally in `.run()`
6. Document the wrapped footprintjs primitive + the symmetric builder API

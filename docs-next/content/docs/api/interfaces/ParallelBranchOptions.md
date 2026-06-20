---
title: ParallelBranchOptions
---

# Interface: ParallelBranchOptions

Defined in: [src/core-flow/Parallel.ts:128](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Parallel.ts#L128)

Options bag accepted by `ParallelBuilder.branch()` for per-method
overrides. Backwards-compatible with the legacy
`.branch(id, runner, name?)` signature: when the third arg is a
string it's still treated as `name`.

## Properties

### groupTranslator?

> `readonly` `optional` **groupTranslator?**: [`GroupTranslator`](/docs/api/interfaces/GroupTranslator)\<`unknown`\>

Defined in: [src/core-flow/Parallel.ts:132](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Parallel.ts#L132)

Per-method translator override. See `BranchEntry.groupTranslator`.

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [src/core-flow/Parallel.ts:130](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Parallel.ts#L130)

Human-friendly name for this branch. Default: the branch id.

***

### required?

> `readonly` `optional` **required?**: `boolean`

Defined in: [src/core-flow/Parallel.ts:170](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Parallel.ts#L170)

Mark this branch as REQUIRED: its failure rejects the whole Parallel
run — even under a tolerant `.mergeOutcomesWithFn()` merge — with an
error that names the branch. Default `false` (existing semantics:
strict merges aggregate failures at the join; tolerant merges receive
them as `BranchOutcome` entries).

Fail-fast wiring: when EVERY branch is required, footprintjs's
fork-level `failFast` is engaged (`Promise.all`) so the first failure
aborts the fan-out immediately — siblings are not awaited and the
Merge stage never runs. When only SOME branches are required, the
fan-out stays best-effort (`Promise.allSettled`) and required
failures are enforced at the Merge join instead — footprintjs's
`failFast` is all-or-nothing per fork node, so engaging it for a
mixed set would wrongly abort the run when an OPTIONAL sibling
throws. See `docs/guides/concepts.md` (Parallel).

Pause semantics under fail-fast: with every branch required, a branch
that PAUSES (`pauseHere()`) pre-empts its siblings the same way a
failure does — `Promise.all` settles on the first non-success, so
still-running siblings are not awaited before the run surfaces the
`RunnerPauseOutcome`. The checkpoint reflects the paused branch;
`resume()` continues from there and re-attributes any post-resume
required-branch failure just like `run()` does. Under the default
best-effort fork, a pause is only surfaced after every sibling
settles.

Nested-mounting limitation: required-branch attribution and the
synthetic `composition.exit` are wired through `Parallel.run()` /
`Parallel.resume()`. When the Parallel's chart is instead MOUNTED
into an outer composition (e.g. `Sequence.step('s', parallel)`), the
outer runner's executor runs the chart — the fork-level `failFast`
still aborts the fan-out, but the rejection surfaces RAW (no
`required branch 'x' failed` wrapping) and the nested Parallel's
`composition.enter` is left without a matching `exit`. See README
Decision 8.

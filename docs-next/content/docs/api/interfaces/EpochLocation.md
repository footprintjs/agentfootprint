---
title: EpochLocation
---

# Interface: EpochLocation

Defined in: [src/lib/time-travel/epochs.ts:64](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/epochs.ts#L64)

One epoch, located: which log holds its call, where in that log, and what
 that log folds against.

## Properties

### basis

> `readonly` **basis**: [`FoldBasis`](/docs/api/type-aliases/FoldBasis)

Defined in: [src/lib/time-travel/epochs.ts:108](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/epochs.ts#L108)

How [EpochLocation.source](/docs/api/interfaces/EpochLocation#source) folds. `'log-only'` means the recording
travelled without its fold base, so anything the log never `set` reads as
absent — `servedView.ts` turns that into a declared gap rather than an
empty view.

***

### callIdx

> `readonly` **callIdx**: `number`

Defined in: [src/lib/time-travel/epochs.ts:85](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/epochs.ts#L85)

The call's ARRAY index in [EpochLocation.log](/docs/api/interfaces/EpochLocation#log).

***

### callRuntimeStageId

> `readonly` **callRuntimeStageId**: `string`

Defined in: [src/lib/time-travel/epochs.ts:80](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/epochs.ts#L80)

The `call-llm` stage's `runtimeStageId` — the llm-turn stop's own id.

***

### epoch

> `readonly` **epoch**: `number`

Defined in: [src/lib/time-travel/epochs.ts:78](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/epochs.ts#L78)

The committed `iteration` at the call. 1-based, and READ rather than
counted — a run that pauses and resumes still names its epochs the way the
run itself named them.

ONE fallback, and it is a count: when the fold cannot read `iteration` at
all (a recording whose base did not travel, on a run that never re-`set`
it), this is the location's position in run order instead. The tell is
[EpochLocation.basis](/docs/api/interfaces/EpochLocation#basis) / [EpochLocation.runBasis](/docs/api/interfaces/EpochLocation#runbasis) reading
`'log-only'`, which is also what makes `servedView.ts` raise
`no-fold-base`. A view must have some number to be addressed by; this one
is the honest second choice, not a claim about the record.

***

### hasRunLog

> `readonly` **hasRunLog**: `boolean`

Defined in: [src/lib/time-travel/epochs.ts:114](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/epochs.ts#L114)

`false` when this recording carries no RUN log at all — a subtree handed
 in on its own. Every run constant is then unreadable, which
 `servedView.ts` declares rather than reads as absent.

***

### log

> `readonly` **log**: readonly `CommitBundle`[]

Defined in: [src/lib/time-travel/epochs.ts:83](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/epochs.ts#L83)

The log the call committed to: the run's own under `'dynamic'`, the
 turn's inner history under `'dynamic-grouped'`.

***

### runBasis

> `readonly` **runBasis**: [`FoldBasis`](/docs/api/type-aliases/FoldBasis)

Defined in: [src/lib/time-travel/epochs.ts:110](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/epochs.ts#L110)

The same, for [EpochLocation.runSource](/docs/api/interfaces/EpochLocation#runsource).

***

### runLog

> `readonly` **runLog**: readonly `CommitBundle`[]

Defined in: [src/lib/time-travel/epochs.ts:89](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/epochs.ts#L89)

The RUN's log, always. Run constants (a build-time fact seeded once) are
 read here, because a grouped turn's inner log never sees them unless the
 boundary happens to carry them.

***

### runSource

> `readonly` **runSource**: `FoldSourceLike`

Defined in: [src/lib/time-travel/epochs.ts:101](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/epochs.ts#L101)

The same, for [EpochLocation.runLog](/docs/api/interfaces/EpochLocation#runlog).

***

### source

> `readonly` **source**: `FoldSourceLike`

Defined in: [src/lib/time-travel/epochs.ts:99](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/epochs.ts#L99)

The fold source [EpochLocation.log](/docs/api/interfaces/EpochLocation#log) belongs to — the log PLUS the
base it was recorded against. Reads go through it, never through the bare
array, so a value seeded before the run (every key of a resumed run) folds
from where it actually came from.

***

### subflowScope?

> `readonly` `optional` **subflowScope?**: `string`

Defined in: [src/lib/time-travel/epochs.ts:92](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/epochs.ts#L92)

The `sf-llm-call` mount this epoch was projected from — set under
 `'dynamic-grouped'` only, and the tell that `callIdx` is inner-relative.

---
title: milestoneStops
---

# Function: milestoneStops()

> **milestoneStops**(`commitLog`, `executionTree?`): `Stop`[]

Defined in: [src/lib/time-travel/milestoneStops.ts:129](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/milestoneStops.ts#L129)

Derive one stop per committed MILESTONE from a recorded commit log.

The rule, in one sentence: take footprintjs's own per-stage axis, keep the
stages `milestoneFor` classifies, and give the survivors the log back.

**Composed, never re-derived.** The hard parts of the per-stage axis are
already solved upstream and are not repeated here: one stop per
`runtimeStageId` at its FIRST commit (a subflow mount commits twice, a
parallel fork child commits twice and siblings interleave — every repeat is
an empty bundle), the authoritative mount set read off the execution tree,
the `'start'` / `'end'` bookends, and the id-less leading commit that carries
a subflow's `inputMapper` seed. This function calls `commitStops` and filters
its result. A second implementation of that collapsing would be a second
chance to disagree with the library about what a stage is.

**The survivors re-partition the log.** A stage that classifies `null` is not
a stop, but its commits still happened, so they are folded into the stop that
PRECEDES them: every kept stop's `lastCommitIdx` is extended to just before
the next kept stop begins. Nothing is orphaned, and `stateAt(stop)` remains
exactly "the state that existed when the next milestone's stage started".
Commits before the FIRST milestone belong to `'start'` for the same reason —
so on a drilled cursor `'start'` reads as "what this subflow began with,
after its plumbing ran".

**What that costs `'start'`.** On footprintjs's own axis `'start'` is the fold
base: the state before ANY stage ran. Here it absorbs every stage that ran
before the first milestone, so `stateAt(start)` is the state the first
milestone READ, not the run's raw base — a real agent seeds a couple of dozen
keys in `seed` before anything a reader would scrub to. That is the right
answer for this axis (the stops must still partition the log) and the wrong
one to assume from `kind: 'start'` alone, so it is said out loud here, in the
folder README, on the docs page and in a test.

**A log with no milestones in it at all.** A non-empty log the classifier
recognises nothing in — a non-agent chart handed this strategy — yields the
two bookends and nothing between them: `'start'` folds the whole log,
`'end'` folds the whole log, and `jumpTo` any stage id refuses with
`reason: 'miss'`. An axis with nowhere meaningful to stand, which is the
truthful shape for a run that has no milestones — not an error, and not the
empty `[]` that says the log itself was empty.

**It does not know which log it was given.** The classifier reads the LOCAL
segment of a stage id, so `sf-llm-call#3` on a run's outer log and
`sf-llm-call/call-llm#7` on that mount's drilled inner history are both
classified without the strategy being told which one it is holding. That is
what lets one strategy serve `reactMode: 'dynamic'` (the `call-llm` bundle is
in the outer log → an llm-turn stop on the outer cursor) and
`'dynamic-grouped'` (the outer log holds `sf-llm-call` mounts → iteration
stops; `drill()` gives the inner cursor, where the same strategy finds the
llm-turn, tool-call and decision stops).

## Parameters

### commitLog

readonly `CommitBundle`[]

the run's `commitLog`, or a subflow's own `history`.

### executionTree?

`StageSnapshot`

the run's `executionTree`, when the caller has it — it
  is what makes a mount stop say `kind: 'mount'` rather than being guessed
  from bundle shape.

## Returns

`Stop`[]

## Example

```ts
import { timeTravel } from 'footprintjs/trace';
import { milestoneStopsStrategy, milestoneOf } from 'agentfootprint';

const cursor = timeTravel(agent.getSnapshot()!, { strategy: milestoneStopsStrategy });
cursor.stops.map((s) => [s.label, milestoneOf(s)?.kind]);
// measured on a two-turn `dynamic` run — 42 commits, 15 stops:
// [['Run start', undefined], ['Iteration', 'iteration'],
//  ['System prompt', 'slot'], ['Messages', 'slot'], ['Tools', 'slot'],
//  ['LLM turn', 'llm-turn'], ['Route', 'decision'], ['Tool call', 'tool-call'],
//  … the second turn …, ['Run end', undefined]]
```

**Fold** — where a reader of a finished agent run is allowed to stop.
`milestoneStops.ts` derives those positions from the recorded commit log and
nothing else: no event, no recorder, no re-walk of the chart.

# time-travel — the agent's stops on the reader's cursor

footprintjs 9.17 ships the cursor itself. `timeTravel(snapshot)` opens a
read-only position over a finished run, with a fold at every stop, and takes a
`TimeTravelStrategy` that says where the stops are. The one strategy it ships,
`commitStops`, puts a stop on every executed stage — the only grammar the
substrate knows, because the engine stamps one `runtimeStageId` per stage and
has never heard of an LLM turn.

agentfootprint has heard of one. `conventions.ts` · `milestoneFor` has
classified a local stage id into a **milestone** —
`iteration` · `slot` · `llm-turn` · `tool-call` · `decision` — for several
releases: a pure function over an id, no event, no hot path. What was missing
was the join. Every consumer that wanted a milestone slider mapped that
classifier onto commits itself, which meant the agent's own vocabulary arrived
at each reader slightly differently. `milestoneStops` is that join, written
once, on the seam the port opened.

```ts
import { timeTravel } from 'footprintjs/trace';
import { milestoneStopsStrategy, milestoneOf } from 'agentfootprint';

const cursor = timeTravel(agent.getSnapshot()!, { strategy: milestoneStopsStrategy });

cursor.stops.map((s) => `${s.label} (${milestoneOf(s)?.kind ?? s.kind})`);
// The whole axis of a two-turn run, measured (examples/observability/23-…):
// ['Run start (start)',
//  'Iteration (iteration)', 'System prompt (slot)', 'Messages (slot)',
//  'Tools (slot)', 'LLM turn (llm-turn)', 'Route (decision)', 'Tool call (tool-call)',
//  'Iteration (iteration)', 'System prompt (slot)', 'Messages (slot)',
//  'Tools (slot)', 'LLM turn (llm-turn)', 'Route (decision)',
//  'Run end (end)']
// 42 commits → 15 stops. Note the slot stops: a turn is assembled before it is made.

cursor.jumpTo('call-llm#19');       // turn 1 of that same run
cursor.changedSince();              // the keys that turn wrote
cursor.stateAt().state.currentSkillId;  // 'alpha'
```

## What it reads / what it writes

Reads a `commitLog` (a run's) or a `history` (a subflow's own), plus the
`executionTree` when the caller has one — that is what makes a mount stop say
`kind: 'mount'` instead of being guessed from bundle shape. Writes nothing. It
is a pure function of a recording; a stored JSON snapshot behaves exactly like
a live one.

## The three rules

### 1. Composed from the per-stage axis, never re-derived

`milestoneStops` calls footprintjs's `commitStops` and filters the result. The
hard parts of that axis are already solved upstream and are deliberately not
repeated here: **one stop per `runtimeStageId`, at its first commit** (a subflow
mount commits twice, a parallel fork child commits twice and siblings
interleave — every repeat after the first is an empty bundle), the mount set
read off the execution tree, the `'start'` / `'end'` bookends, and the id-less
leading commit that carries a subflow's `inputMapper` seed. A second
implementation of that collapsing would be a second chance to disagree with the
library about what a stage is.

### 2. A stage that classifies `null` folds into the stop before it

Not every stage is a place a person would scrub to. `seed`, `pick-entry`,
`window`, the cache plumbing — `milestoneFor` returns `null` for all of them,
so they get no stop. Their commits still happened, so each kept stop's
`lastCommitIdx` stretches to just before the next kept stop begins, and the
commits before the FIRST milestone belong to `'start'`. Nothing is orphaned;
`stateAt(stop)` stays exactly "the state that existed when the next milestone's
stage started". On a drilled cursor that makes `'start'` read as "what this
subflow began with, after its plumbing ran".

**What that costs `'start'`, said plainly.** On footprintjs's own axis `'start'`
is the fold BASE — the state before any stage ran, which no commit index can
otherwise reach. Here it also absorbs everything that ran before the first
milestone, and a real agent seeds a couple of dozen keys in `seed` first. So
`stateAt(start)` on this axis is *the state the first milestone read*, not the
run's raw base, and a renderer keyed on `kind === 'start'` to show "what the run
began with" is showing post-seed state. Measured on a two-turn `dynamic` run:
footprintjs's `'start'` folds commits `-1..-1` and 0 keys; this one folds
`-1..0` and 32. That is the right answer for an axis whose stops must still
partition the log, and the wrong thing to assume from the `kind` alone — so it
is pinned by a test rather than left to be discovered.

**A log with no milestones in it at all.** A non-empty log the classifier
recognises nothing in — a non-agent footprintjs chart handed this strategy —
yields the two bookends and nothing between them: `'start'` folds the whole log,
`'end'` folds the whole log, and `jumpTo` any stage id refuses with
`reason: 'miss'`. That is the truthful shape for a run with no milestones. It is
NOT the empty `[]`, which says something else — that the log itself was empty.

### 3. It does not know which log it was given

The classifier reads the LOCAL segment of a stage id, so `sf-llm-call#3` on an
outer log and `sf-llm-call/call-llm#7` on that mount's inner history are both
classified without the strategy being told which one it holds. One strategy
therefore serves the outer cursor and every drilled one — see the two shapes
below.

## The two chart shapes

### `reactMode: 'dynamic'` — the turn is on the outer log

The flat chart commits `call-llm` in the run's own log, so the llm-turn stop is
on the outer cursor, next to the `sf-injection-engine` iteration stops and the
slot stops.

```ts
const agent = Agent.create({ provider, model: 'm', reactMode: 'dynamic' }).system('bot');
await agent.run('why?');

const cursor = timeTravel(agent.getSnapshot()!, { strategy: milestoneStopsStrategy });
cursor.stops.filter((s) => milestoneOf(s)?.kind === 'llm-turn').length;   // one per turn
cursor.jumpTo('call-llm#12');
cursor.stateAt().state;              // the state that turn left behind
```

### `reactMode: 'dynamic-grouped'` — the turn is one drill down

The grouped chart wraps each turn in an `sf-llm-call` subflow, which runs in its
own isolated runtime and commits to its own log. So the outer log holds the
MOUNTS — one `'iteration'` stop per turn — and the llm-turn / tool-call /
decision stops live inside. `drill()` is how you get there, and the same
strategy is what reads it.

```ts
const cursor = timeTravel(agent.getSnapshot()!, { strategy: milestoneStopsStrategy });
const turn2 = cursor.stops.filter((s) => milestoneOf(s)?.kind === 'iteration')[1]!;

const inner = cursor.drill(turn2.runtimeStageId)!;   // its own cursor, its own log
inner.stops.map((s) => milestoneOf(s)?.kind);
// measured: [undefined, 'iteration', 'slot', 'slot', 'slot', 'llm-turn', undefined]
// — the same grammar as the outer axis, over the turn's own 20-commit log.
inner.stateAt().state;                                // folded against the SUBFLOW's base
```

The mount is addressed by its `runtimeStageId`, not its path: a subflow inside a
loop runs many times and every iteration shares one path, so `sf-llm-call#4` and
`sf-llm-call#9` are two different turns and drill to two different logs.

## The honest edge: which keys are visible where

A grouped run's outer log carries what crossed the subflow boundary — what the
`outputMapper` merged back — and the inner log carries what the turn wrote
inside. A key written and read entirely within the turn is on the inner cursor
only. `changedSince()` answers for the log it is asked about and never guesses
about the other one, which is why "scrub the outer axis, drill for the detail"
is the shape of every reader built on this.

## The other honest edge: a resumed run

The cursor reads the snapshot it is handed, and a resume is its own execution
with its own log. So `getSnapshot()` after `agent.resume(checkpoint, answer)`
carries the RESUMED half: its axis begins at the stage the resume re-entered,
and the milestones from before the pause are not on it. They are on the snapshot
taken at the pause — open a second cursor over that one to read the first half.
Nothing about the strategy changes across a pause (the stops still tile, ids
stay unique), which is why this is a note about snapshots rather than a defect.

## What this folder deliberately is not

- **Not a second cursor.** A strategy only says where the one cursor may rest.
  Position, folds, marks and drilling all stay with `timeTravel`.
- **Not a recorder.** Nothing is emitted at run time and nothing is stored
  beside the log. Marks are the reader's notes, held by the cursor, and never
  appear in a recording.
- **Not a re-walk.** A milestone that never committed gets no stop. A cursor
  that stops where no evidence exists is telling a story rather than reading
  one.

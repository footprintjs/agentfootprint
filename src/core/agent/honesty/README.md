**Mixed** — where the honesty layers mount, and which ones a run armed.
Map: `armed.ts` (the one run constant, `AgentState.honestyLayers`).
Walker: `mounts.ts` (the conditional mounts both chart builders call, each layer's input and output mappings, and the answer layer's read list).

**The law.** A layer is a subflow mounted only when armed: an agent that armed none builds
the chart, commits the keys and serves the bytes it always did.

Every model decision is a claim: the model declares its grounds, the library checks what it
can, one ledger (`AgentState.findingsLedger`) keeps the verdict, and the answer's standing is
folded from that record (`assessment/assess.ts` · `assessAnswer`), never from the model's
confidence. Four decision points, one layer each:

| Layer | Decision | Where it mounts | Status |
|---|---|---|---|
| 1 · choice | choose a tool | beside the inputs layer | a later step |
| 2 · inputs | fill its inputs | `sf-inputs`, after the LLM call and before Route (`mounts.ts` · `mountInputsLayer`); its batch ask is raised by ToolCalls, first thing (`stages/argumentAsk.ts` · `askBeforeDispatch`) | **shipped: `assume`, and `ask` for a missing value** (one ask per batch) — `core/agent/arguments/README.md` |
| 3 · results | read a result | the loop head | a later step |
| 4 · answer | give the answer | the first stage of the final branch (`mounts.ts` · `startFinalBranch`), `assess-answer` | **shipped** (`.answerLayer()`): the standing folded in the run and served as data (`turn_end.answerAssessment`, `agentfootprint.answer.assessed`), two witness rows filed by Route, an opt-in line — `core/agent/assessment/README.md` |

## How a layer mounts

```ts
// Both builders, at the same place — after the LLM call, before Route:
builder = mountInputsLayer(builder, deps.inputsLayer); // undefined → the builder, untouched
```

- **Handed** (the input mapping, frozen inside the subflow): only what the layer reads — for
  the inputs layer, the batch, Route's dispatch values and `turnNumber`. Never the whole
  ledger; never a tool (tools are closures, read through the one dispatch resolver,
  `stages/toolResolver.ts` · `buildToolResolver`).
- **Returned** (the output mapping, `arrayMerge: Replace` — the loop-crossed mount law): the
  layer's rows, merged into the ONE ledger by its pure half (`findings/ledger.ts` ·
  `appendRows`) in ONE write per layer run, and the layer's working state (for the inputs
  layer, `argumentResolutions`). Nothing to return → nothing is written.
- **Events** fire inside the subflow, from the rows, through the ledger's emit half
  (`findings/ledger.ts` · `emitRow`) — names, enums and counts only.
- **Lazy**: each layer's stage bodies — and every run-time half the other stages need
  from it (for the inputs layer: `arguments/dispatch.ts`, `arguments/serve.ts`) — load
  through `import()` under the arm, so a plain agent's bundle carries none of them. What
  stays static is what a synchronous door needs first (the inputs layer's list:
  `arguments/README.md`, "What a plain agent carries").

## The answer layer — the head of the final branch

A decider branch is one node with no continuation, so the answer layer cannot sit between
Route and Final; it heads the final branch (adopted Q3). footprintjs starts every chart with a
function stage, so the layer is that first stage — `assess-answer`, then PrepareFinal — built by
`mounts.ts` · `startFinalBranch`, which builds the branch exactly as it always was when the
layer is not armed.

```ts
// Both builders, for the final branch:
let finalBranch = startFinalBranch(deps.answerLayer, prepareFinalFor(deps), deps.structureRecorders);
```

- **Handed**: nothing new — the final branch already receives the run's state. The stage reads
  only the committed keys the fold reads that this agent's arms can write (`mounts.ts` ·
  `answerFoldReads`, decided at build: a key no arm can write is never read).
- **Returned**: nothing to the run's state. The branch mount's output mapping receives the
  branch's RESULT (the answer string, which every composition that mounts an agent reads as a
  string), never its scope — so the layer hands its projection to PrepareFinal INSIDE the branch
  (`answerAssessment`), and the rows it folds are the witness rows the Route decider files.
- **Events**: one `agentfootprint.answer.assessed` per answer, from the stage.
- **Lazy**: the stage body, the fold and the line's composer load through `import()` on the first
  armed answer; the witness rows' shape (`assessment/witness.ts`) stays static, because the
  checkpoint door checks it synchronously.
- **What a plain agent carries**: what a synchronous door needs first — the arm and its build
  refusals (`AgentBuilder.answerLayer`), the branch choice (`mounts.ts` · `startFinalBranch`,
  `answerFoldReads`), the witness rows' builders and checkpoint check, the event's name — and
  the armed PrepareFinal body, kept beside every other PrepareFinal body because they share one
  capture (`stages/prepareFinal.ts` · `prepareFinalFor`). Measured by the docs site's own budget
  (`docs-next/scripts/check-site-budget.mjs`, a local `EXPORT=true` build, the same docs with
  only the library swapped): the deferred demo went from 440.8 to 442.8 KB gzip.

## The run constant

`armed.ts` · `honestyLayersOf` — seed writes `honestyLayers` once, naming every armed layer
(`{ inputs: true }`, `{ answer: true }`, or both), and nothing on a run that armed none. A reader
of the record tells "this layer was armed and filed nothing" from "this layer was never armed"
by this key. While any layer is armed, the one writer stamps every ledger row with its `turn`,
a continued conversation's ledger is restored, and the checkpoint carries the turn it ended on
(`AgentRunCheckpoint.turnNumber`) — seed continues the stamp from it and from the restored
ledger's latest stamp (`stages/seed.ts` · `turnNumberFor`), because a window strategy trims the
stored history and a count of its user messages repeats.

## A pause inside a layer

A layer that must ask the person (the inputs layer's batch ask) does not pause inside its own
subflow: on footprintjs 9.26–9.27 a pause raised in a subflow mounted in the ReAct loop body
resumes into a traversal that cannot reach the loop head (the loop-back resolves to its
reference stub and the run ends after one stage), and inside a composition it would sit two
subflows deep. The layer DECIDES what to ask and files its rows through its output mapping;
the loop's own pausable branch (ToolCalls) RAISES the ask, through footprintjs's
`interrupt()`, before anything in the batch runs — the one place footprintjs resumes
correctly. See `core/agent/arguments/README.md`, "The batch ask".

## Not covered

- Layers 1 and 3 — later steps of the plan.
- A row the answer layer itself must commit to the run's state — the final branch cannot write
  back (see above); such a row is filed by the Route decider, or the branch's result shape
  changes with every composition that reads it.
- A layer mounted inside another runner's chart (a composed pattern) — each `Agent` mounts
  its own.

## What it lets you measure

Per layer, from the record alone: how often the layer ran on a batch that dispatched (the
mount's commits), how many verdicts it filed (the rows), and — with `honestyLayers` — the
share of armed runs on which it filed nothing. The layers' own pages carry their metrics.

**Mixed** — where the honesty layers mount, and which ones a run armed.
Map: `armed.ts` (the one run constant, `AgentState.honestyLayers`).
Walker: `mounts.ts` (the conditional mounts both chart builders call, and each layer's input and output mappings).

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
| 3 · results | read a result | `sf-results`, at the loop head — the loop target, before the window strategy (`mounts.ts` · `mountResultsLayer`) | **shipped: the period verdict** (step 7b) — one `period` row per call whose result declared its period or whose tool declares a `ToolPeriod` — `core/agent/results/README.md`; the reading checks and outcome rows are step 8 |
| 4 · answer | give the answer | the first node of the final branch | the standing is a reader today (`assessment/`) |

## How a layer mounts

```ts
// Both builders, at the same places:
builder = mountResultsLayer(builder, deps.resultsLayer); // the loop head — undefined → untouched
// … the loop body …
builder = mountInputsLayer(builder, deps.inputsLayer); // after the LLM call, before Route
```

The results layer becomes the loop target when armed (`mounts.ts` ·
`RESULTS_LOOP_TARGET`, the `Compact` precedent): ToolCalls and every re-ask
branch loop back to it, so it reads the batch just run before the window
strategy folds it away; a re-entry that ran no tool files nothing twice.

- **Handed** (the input mapping, frozen inside the subflow): only what the layer reads — for
  the inputs layer, the batch, Route's dispatch values and `turnNumber`; for the results
  layer, the batch's call ids and tool names, the periods their coverage rows carry, the
  calls already judged this turn, and the stamps. Never the whole ledger; never a tool
  (tools are closures, read through the one dispatch resolver, `stages/toolResolver.ts` ·
  `buildToolResolver`).
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

## The run constant

`armed.ts` · `honestyLayersOf` — seed writes `honestyLayers` once, on a run with a layer
mounted — `{ inputs: true }`, `{ results: true }` or both — and nothing on any other run.
While any layer is armed, the one ledger writer stamps every row it files with the turn. A reader of the record tells
"this layer was armed and filed nothing" from "this layer was never armed" by this key.

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

- Layer 1, layer 3's reading checks and outcome rows (step 8), and the run-time half of
  layer 4 — later steps of the plan.
- A layer mounted inside another runner's chart (a composed pattern) — each `Agent` mounts
  its own.

## What it lets you measure

Per layer, from the record alone: how often the layer ran on a batch that dispatched (the
mount's commits), how many verdicts it filed (the rows), and — with `honestyLayers` — the
share of armed runs on which it filed nothing. The layers' own pages carry their metrics.

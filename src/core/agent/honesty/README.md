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
| 3 · results | read a result | the loop head | a later step |
| 4 · answer | give the answer | the first node of the final branch | the standing is a reader today (`assessment/`) |

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
- **Lazy**: each layer's stage bodies load through `import()` on first use, so a plain
  agent's bundle carries none of them.

## The run constant

`armed.ts` · `honestyLayersOf` — seed writes `honestyLayers: { inputs: true }` once, on a run
whose inputs layer is mounted, and nothing on any other run. A reader of the record tells
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

- Layers 1, 3 and the run-time half of layer 4 — later steps of the plan.
- A layer mounted inside another runner's chart (a composed pattern) — each `Agent` mounts
  its own.

## What it lets you measure

Per layer, from the record alone: how often the layer ran on a batch that dispatched (the
mount's commits), how many verdicts it filed (the rows), and — with `honestyLayers` — the
share of armed runs on which it filed nothing. The layers' own pages carry their metrics.

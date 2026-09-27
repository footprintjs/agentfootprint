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
| 2 · inputs | fill its inputs | `sf-inputs`, after the LLM call and before Route (`mounts.ts` · `mountInputsLayer`) | **shipped: `assume`** — `core/agent/arguments/README.md` |
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

## Not covered

- Layers 1, 3 and the run-time half of layer 4 — later steps of the plan.
- A layer mounted inside another runner's chart (a composed pattern) — each `Agent` mounts
  its own.

## What it lets you measure

Per layer, from the record alone: how often the layer ran on a batch that dispatched (the
mount's commits), how many verdicts it filed (the rows), and — with `honestyLayers` — the
share of armed runs on which it filed nothing. The layers' own pages carry their metrics.

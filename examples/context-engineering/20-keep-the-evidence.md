---
name: Keep the evidence — the last-tool-result pin
group: context-engineering
guide: ../../docs-next/content/docs/build/window-strategies.mdx
defaultInput: Walk the floor and tell me which rack is hottest
---

# Keep the evidence, not just the task

An agent drives a screen through tools. One tool — `whats_here` — returns the
list of ids it is allowed to act on. Everything after that is actuator traffic:
pan, zoom, focus. Under `slidingWindow({ keepRecentTurns: 2 })` the `whats_here`
result survives about **two iterations**, because an assistant message plus its
tool results is ONE turn — so two kept turns are two tool rounds.

Since 9.55.0 the user's *request* is undroppable. So the model still knows
exactly what it was asked to do, and no longer has the evidence to do it.

What it does next was measured across five recorded runs: it takes an entity
name it remembers plus the shape of an id it used earlier and assembles
`aix-lab-01-single-path`, which has never existed. The tool refuses. An action
is gone. In one archived run the final answer to the *person* named a host that
appears in no tool result at all.

Run it:

```bash
npx tsx examples/context-engineering/20-keep-the-evidence.ts
```

## What you see

The same conversation twice — the pin off, then the pin on:

```text
── BEFORE — keepLastToolResults: false (9.56.0 behaviour) ──
  the ids were still in context at the end : false
  ids the model invented                   : aix-lab-01-single-path, …
  actions wasted on a refused call          : 4
  final answer                             : The hottest rack is aix-lab-01-single-path.

── AFTER — the default (2) ──
  the ids were still in context at the end : true
  ids the model invented                   : none
  actions wasted on a refused call          : 0
  final answer                             : The hottest rack is aix-lab-02-rack-a.
```

Nothing in the scripted model knows which run it is in. It reads a hold id out
of the window it was actually handed, and guesses when there is none — which is
exactly what the recorded model did.

## The one line

```ts
Agent.create({
  provider,
  model,
  keepLastToolResults: 2, // the default — `false` restores 9.56.0
}).window(slidingWindow({ keepRecentTurns: 2 }));
```

It is on `Agent.create` and not on the strategy, because the rule lives in the
shared refusal engine — so a window strategy **you** wrote inherits it without
knowing it exists, the same way it inherits the tool-pair rules.

## What it kept, and what that cost

A framework that keeps something has to be as visible as one that removes
something, so the record says both:

```text
iteration 5: removed 2 · results lost from [focus] · KEPT whats_here (turn 1, 1531 chars)
```

- `observations.pinned` — which turns were held, which tool each came from, and
  their exact character cost. Subtract them from `windowCharsAfter` and you have
  the window this run would have had without the feature.
- `droppedObservations` — the tools whose results *did* leave, filed even on a
  removal that authored no notice at all.

And when a result leaves with a notice, the model is told in words: *"Tool
results are among them (focus) — call the tool again if you need its output; do
not reconstruct ids or values from memory."*

## The bound

One pin per tool **name**, superseded the moment that tool answers again — so
the candidate space is your tool roster, not the transcript. A parallel batch is
one turn and costs one slot. A pin already inside `keepRecentTurns` costs
nothing. Nothing at or before the current request is pinnable, so a new user
turn releases the whole previous loop.

Incompressible floor: `1 request + keepLastToolResults pins + keepRecentTurns
turns`, whatever the tool count, the iteration count or the run length. And a
pin that has provably blocked two consecutive boundaries stands down — on the
record, as `observations.standDown`.

## What it gets wrong

The pin is **content-blind**: it keeps a tool's *last* result, which may be a
one-word acknowledgement while the load-bearing screen dump was the call before.
Two slots absorb the common case; nothing eliminates it. That is the honest
price of a bound that is a fact about your tool roster rather than a guess about
content — and a guess about content is what this library refuses to make
everywhere else.

Under `summarizeOldest` a pinned turn stays **raw** while everything around it
is folded, so pinned bytes are the last bytes a compaction strategy can reduce.

# agentfootprint — examples

Every example is a runnable end-to-end demo. Each one uses the
in-memory `MockProvider` so you can run them without an API key, and
each is doubled by a `.md` companion that explains *when to use it*
and *how it composes with other examples*.

## Running an example

```bash
# Run any single example end-to-end
npm run example examples/memory/01-window-strategy.ts

# Typecheck + run every example (used by CI)
npm run test:examples
```

`npm run example` is a thin wrapper around `tsx` with the right
runtime tsconfig. Substitute `npx tsx` directly only if you also set
`TSX_TSCONFIG_PATH=examples/runtime.tsconfig.json` (the root tsconfig's
`paths` block points to `.d.ts` files for tsc, which trips `tsx` at
runtime).

## DNA progression — pick examples by where you are

```
┌─────────────────────────────────────────────────────────────────────┐
│  Foundation        →  core/         (LLMCall, Agent)                 │
│  Compositions      →  core-flow/    (Sequence, Parallel, …)          │
│  Patterns          →  patterns/     (ReAct, Reflexion, ToT, …)       │
│  Context shaping   →  context-engineering/  (Skill, Steering,        │
│                                              Instruction, Fact,      │
│                                              Dynamic-ReAct, mixed)   │
│  Memory            →  memory/       (Window, Budget, Summarize,      │
│                                      TopK, Extract, Causal ⭐, Hybrid)│
│  Production        →  features/     (Pause, Cost, Permissions,       │
│                                      Observability, Events)          │
└─────────────────────────────────────────────────────────────────────┘
```

## [`core/`](core/) — primitives

| # | File | Feature |
|---|---|---|
| 01 | [core/01-llm-call.ts](core/01-llm-call.ts) | `LLMCall` — one-shot LLM primitive |
| 02 | [core/02-agent-with-tools.ts](core/02-agent-with-tools.ts) | `Agent` — ReAct loop + tool registration |

## [`core-flow/`](core-flow/) — compositions

| # | File | Feature |
|---|---|---|
| 01 | [core-flow/01-sequence.ts](core-flow/01-sequence.ts) | `Sequence` — linear pipeline + `.pipeVia()` |
| 02 | [core-flow/02-parallel.ts](core-flow/02-parallel.ts) | `Parallel` — strict / tolerant fan-out |
| 03 | [core-flow/03-conditional.ts](core-flow/03-conditional.ts) | `Conditional` — predicate routing |
| 04 | [core-flow/04-loop.ts](core-flow/04-loop.ts) | `Loop` — iteration + mandatory budget |

## [`patterns/`](patterns/) — canonical patterns

| # | File | Paper |
|---|---|---|
| 01 | [patterns/01-self-consistency.ts](patterns/01-self-consistency.ts) | Wang et al., 2022 |
| 02 | [patterns/02-reflection.ts](patterns/02-reflection.ts) | Madaan et al., 2023 |
| 03 | [patterns/03-debate.ts](patterns/03-debate.ts) | Du et al., 2023 |
| 04 | [patterns/04-map-reduce.ts](patterns/04-map-reduce.ts) | Dean & Ghemawat, 2004 |
| 05 | [patterns/05-tot.ts](patterns/05-tot.ts) | Yao et al., 2023 |
| 06 | [patterns/06-swarm.ts](patterns/06-swarm.ts) | OpenAI Swarm |

## [`context-engineering/`](context-engineering/) — InjectionEngine flavors

The single `Injection` primitive with N typed sugar factories. All
flavors flow through one engine subflow + emit `context.injected`
with `source` discriminating per flavor.

| # | File | Flavor | Trigger |
|---|---|---|---|
| 01 | [context-engineering/01-instruction.ts](context-engineering/01-instruction.ts) | Instruction | rule (predicate) |
| 02 | [context-engineering/02-skill.ts](context-engineering/02-skill.ts) | Skill | LLM-activated (`read_skill`) |
| 03 | [context-engineering/03-steering.ts](context-engineering/03-steering.ts) | Steering | always-on |
| 04 | [context-engineering/04-fact.ts](context-engineering/04-fact.ts) | Fact | always-on (data) |
| 05 | [context-engineering/05-dynamic-react.ts](context-engineering/05-dynamic-react.ts) | Instruction | on-tool-return (4-iteration morph) |
| 06 | [context-engineering/06-mixed-flavors.ts](context-engineering/06-mixed-flavors.ts) | All four | mixed |

## [`memory/`](memory/) — defineMemory + 4 types × 7 strategies

`defineMemory({ type, strategy, store })` — single factory, dispatched
onto the right pipeline. Examples organized **by strategy** (the
discipline) since strategies are universal across types.

| # | File | Strategy | Type |
|---|---|---|---|
| 01 | [memory/01-window-strategy.ts](memory/01-window-strategy.ts) | Window — last N (rule) | Episodic |
| 02 | [memory/02-budget-strategy.ts](memory/02-budget-strategy.ts) | Budget — fit-to-tokens (decider) | Episodic |
| 03 | [memory/03-summarize-strategy.ts](memory/03-summarize-strategy.ts) | Summarize — LLM compresses older turns | Episodic |
| 04 | [memory/04-topK-strategy.ts](memory/04-topK-strategy.ts) | Top-K — semantic retrieval (relevance) | Semantic |
| 05 | [memory/05-extract-strategy.ts](memory/05-extract-strategy.ts) | Extract — LLM distills facts on write | Semantic |
| 06 | [memory/06-causal-snapshot.ts](memory/06-causal-snapshot.ts) | Top-K on snapshots ⭐ — replay decisions | **Causal** |
| 07 | [memory/07-hybrid-auto.ts](memory/07-hybrid-auto.ts) | Hybrid — recent + facts + causal | All |

⭐ Causal memory is the differentiator no other library has — persists
footprintjs decision-evidence snapshots so cross-run follow-ups
("why did you reject X last week?") get EXACT past facts.

## [`features/`](features/) — runtime features

| # | File | Feature |
|---|---|---|
| 01 | [features/01-pause-resume.ts](features/01-pause-resume.ts) | Human-in-the-loop via `pauseHere()` + `.resume()` |
| 02 | [features/02-cost-tracking.ts](features/02-cost-tracking.ts) | `pricingTable` + `costBudget` → `cost.tick` / `cost.limit_hit` |
| 03 | [features/03-permissions.ts](features/03-permissions.ts) | `permissionChecker` gating tool calls |
| 04 | [features/04-observability.ts](features/04-observability.ts) | `.enable.thinking()` + `.enable.logging()` |
| 05 | [features/05-events.ts](features/05-events.ts) | Typed `.on()` listeners, wildcards, `runner.emit()` |

## The closed taxonomy

```
2 primitives        +  3 compositions     +  N patterns          (pure composition)
   LLMCall              Sequence              SelfConsistency
   Agent                Parallel              Reflection
                        Conditional/Loop      Debate · MapReduce · ToT · Swarm
─────────────────────────────────────────────────────────────────────────────────
+ Context Engineering   +  Memory             +  Production features
   Injection (1) ×        Type × Strategy        Pause · Cost · Permissions ·
   N factories            × Store                Observability · Events
   (Skill / Steering /    (Episodic /
   Instruction / Fact)    Semantic /
                          Narrative /
                          Causal ⭐)
```

Every higher layer is pure composition over the lower layers — no
hidden primitives. New agent shapes are combinations of pieces
already shown in these examples.

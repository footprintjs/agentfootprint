# agentfootprint v2 — examples

Canonical runnable examples covering every v2 feature. Folder layout
mirrors the source structure: `core/` + `core-flow/` + `patterns/` +
`features/`. Each file uses `MockProvider` or a thin inline `LLMProvider`
so no API key is required.

## Layout

```
examples/
├── core/        — 2 primitives (LLMCall, Agent)
├── core-flow/   — 4 compositions (Sequence, Parallel, Conditional, Loop)
├── patterns/    — 6 canonical research patterns
└── features/    — runtime features (pause, cost, permission, observability, events)
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

## [`features/`](features/) — runtime features

| # | File | Feature |
|---|---|---|
| 01 | [features/01-pause-resume.ts](features/01-pause-resume.ts) | Human-in-the-loop via `pauseHere()` + `.resume()` |
| 02 | [features/02-cost-tracking.ts](features/02-cost-tracking.ts) | `pricingTable` + `costBudget` → `cost.tick` / `cost.limit_hit` |
| 03 | [features/03-permissions.ts](features/03-permissions.ts) | `permissionChecker` gating tool calls |
| 04 | [features/04-observability.ts](features/04-observability.ts) | `.enable.thinking()` + `.enable.logging()` |
| 05 | [features/05-events.ts](features/05-events.ts) | Typed `.on()` listeners, wildcards, `runner.emit()` |

## The 2 + 4 + N taxonomy

```
┌─ 2 primitives ──────────────────────┐
│  LLMCall, Agent                     │
├─ 4 core-flow compositions ──────────┤
│  Sequence, Parallel, Conditional,   │
│  Loop                               │
├─ N patterns (pure composition) ─────┤
│  SelfConsistency, Reflection,       │
│  Debate, MapReduce, ToT, Swarm …    │
├─ 13 event domains (47 typed events) ┤
│  composition · agent · stream ·     │
│  context · memory · tools · skill · │
│  permission · risk · fallback ·     │
│  cost · eval · error · pause ·      │
│  embedding                          │
└─────────────────────────────────────┘
```

Every pattern is pure composition — no new primitives introduced.
The taxonomy is closed; new agent shapes are combinations of the
existing pieces.

## Running an example

```bash
# Type-check all examples (project's official check)
npm run test:examples
```

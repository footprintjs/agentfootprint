# Examples — Design & Coverage Plan

Examples serve **three audiences** simultaneously, and the structure is shaped by that:

1. **Library users learning incrementally** — open `concepts/01-llm-call.ts`, read it, copy the pattern. Walk the ladder up.
2. **The playground UI** — imports each example as a module, calls its exported `run(input, provider)` function, swaps the provider based on the user's choice in the picker.
3. **CI smoke tests** — the release script invokes each example's `run()` once via the in-repo integration spec to ensure nothing regresses before publish.

Every `.ts` file is a single module that satisfies all three.

## Folder Structure

```
examples/
├── DESIGN.md                       → this file
├── README.md                       → reader's entry point
├── tsconfig.json                   → type-check gate (gate 5b in release.sh)
├── helpers/
│   └── cli.ts                      → isCliEntry, printResult, ExampleMeta type
│
├── concepts/                       → the 7-concept ladder, one example each, in order
│   ├── 01-llm-call.ts/.md
│   ├── 02-agent.ts/.md
│   ├── 03-rag.ts/.md
│   ├── 04-flowchart.ts/.md
│   ├── 05-parallel.ts/.md
│   ├── 06-conditional.ts/.md
│   └── 07-swarm.ts/.md
│
├── patterns/                       → loop pattern + composition factories
│   ├── 01-regular-vs-dynamic.ts/.md   → AgentPattern.Regular vs Dynamic
│   ├── 02-plan-execute.ts/.md
│   ├── 03-reflexion.ts/.md
│   ├── 04-tree-of-thoughts.ts/.md
│   └── 05-map-reduce.ts/.md
│
├── providers/                      → the 3 strategy slots
│   ├── 01-prompt.ts/.md
│   ├── 02-message.ts/.md
│   └── 03-tool.ts/.md
│
├── runtime-features/               → behaviors during execution
│   ├── streaming/01-events.ts/.md
│   ├── instructions/01-basic.ts/.md
│   ├── instructions/02-llm-instructions.ts/.md
│   ├── memory/01-persistent.ts/.md
│   ├── memory/02-pipeline.ts/.md
│   ├── parallel-tools/01-parallel-tools.ts/.md
│   └── custom-route/01-custom-route.ts/.md
│
├── observability/                  → after execution — recorders + export
│   ├── 01-recorders.ts/.md         → agentObservability() bundle
│   ├── 02-explain.ts/.md           → ExplainRecorder grounding evidence
│   ├── 03-otel.ts/.md              → CostRecorder + TokenRecorder + TurnRecorder
│   └── 04-export-trace.ts/.md      → exportTrace() for portable snapshots
│
├── security/                       → tool gating + permissions
│   └── 01-gated-tools.ts/.md
│
├── resilience/                     → retry / fallback / circuit breaker
│   ├── 01-runner-wrappers.ts/.md   → withRetry, withFallback, withCircuitBreaker
│   └── 02-provider-fallback.ts/.md → fallbackProvider, resilientProvider
│
├── advanced/                       → low-level escape hatches
│   └── 01-agent-loop.ts/.md        → raw agentLoop() — what Agent/Swarm wrap
│
└── integrations/                   → multi-feature, end-to-end
    ├── 01-full-integration.ts/.md  → RAG + Agent + tools composed
    └── 02-error-handling.ts/.md    → LLMError taxonomy + classifyStatusCode
```

## Categorization rationale — lifecycle, not feature

Folders are organized by **when in the agent lifecycle a feature applies**, mirroring the footprintjs/examples/ pattern:

| Folder | Lifecycle phase |
|---|---|
| `concepts/` | What you build with — the primitives |
| `patterns/` | Composing primitives into named shapes |
| `providers/` | Customizing what the LLM sees per turn |
| `runtime-features/` | Behaviors that fire while stages execute |
| `observability/` | Inspecting what happened, after the fact |
| `security/` + `resilience/` | Production hardening — orthogonal cross-cutting concerns |
| `advanced/` | Bypass the high-level builders, work at the engine layer |
| `integrations/` | Multi-feature, real-world recipes |

This is different from a feature-bucket layout (`auth/`, `billing/`) — it's a *learning order* that mirrors how a reader's mental model assembles.

## File contract — every `.ts` file MUST

1. **Export a `run(input?, provider?)` factory** that does the actual work
2. **Export a `meta: ExampleMeta` object** describing the example for the playground catalog
3. **Have a CLI guard** at the bottom so `npx tsx examples/...` works:

```typescript
import { isCliEntry, printResult } from '../helpers/cli';

export const meta = {
  id: 'concepts/02-agent',
  title: 'Agent with tools',
  group: 'concepts',
  description: 'Agent calls a tool, gets results, produces a final answer.',
  defaultInput: 'What is 17 + 25?',
  providerSlots: ['default'],
  tags: ['Agent', 'tools', 'ReAct'],
} as const;

export async function run(input: string, provider?: LLMProvider) {
  // ... uses `provider ?? defaultMockProvider()` internally
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput).then(printResult).catch((e) => { console.error(e); process.exit(1); });
}
```

This contract is enforced by `test/examples-smoke.spec.ts` (which imports every example and verifies the shape) and by the release script's gate 5.

## Provider injection contract

The `provider` parameter is **optional**. When omitted, the example uses a hardcoded `mock([...])` with scripted responses tuned to make the flow reach a meaningful outcome.

When the playground invokes `run(input, realProvider)`, the example uses the real provider. **The flowchart structure stays identical; the exact narrative differs because the LLM is no longer scripted.**

For multi-provider examples (e.g. `planExecute` uses planner + executor), the signature is an object:

```typescript
export async function run(input: string, providers?: { planner?: LLMProvider; executor?: LLMProvider }) {...}
```

`meta.providerSlots` declares which slot keys the playground UI should expose.

## Coverage Matrix — Concept × Provider Slot

| Concept | Default provider example | Multi-provider example |
|---|---|---|
| LLMCall | `concepts/01-llm-call.ts` | — |
| Agent | `concepts/02-agent.ts` | — |
| RAG | `concepts/03-rag.ts` | `integrations/01-full-integration.ts` |
| FlowChart | `concepts/04-flowchart.ts` | `integrations/01-full-integration.ts` |
| Parallel | `concepts/05-parallel.ts` | `patterns/04-tree-of-thoughts.ts` |
| Conditional | `concepts/06-conditional.ts` | — |
| Swarm | `concepts/07-swarm.ts` | — |

| Pattern | File |
|---|---|
| Regular vs Dynamic ReAct loop | `patterns/01-regular-vs-dynamic.ts` |
| planExecute | `patterns/02-plan-execute.ts` (planner + executor slots) |
| reflexion | `patterns/03-reflexion.ts` (solver + critic + improver slots) |
| treeOfThoughts | `patterns/04-tree-of-thoughts.ts` (thinker + judge slots) |
| mapReduce | `patterns/05-map-reduce.ts` (mapper + reducer slots) |

## CI Integration

```
release.sh gates that touch examples:
  Gate 2:  Documentation check                      → no stale API refs in .md
  Gate 3:  Build (tsc -p tsconfig.json)              → strict type check
  Gate 4:  Unit + integration tests                  → includes test/examples-smoke.spec.ts
                                                       which imports + invokes every example
  Gate 5b: tsc -p examples/tsconfig.json             → standalone example type-check
```

The previous gate 5 dependency on `agent-samples/npm run all` is replaced by the in-repo smoke spec — examples are now self-contained.

## Adding a new example

1. Pick the right folder by lifecycle phase (NOT by feature bucket).
2. Use the next sequential number within that folder.
3. Copy the file contract template above. Fill in `meta` honestly — the playground catalog reads it.
4. Add a paired `.md` with the four sections: **What it shows**, **When to use**, **What you'll see in the trace**, **Key API**.
5. The smoke spec auto-discovers your file via folder glob — no manual registration needed.

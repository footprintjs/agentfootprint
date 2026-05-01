# Dynamic ReAct vs Classic ReAct — side by side

Same task. Same scripted answers. Same mock LLM. The only difference
is whether tools live behind skills.

## Run both

```sh
TSX_TSCONFIG_PATH=examples/runtime.tsconfig.json npx tsx examples/dynamic-react/01-classic-react.ts
TSX_TSCONFIG_PATH=examples/runtime.tsconfig.json npx tsx examples/dynamic-react/02-dynamic-react.ts
```

Both answer the same SRE question — *"why is /api/checkout slow?"* —
and arrive at the same final answer: the p99 jumped from 320ms to
4200ms because of a slow postgres seq scan on `orders.user_id`.
What differs is the cost of getting there.

## Numbers from a real run

| Metric                              | Classic ReAct | Dynamic ReAct | Δ       |
| ----------------------------------- | ------------: | ------------: | ------: |
| Iterations                          |             4 |             5 | +1      |
| **Total tool descriptions shipped** |        **48** |        **21** | **−56%** |
| Input tokens (estimated)            |          2750 |          2457 | −11%    |
| Output tokens                       |            86 |            92 | +7%     |

The headline metric is **tool descriptions shipped**. Classic ReAct
sends every registered tool's full description on every LLM call —
4 iterations × 12 tools = 48 descriptions, even though the LLM only
actually uses 3 of them. Dynamic ReAct ships 2 tools while the LLM
discovers the right skill, then 5 once the skill is active, totalling
21 across the run.

The 11% input-token win on this small example is the floor, not the
ceiling. Skill body and one extra iteration eat some of the gain. As
the skill catalog grows, the gap widens dramatically.

## Per-iteration shape

```
Classic ReAct                    Dynamic ReAct
───────────────                  ─────────────
iter 1: 12 tools shown           iter 1: 1 tool  (read_skill)
iter 2: 12 tools shown           iter 2: 5 tools (skill activated)
iter 3: 12 tools shown           iter 3: 5 tools
iter 4: 12 tools shown           iter 4: 5 tools
                                 iter 5: 5 tools (final answer)
```

Notice what's missing on the right: **the other two skills' tools
never enter the LLM context.** `error-investigation` and
`capacity-planning` (8 tools combined) were registered but stayed
invisible to the LLM because they weren't activated. Classic ReAct
has no equivalent — every registered tool ships every iteration.

## Why this matters at scale

A real production agent with **10 skills × ~4 tools each = 40+ tools**
running the same 5-iteration investigation:

```
Classic ReAct:    5 iters × 40 tools                 = 200 descriptions
Dynamic ReAct:    1 iter  × 1 tool  (read_skill)
                + 4 iters × 5 tools (1 skill active) =  21 descriptions
                                                        ────────────
                                                        −90% reduction
```

That's the load-bearing claim. For agents with deep skill catalogs,
Dynamic ReAct + `autoActivate: 'currentSkill'` cuts tool-description
overhead by an order of magnitude — and the savings compound with
iteration count.

## Why this also reduces hallucination

The cost story is one half. The other half: **fewer tools to choose
from per call = LLM less likely to call the wrong tool.** With 40
tools visible, even strong models occasionally pick a tangentially-
named one or hallucinate an argument shape. With 5 tools
visible (only those relevant to the active skill), the choice
collapses to the right answer.

This isn't a token-cost optimization wearing a behavioural hat — it's
a separate, additive win. The narrower context is also more in-
distribution for the model on the active task.

## How it works (mechanism)

Three pieces in agentfootprint v2.5+ make Dynamic ReAct work:

1. **`defineSkill({ ..., tools: [...] })`** — bundles tools with the
   skill that owns them. Tools register with the agent but stay
   invisible to the LLM by default.

2. **`autoActivate: 'currentSkill'`** — flags a skill's tools as
   activation-gated. Only the most-recently-activated skill's tools
   appear in the LLM's tool list per iteration.

3. **`read_skill(id)`** — auto-attached tool that activates a skill.
   The next iteration's `Tools` slot subflow re-composes with the
   newly-active skill's tools added to `dynamicToolSchemas`.

The Tools slot subflow runs **every iteration**, so skill switches
take effect immediately — no agent restart, no graph re-build. This
is the agentfootprint thesis: *owning the loop means recomposing
prompt + tool list every iteration.*

## Files in this directory

- `01-classic-react.ts` — 12 tools registered with `.tool()` directly
- `02-dynamic-react.ts` — same 12 tools behind 3 `defineSkill()` blocks
- `README.md` — this file

Both are mock-backed (no API key required), runnable as part of the
release-gate test suite. The numbers above come from an actual run
of these files.

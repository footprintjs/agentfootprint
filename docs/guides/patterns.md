# Patterns — named compositions of primitives

Every named pattern in the agent literature is a **composition of the 2 primitives + 3 compositions** from the [concepts taxonomy](concepts.md). Not a new Agent class. Not a new runtime. A recipe.

```
PRIMITIVES: LLM, Agent
COMPOSITIONS: Sequence, Parallel, Conditional
```

Each page below opens with a **"Built from"** line showing the recipe, plus a paper citation. Patterns ship either as a loop-shape flag on `Agent` or as a thin factory over existing concepts — same narrative, same recorders as hand-wired flows.

Two categories:

- **Loop patterns** — `AgentPattern.Regular` vs `AgentPattern.Dynamic`. Controls when the three API slots (SystemPrompt, Messages, Tools) re-evaluate inside the ReAct loop.
- **Composition patterns** — `planExecute`, `reflexion`, `treeOfThoughts`, `mapReduce`. Factories from `agentfootprint/patterns` that wire primitives + compositions into a named shape.

Import:

```typescript
import { Agent, AgentPattern } from 'agentfootprint';
import { planExecute, reflexion, treeOfThoughts, mapReduce } from 'agentfootprint/patterns';
```

> **`RunnerLike`** — anything with a `.run(input)` method that returns a result. Every concept (`LLMCall`, `Agent`, `RAG`, `FlowChart`, `Parallel`, `Conditional`, `Swarm`) and every pattern factory returns one, so they all plug into each other.

---

## Loop patterns — `AgentPattern`

**Built from:** Agent (the ReAct primitive). Loop flag changes where the loop target lands; the shape stays the same.

**Paper:** ReAct (Yao et al. 2022, ICLR — "Reasoning and Acting").

Every `Agent` runs a ReAct loop: some `SystemPrompt / Messages / Tools` preamble, then `CallLLM → Parse → Route → ExecuteTools`, loop. The pattern flag controls **where the loop jumps back to**, which determines which stages re-run each iteration.

| Pattern | Loop target | Re-evaluates each turn |
|---|---|---|
| `AgentPattern.Regular` (default) | `CallLLM` | Only the loop body |
| `AgentPattern.Dynamic` | `SystemPrompt` | All three slots + loop body |

### ReAct — Regular (default)

**Built from:** Agent (default).
**Paper:** ReAct, Yao et al. 2022.


```
[SystemPrompt] → [Messages] → [Tools] → AssemblePrompt
  → CallLLM → Parse → Route → ExecuteTools → loopTo(CallLLM)
        ↑                                         |
        └─────────────────────────────────────────┘
```

Slots resolve **once** before the loop starts. Subsequent iterations reuse the same system prompt, message strategy output, and tool list — only adding the new tool results to the conversation.

Best for: most agents with a fixed persona, fixed tool set, and standard history.

```typescript
const agent = Agent.create({ provider })
  .system('You are a research assistant.')
  .tool(searchTool)
  .build();  // AgentPattern.Regular is the default
```

### Dynamic ReAct

**Built from:** Agent with slots re-evaluating per iteration.
**Paper:** — (agentfootprint extension; closest literature is adaptive prompting / per-step context assembly).

```
[SystemPrompt] → [Messages] → [Tools] → AssemblePrompt
  → CallLLM → Parse → Route → ExecuteTools → loopTo(SystemPrompt)
 ↑                                                   |
 └───────────────────────────────────────────────────┘
```

All three slot subflows re-run each turn. Strategies see the updated `messages` array (now includes tool results) and `loopCount`, so they can return a different prompt, a different message window, or a different tool set based on what just happened.

Best for:

- **Progressive authorization** — unlock admin tools after `verify_identity` succeeds
- **Adaptive prompts** — tighten the system prompt if the LLM starts looping
- **Context-dependent tooling** — swap search tools in once a document class is known
- **Skill-gated agents** — `.skills(registry)` auto-promotes to `Dynamic` when the registry has auto-activating skills

```typescript
const agent = Agent.create({ provider })
  .pattern(AgentPattern.Dynamic)
  .promptProvider(myDynamicPrompt)     // sees updated messages each turn
  .toolProvider(myDynamicTools)         // can add/remove tools each turn
  .build();
```

> **Auto-promotion:** Calling `.skills(registry)` where the registry has auto-activate rules will flip the pattern to `Dynamic` on your behalf — you can override by calling `.pattern(AgentPattern.Regular)` **after** `.skills()`.

### Cost vs. adaptability trade-off

Dynamic re-runs the prompt/messages/tools subflows every turn. If those subflows are pure functions over in-memory state the cost is trivial. If any of them touch a retriever, a remote store, or an LLM call (e.g. `summaryStrategy()`), the multiplier is real — budget accordingly, or stay on `Regular` and update state via tools.

---

## Composition patterns — `agentfootprint/patterns`

All four are **thin factories** that express a named paper as a composition of primitives. Reading the source ([src/patterns/](../../src/patterns/)) is the fastest way to learn how to build your own.

| Pattern | Built from | Paper | Returns | Source |
|---|---|---|---|---|
| `planExecute` | LLM-plan + Sequence(Agent per step) | Wang et al. 2023 (Plan-and-Solve) | `FlowChartRunner` | [planExecute.ts](../../src/patterns/planExecute.ts) |
| `reflexion` | Sequence(Agent, LLM-critique, Agent) | Shinn et al. 2023 (Reflexion / Self-Refine) | `FlowChartRunner` | [reflexion.ts](../../src/patterns/reflexion.ts) |
| `treeOfThoughts` | Parallel(Agent × N) + LLM-rank | Yao et al. 2023 (Tree of Thoughts) | `FlowChartRunner` | [treeOfThoughts.ts](../../src/patterns/treeOfThoughts.ts) |
| `mapReduce` | Parallel(Agent × N) + LLM-merge | Dean & Ghemawat 2004 | `ParallelRunner` | [mapReduce.ts](../../src/patterns/mapReduce.ts) |

> **Hierarchy (Swarm)** — also a pattern (Agent with specialist-Agents as tools). It ships under `Swarm.create(...)` as a first-class builder rather than as a `patterns/` factory, because the shape is opinionated enough to deserve its own surface. The recipe is still "Agent whose tools happen to be Agents" — see [Concepts → Hierarchy (Swarm)](concepts.md#hierarchy-swarm--worked-example). Paper: OpenAI Swarm (2024).

Each returns a runner, so patterns **compose with each other** — drop a `reflexion` runner into a `FlowChart`, a `mapReduce` into an `Agent.route()` branch, or wrap anything in `Conditional` for a loop-until-good-enough variant.

### Picking a quality pattern

`reflexion` and `treeOfThoughts` both trade tokens for answer quality, but they target different failure modes:

| Problem | Pick |
|---|---|
| The LLM's first answer is usually in the right **direction** but has errors you can describe | `reflexion` — critic finds the errors, improver fixes them |
| The LLM's first answer is often in the **wrong direction** entirely (multiple reasonable paths exist) | `treeOfThoughts` — generate alternatives, judge picks best |
| Work is **parallelizable across independent inputs** (N documents, N rubrics) | `mapReduce` |
| Work benefits from **upfront structure** before tool use | `planExecute` |

Rule of thumb: reflexion helps on single-path reasoning; ToT helps when the first path is the problem.

---

### `planExecute` — Planner → Executor

> **Like:** writing the outline before writing the essay.

**Built from:** LLM (planner) + Sequence → Agent (executor).
**Paper:** *Plan-and-Solve Prompting* (Wang et al. 2023, ACL).

Two runners chained sequentially. The planner takes the request and produces a plan; the executor carries that plan out.

**Why:** separating planning from execution is often cheaper (small model plans, capable model executes) and safer (plan shows up in the narrative before any tool fires, so reviewers can gate execution).

**Background:** related to *Plan-and-Solve Prompting* (Wang et al. 2023, ACL), *ReWOO* (Xu et al. 2023), and the planner/executor split in HuggingGPT (Shen et al. 2023). The shipped factory is the simplest two-stage form — no plan validation, no replanning on failure.

```typescript
import { Agent, anthropic, createProvider } from 'agentfootprint';
import { planExecute } from 'agentfootprint/patterns';

const planner = Agent.create({ provider: createProvider(anthropic('claude-haiku-4-5')) })
  .system('Produce a numbered plan. Do not execute.')
  .build();

const executor = Agent.create({ provider: createProvider(anthropic('claude-sonnet-4')) })
  .system('Execute the given plan step by step.')
  .tools([searchTool, writeFileTool])
  .build();

const runner = planExecute({ planner, executor });
const result = await runner.run('Research competitors and draft a brief.');
```

**Options:**

| Field | Type | Default | Meaning |
|---|---|---|---|
| `planner` | `RunnerLike` | *(required)* | Produces the plan |
| `executor` | `RunnerLike` | *(required)* | Executes the plan |
| `planName` | `string` | `'Plan'` | Narrative stage name |
| `executeName` | `string` | `'Execute'` | Narrative stage name |

Under the hood: `FlowChart.create().agent('plan', ...).agent('execute', ...).build()`. The executor receives the planner's output as its input message.

**Observability:** the plan appears in the narrative as the `Plan` stage's output before any executor tool fires — visible in `getNarrative()`, `obs.explain().iterations[0]`, and the commit log. Use this to gate execution in review tooling.

**Failure modes:** planner produces an unparseable / vague plan → executor wastes tokens. The factory does no plan validation; if you need it, wrap the planner output check in a `Conditional` between the two stages.

---

### `reflexion` — Solve → Critique → Improve

> **Like:** writing a first draft, then handing it to an editor.

**Built from:** Sequence(Agent, LLM-critique, Agent).
**Paper:** *Reflexion* (Shinn et al. 2023, NeurIPS); closely related to *Self-Refine* (Madaan et al. 2023).

Three-stage self-review pass. A solver drafts an answer, a critic lists weaknesses, an improver integrates the critique.

**Why:** a single self-review pass catches a surprising number of reasoning / code / plan errors — the "second look" effect. Cheap models for critic and improver while keeping a strong solver is often a win.

**Background:** the name comes from *Reflexion* (Shinn et al. 2023, NeurIPS). **Honesty box:** the shipped factory is one critique pass, which is closer to *Self-Refine* (Madaan et al. 2023) than to full Reflexion. Real Reflexion has long-term reflection memory across multiple attempts and a quality-gated loop. To approximate the loop, wrap with `Conditional` (shown below); to approximate the memory, persist critique transcripts via a `MessageStrategy`.

```typescript
import { Agent, createProvider, anthropic } from 'agentfootprint';
import { reflexion } from 'agentfootprint/patterns';

const provider = createProvider(anthropic('claude-sonnet-4'));

const reviewer = reflexion({
  solver:   Agent.create({ provider }).system('Draft an answer.').build(),
  critic:   Agent.create({ provider }).system('List weaknesses in the draft.').build(),
  improver: Agent.create({ provider }).system('Apply the critique to improve the draft.').build(),
});

const result = await reviewer.run('Explain monads in plain English.');
```

**Options:**

| Field | Type | Default |
|---|---|---|
| `solver` / `critic` / `improver` | `RunnerLike` | *(required)* |
| `solveName` / `critiqueName` / `improveName` | `string` | `'Solve'` / `'Critique'` / `'Improve'` |

**Multi-iteration Reflexion** — this factory is single-pass. For a loop-until-quality-gate variant, wrap with `Conditional`:

```typescript
import { Conditional } from 'agentfootprint';

const iterative = Conditional.create()
  .when((_, state) => qualityOf(state) < 0.8, reviewer)
  .otherwise(doneRunner)
  .build();
```

Under the hood: `FlowChart.create().agent('solve', ...).agent('critique', ...).agent('improve', ...).build()`.

**Observability:** critic output surfaces as its own stage in the narrative and as a separate iteration entry in `obs.explain()`. This is how you *measure* whether the critique helped — compare improver vs solver output across runs.

**Failure modes:** lenient critic returns "looks good" → reflexion adds 2× latency for zero quality gain. Before shipping, A/B measure improver-quality-with-critic vs solver-alone on a labeled set; if the critic isn't moving the needle, drop the pattern.

---

### `treeOfThoughts` — N parallel thinkers → judge

> **Like:** a brainstorm — three people propose, one picks the best.

**Built from:** Parallel(Agent × N) + LLM-rank (judge).
**Paper:** *Tree of Thoughts: Deliberate Problem Solving with Large Language Models* (Yao et al. 2023, NeurIPS); closely related to *Self-Consistency* (Wang et al. 2022).

Fan out N parallel attempts, concatenate them as labeled candidates, hand to a judge runner that picks or synthesizes the best.

**Why:** for problems where one-shot answers are often wrong, generating multiple independent attempts catches errors a single chain-of-thought misses. The merge step is a **pure function** (labeled concat), so the only LLM in the pattern beyond the thinkers is the judge — budget accordingly.

**Background:** named after *Tree of Thoughts: Deliberate Problem Solving with Large Language Models* (Yao et al. 2023, NeurIPS). **Honesty box:** the shipped factory is N-parallel-then-judge, which is closer to *Self-Consistency* (Wang et al. 2022) than to full ToT. Real ToT does **tree search** over thought states (BFS/DFS with value estimation and backtracking). To approximate ToT properly, compose `treeOfThoughts` inside a `Conditional` loop that prunes and re-expands.

```typescript
import { Agent, LLMCall, createProvider, anthropic } from 'agentfootprint';
import { treeOfThoughts } from 'agentfootprint/patterns';

const provider = createProvider(anthropic('claude-sonnet-4'));

const tot = treeOfThoughts({
  provider,
  branches: 3,
  thinker: (i) =>
    LLMCall.create({ provider })
      .system(`Thinker ${i + 1}: propose a different solution.`)
      .build(),
  judge: Agent.create({ provider })
    .system('Pick the single best answer and explain why.')
    .build(),
});

const result = await tot.run('What is the fastest sort for nearly-sorted data?');
```

**Options:**

| Field | Type | Default | Meaning |
|---|---|---|---|
| `provider` | `LLMProvider` | *(required)* | Used by the Parallel wrapper |
| `branches` | `number` | *(required)* | 2–10 thinkers (Parallel's cap) |
| `thinker` | `(i) => RunnerLike` | *(required)* | Factory called once per branch at build time |
| `judge` | `RunnerLike` | *(required)* | Receives all thinker outputs labeled by id |
| `name` | `string` | `'treeOfThoughts'` | Narrative name |

Throws if `branches < 2` — use a single runner directly when you don't need candidates. Caps at 10 (the underlying `Parallel` concept's safety cap on concurrent fan-out, intended to prevent accidental fan-out storms; raise via raw footprintjs if you need more).

Under the hood: `FlowChart[ Parallel(thinker-0..N-1, merge=labeledConcat), judge ]`. The judge receives a string shaped like:

```
=== thinker-0 ===
<output 0>

=== thinker-1 ===
<output 1>
...
```

**Observability:** each thinker is a separate branch in the narrative; the judge's reasoning shows up as the final stage. `obs.explain()` lists each candidate as a discrete source so you can audit which one the judge picked and why.

**Failure modes:** weak judge → ToT amplifies confident hallucinations (multiple thinkers may agree on the same wrong answer; judge rubber-stamps). Cost scales linearly with `branches` — at `branches: 5` you pay 6× the tokens of a single LLMCall. Measure quality lift vs single-shot before shipping.

---

### `mapReduce` — Fan-out mappers → reduce

> **Like:** assigning each book in a stack to a different reader, then having them write a joint summary.

**Built from:** Parallel(Agent × N) + LLM-merge (or pure-function reducer).
**Paper:** Map-Reduce (Dean & Ghemawat 2004); LLM-flavored variants appear in summarization-tree literature.

N pre-bound mappers (each runner already has its slice of work baked in) run in parallel, then a reducer combines the results. Reducer is either LLM-synthesized or a custom function.

**Why:** map-reduce is a common shape — summarize N documents, compare N candidates, evaluate a prompt against N rubrics. The **pre-bind** style (each mapper already knows its slice) keeps the factory shape simple and avoids a separate "splitter" stage for the common case.

**Background:** the map-reduce shape predates LLMs (Dean & Ghemawat 2004). LLM-flavored variants appear in summarization-tree literature (e.g. LangChain's `map_reduce` chain, refine chains). **Honesty box:** this factory is the simple flat form — no hierarchical reduce, no recursive splitting. For very large N (hundreds of mappers) build a tree of `mapReduce` calls.

```typescript
import { LLMCall, createProvider, anthropic } from 'agentfootprint';
import { mapReduce } from 'agentfootprint/patterns';

const documents = [doc1, doc2, doc3];
const provider = createProvider(anthropic('claude-sonnet-4'));

const pipeline = mapReduce({
  provider,
  mappers: documents.map((doc, i) => ({
    id: `doc-${i}`,
    description: `Summarize doc ${i}`,
    runner: LLMCall.create({ provider })
      .system(`Summarize this document:\n\n${doc}`)
      .build(),
  })),
  reduce: { mode: 'llm', prompt: 'Combine the summaries into a single report.' },
});

const result = await pipeline.run('Produce the report');
```

**Options:**

| Field | Type | Default | Meaning |
|---|---|---|---|
| `provider` | `LLMProvider` | *(required)* | Used when `reduce.mode === 'llm'` |
| `mappers` | `MapReduceMapper[]` | *(required)* | ≥ 2 pre-bound runners |
| `reduce` | `MapReduceReduceConfig` | *(required)* | `{ mode: 'llm', prompt }` or `{ mode: 'fn', fn }` |
| `name` | `string` | `'mapReduce'` | Narrative name |

`MapReduceMapper = { id, description, runner }`. Throws if `mappers.length < 2` — use a single runner directly for one-mapper flows.

Under the hood: `Parallel.create(...).agent(id, runner, desc).mergeWithLLM(prompt) | .merge(fn) .build()`.

**Observability:** each mapper appears as a labeled branch in the narrative and as a discrete source in `obs.explain()`. You can trace every claim in the final report back to which mapper produced it.

**Failure modes:** one mapper throws → the whole `Parallel` subflow fails (current behavior — no partial-success mode). If your mappers hit external services, wrap each with `withRetry(...)` before passing it in. Reduce-step hallucination risk: the LLM reducer may drop or invent content — when the source-of-truth mappings matter, prefer `reduce.mode === 'fn'` with a deterministic combiner.

---

## Composing patterns with primitives and compositions

Every pattern returns a runner, so they plug into every composition (Sequence / Parallel / Conditional) and into any Agent slot:

```typescript
// Pattern inside FlowChart:
FlowChart.create()
  .agent('research', 'Research', mapReduce({ ...researchMappers }))
  .agent('write',    'Write',    reflexion({ solver, critic, improver }))
  .build();

// Pattern inside Conditional:
Conditional.create()
  .when(isComplex, treeOfThoughts({ provider, branches: 5, thinker, judge }))
  .otherwise(simpleRunner)
  .build();

// Pattern inside Agent.route() as an escape branch:
Agent.create({ provider })
  .tool(lookupTool)
  .route({
    branches: [{ id: 'deliberate', when: needsDeliberation, runner: treeOfThoughts({ ... }) }],
  })
  .build();
```

---

## Beyond the shipped patterns

The four factories cover the most common shapes (sequence, fan-out, self-review, planner-executor split). When you need something outside that set, remember: **every named pattern is a composition of 2 primitives + 3 compositions.** Don't invent new Agent classes — compose primitives.

1. **Start with the primitives + compositions** — Agent + Sequence / Parallel / Conditional already express most graph shapes.
2. **Use `Agent.route({ branches })`** — user-defined routing branches (prepended to the default decider) cover most dynamic-control cases without leaving the Agent abstraction.
3. **Drop to footprintjs** — the builder (`flowChart()`, `addFunction`, `addDeciderFunction`, `addSubFlowChart`, `loopTo`) is the same library agentfootprint is built on. No escape, no re-learning.

If you build a shape worth reusing, the source of the four patterns in [src/patterns/](../../src/patterns/) is ~25–95 lines each — copy one and modify.

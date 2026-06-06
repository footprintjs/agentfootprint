# Patterns — named compositions of primitives

Every named pattern in the agent literature is a **composition of the 2 primitives + 3 compositions** from the [concepts taxonomy](concepts.md). Not a new Agent class. Not a new runtime. A recipe.

```
PRIMITIVES: LLM, Agent
COMPOSITIONS: Sequence, Parallel, Conditional
```

Each page below opens with a **"Built from"** line showing the recipe, plus a paper citation. Patterns ship either as a loop-mode flag on `Agent` or as a thin factory over existing concepts — same narrative, same recorders as hand-wired flows.

Two categories:

- **Loop patterns** — `reactMode: 'classic'` vs `reactMode: 'dynamic'`. Controls when the three API slots (SystemPrompt, Messages, Tools) re-evaluate inside the ReAct loop.
- **Composition patterns** — `selfConsistency`, `reflection`, `debate`, `mapReduce`, `tot`, `swarm`. Factories from `agentfootprint/patterns` that wire primitives + compositions into a named shape.

Import:

```typescript
import { Agent } from 'agentfootprint';
import { selfConsistency, reflection, debate, mapReduce, tot, swarm } from 'agentfootprint/patterns';
```

> **`Runner`** — the shared interface every primitive (`LLMCall`, `Agent`), every composition (`Sequence`, `Parallel`, `Conditional`), and every pattern factory returns. Each exposes `.run(input)`, `.getSpec()`, `.on()/.off()`, `.attach()`, and `.enable`. Because they all share it, they plug into each other.

---

## Loop patterns — `reactMode`

**Built from:** Agent (the ReAct primitive). The loop-mode flag changes where the loop target lands; the shape stays the same.

**Paper:** ReAct (Yao et al. 2022, ICLR — "Reasoning and Acting").

Every `Agent` runs a ReAct loop: some `SystemPrompt / Messages / Tools` preamble, then `CallLLM → Parse → Route → ExecuteTools`, loop. The `reactMode` flag controls **where the loop jumps back to**, which determines which slots re-run each iteration. Set it on `Agent.create({ ... })`:

| `reactMode` | Loop target | Re-evaluates each turn |
|---|---|---|
| `'dynamic'` (default) | InjectionEngine (all three slots) | All three slots + loop body |
| `'classic'` | Messages only | Messages slot + loop body (context engineered once) |

### Dynamic ReAct (default)

**Built from:** Agent (default).
**Paper:** ReAct, Yao et al. 2022.

```
[SystemPrompt] → [Messages] → [Tools] → AssemblePrompt
  → CallLLM → Parse → Route → ExecuteTools → loopTo(InjectionEngine)
 ↑                                                   |
 └───────────────────────────────────────────────────┘
```

All three slot subflows re-run each turn. Strategies see the updated `messages` array (now includes tool results) and the iteration count, so they can return a different prompt, a different message window, or a different tool set based on what just happened.

Best for:

- **Progressive authorization** — unlock admin tools after `verify_identity` succeeds
- **Adaptive prompts** — tighten the system prompt if the LLM starts looping
- **Context-dependent tooling** — swap search tools in once a document class is known
- **Skill-gated agents** — `.skills(registry)` with auto-activating skills, since activation is re-evaluated each turn

```typescript
const agent = Agent.create({ provider, model })   // reactMode defaults to 'dynamic'
  .system('You are a research assistant.')
  .toolProvider(myDynamicTools)   // can add/remove tools each turn
  .build();
```

### Classic ReAct

**Built from:** Agent with context engineered once, looping only Messages.
**Paper:** ReAct, Yao et al. 2022 (the original fixed-preamble form).

```
[SystemPrompt] → [Messages] → [Tools] → AssemblePrompt
  → CallLLM → Parse → Route → ExecuteTools → loopTo(Messages)
                ↑                                 |
                └─────────────────────────────────┘
```

Context is engineered **once** before the loop starts. Subsequent iterations reuse the same system prompt and tool list — only the Messages slot re-runs to add the new tool results to the conversation.

Best for: most agents with a fixed persona, fixed tool set, and standard history.

```typescript
const agent = Agent.create({ provider, model, reactMode: 'classic' })
  .system('You are a research assistant.')
  .tool(searchTool)
  .build();
```

> **Skills footgun:** `'classic'` caches the system-prompt and tools slots after the first turn, so a skill or dynamic injection that activates **mid-run** won't surface into the cached slots. If you rely on mid-run activation, stay on the default `'dynamic'` mode.

### Cost vs. adaptability trade-off

Dynamic re-runs the prompt/messages/tools subflows every turn. If those subflows are pure functions over in-memory state the cost is trivial. If any of them touch a retriever, a remote store, or an LLM call, the multiplier is real — budget accordingly, or stay on `'classic'` and update state via tools.

---

## Composition patterns — `agentfootprint/patterns`

All six are **thin factories** that express a named paper as a composition of primitives. Reading the source ([src/patterns/](../../src/patterns/)) is the fastest way to learn how to build your own.

| Pattern | Built from | Paper | Returns | Source |
|---|---|---|---|---|
| `reflection` | Loop(Sequence(propose, critique)) | Madaan et al. 2023 (Self-Refine) | `Runner` | [Reflection.ts](../../src/patterns/Reflection.ts) |
| `tot` | Loop(Parallel(LLM × K) + prune) | Yao et al. 2023 (Tree of Thoughts) | `Runner` | [ToT.ts](../../src/patterns/ToT.ts) |
| `selfConsistency` | Parallel(LLM × N) + majority vote | Wang et al. 2022 (Self-Consistency) | `Runner` | [SelfConsistency.ts](../../src/patterns/SelfConsistency.ts) |
| `debate` | Sequence(proposer, critic, judge) | Du et al. 2023 (Multiagent Debate) | `Runner` | [Debate.ts](../../src/patterns/Debate.ts) |
| `mapReduce` | Sequence(split, Parallel(LLM × N) + reduce) | Dean & Ghemawat 2004 | `Runner` | [MapReduce.ts](../../src/patterns/MapReduce.ts) |
| `swarm` | Loop(Conditional(route-to-agent)) | OpenAI Swarm 2024 | `Runner` | [Swarm.ts](../../src/patterns/Swarm.ts) |

> **Hierarchy (Swarm)** — also a pattern (an LLM-driven routing decision picks which agent handles the next turn). It ships as the `swarm(...)` factory like the others; the recipe is `Loop(Conditional(route-to-agent))`. See [Concepts → Swarm (hand-off)](concepts.md#swarm-hand-off--worked-example). Paper: OpenAI Swarm (2024).

Each returns a `Runner`, so patterns **compose with each other** — drop a `reflection` runner into a `Sequence`, a `mapReduce` into a `Conditional` branch, or wrap anything in `Conditional` for a route-by-quality variant.

### Picking a quality pattern

`reflection` and `tot` both trade tokens for answer quality, but they target different failure modes:

| Problem | Pick |
|---|---|
| The LLM's first answer is usually in the right **direction** but has errors you can describe | `reflection` — critic finds the errors, the next iteration fixes them |
| The LLM's first answer is often in the **wrong direction** entirely (multiple reasonable paths exist) | `tot` — generate alternatives, score and prune to the best |
| You want the most **self-consistent** answer across independent samples | `selfConsistency` — sample N, take the majority vote |
| Work is **parallelizable across independent inputs** (N documents, N shards) | `mapReduce` |
| You want two personas to **argue**, then a judge to rule | `debate` |

Rule of thumb: `reflection` helps on single-path reasoning; `tot` helps when the first path is the problem.

---

### `reflection` — Propose → Critique → repeat

> **Like:** writing a first draft, then handing it to an editor — over and over until it's good.

**Built from:** Loop(Sequence(propose, critique)).
**Paper:** *Self-Refine: Iterative Refinement with Self-Feedback* (Madaan et al. 2023); the name comes from *Reflexion* (Shinn et al. 2023, NeurIPS).

Iterative self-refinement. Each iteration proposes a candidate, then a critic critiques it; the loop continues until the critic emits a stop marker (or `maxIterations` is hit).

**Why:** a self-review pass catches a surprising number of reasoning / code / plan errors — the "second look" effect. A cheap model for the critic while keeping a strong proposer is often a win.

**Background:** **Honesty box:** the shipped factory is propose-then-critique looped to a stop marker, closer to *Self-Refine* (Madaan et al. 2023) than to full Reflexion. Real Reflexion has long-term reflection memory across multiple attempts. To approximate the memory, persist critique transcripts via a memory definition.

```typescript
import { mock } from 'agentfootprint';
import { reflection } from 'agentfootprint/patterns';

const provider = mock();   // swap for a real provider from 'agentfootprint/llm-providers'

const reviewer = reflection({
  provider,
  model: 'claude-sonnet-4',
  proposerPrompt: 'Draft (or revise) an answer.',
  criticPrompt: 'List weaknesses. When the answer is good enough, include the marker "DONE".',
  untilCritiqueContains: 'DONE',   // optional; defaults to 'DONE'
  maxIterations: 3,
});

const result = await reviewer.run({ message: 'Explain monads in plain English.' });
```

**Options:**

| Field | Type | Default | Meaning |
|---|---|---|---|
| `provider` | `LLMProvider` | *(required)* | Provider for both proposer and critic |
| `model` | `string` | *(required)* | Model id |
| `proposerPrompt` | `string` | *(required)* | System prompt for the proposer / reviser |
| `criticPrompt` | `string` | *(required)* | System prompt for the critic |
| `untilCritiqueContains` | `string` | `'DONE'` | Stop marker the critic emits when satisfied |
| `maxIterations` | `number` | `3` | Max refinement iterations |
| `temperature` / `maxTokens` | `number` | — | Forwarded to every LLMCall |
| `name` / `id` | `string` | `'Reflection'` / `'reflection'` | Topology + narrative labels |

Under the hood: `Loop.repeat(Sequence(propose → critique)).times(maxIterations).until(critic-output contains marker)`.

**Observability:** critic output surfaces as its own stage in the narrative, and each iteration emits `composition.iteration_start` / `iteration_exit`. This is how you *measure* whether the critique helped — compare proposals across iterations.

**Failure modes:** lenient critic never withholds the stop marker → reflection runs full `maxIterations` for zero quality gain. Before shipping, measure proposal-quality-with-critic vs proposer-alone on a labeled set; if the critic isn't moving the needle, drop the pattern.

---

### `tot` — Breadth-first thoughts → score → prune

> **Like:** a brainstorm — generate several ideas each round, keep the best, expand again.

**Built from:** Loop(Parallel(LLM × K) + score-and-prune).
**Paper:** *Tree of Thoughts: Deliberate Problem Solving with Large Language Models* (Yao et al. 2023, NeurIPS).

Each level fans out `branchingFactor` parallel thoughts, scores them with a consumer-supplied scorer, keeps the top `beamWidth`, then expands again for `depth` levels.

**Why:** for problems where one-shot answers are often wrong, generating multiple independent thoughts each level catches errors a single chain-of-thought misses. The scoring step is a **pure function**, so the only LLM in the pattern is the thought generator — budget accordingly.

**Background:** **Honesty box:** the shipped factory is BFS with constant width (beam search), not full DFS with backtracking or adaptive branching. True DFS would need a runtime-variable Parallel. The scorer is synchronous so pruning is deterministic.

```typescript
import { mock } from 'agentfootprint';
import { tot } from 'agentfootprint/patterns';

const provider = mock();   // swap for a real provider from 'agentfootprint/llm-providers'

const thinker = tot({
  provider,
  model: 'claude-sonnet-4',
  thoughtPrompt: 'Propose one solution step. Be concrete.',
  depth: 3,             // number of expansion levels
  branchingFactor: 3,   // K thoughts per level
  beamWidth: 1,         // survivors kept after each level (default 1 = greedy)
  score: (thought) => thought.length,   // your value estimate; higher is better
});

const result = await thinker.run({ message: 'What is the fastest sort for nearly-sorted data?' });
```

**Options:**

| Field | Type | Default | Meaning |
|---|---|---|---|
| `provider` | `LLMProvider` | *(required)* | Provider for the thought generator |
| `model` | `string` | *(required)* | Model id |
| `thoughtPrompt` | `string` | *(required)* | System prompt for each thought LLMCall |
| `depth` | `number` | *(required)* | Number of expansion levels (≥ 1) |
| `branchingFactor` | `number` | *(required)* | K thoughts generated per level (≥ 2) |
| `score` | `(thought: string) => number` | *(required)* | Synchronous scorer; higher is better |
| `beamWidth` | `number` | `1` | Survivors kept after each level |
| `temperature` / `maxTokens` | `number` | `0.7` / — | `temperature` drives thought diversity |
| `name` / `id` | `string` | `'ToT'` / `'tot'` | Topology + narrative labels |

Throws if `depth < 1`, `branchingFactor < 2`, or `beamWidth < 1`. For depth-only refinement without branching, use `reflection`.

Under the hood: `Loop.repeat(Parallel(K thoughts).mergeWithFn(score-and-keep-top-beamWidth)).times(depth)`. Each level's surviving frontier becomes the next level's input.

**Observability:** each thought is a separate branch in the narrative; each level emits `composition.iteration_start` / `iteration_exit`. The merge function's scoring decides which thoughts survive.

**Failure modes:** a weak scorer prunes the wrong thoughts. Cost scales with `depth × branchingFactor` — at `depth: 3, branchingFactor: 3` you pay ~9× the tokens of a single LLMCall. Measure quality lift vs single-shot before shipping.

---

### `mapReduce` — Split → fan-out shards → reduce

> **Like:** tearing a long report into chunks, handing each to a reader, then having them write a joint summary.

**Built from:** Sequence(split, Parallel(LLM × N) + reduce).
**Paper:** Map-Reduce (Dean & Ghemawat 2004); LLM-flavored variants appear in summarization-tree literature.

A consumer-supplied `split(input, shardCount)` chops the input into exactly `shardCount` strings at run time. Those shards fan out across `shardCount` parallel LLMCalls (all sharing one `mapPrompt`), then a reducer combines the results — either an LLM synthesizer or a pure function.

**Why:** map-reduce is a common shape — summarize N chunks of a long document, compare N candidates, evaluate a prompt against N rubrics. Splitting at run time keeps the shard contents flexible while the fan-out width stays fixed at build time.

**Background:** the map-reduce shape predates LLMs (Dean & Ghemawat 2004). LLM-flavored variants appear in summarization-tree literature (e.g. LangChain's `map_reduce` chain, refine chains). **Honesty box:** this factory is the simple flat form with a build-time-fixed `shardCount` — no hierarchical reduce, no recursive splitting. For very large N build a tree of `mapReduce` calls.

```typescript
import { mock } from 'agentfootprint';
import { mapReduce } from 'agentfootprint/patterns';

const provider = mock();   // swap for a real provider from 'agentfootprint/llm-providers'

const pipeline = mapReduce({
  provider,
  model: 'claude-sonnet-4',
  mapPrompt: 'Summarize this chunk in two sentences.',
  shardCount: 3,
  split: (input, n) => input.split('\n\n').slice(0, n),   // MUST return exactly n strings
  reduce: {
    kind: 'llm',
    opts: { provider, model: 'claude-sonnet-4', prompt: 'Combine the summaries into a single report.' },
  },
});

const result = await pipeline.run({ message: longDocument });
```

For a deterministic combiner, swap the reducer for a pure function:

```typescript
reduce: { kind: 'fn', fn: (results) => Object.values(results).join('\n\n') }
```

**Options:**

| Field | Type | Default | Meaning |
|---|---|---|---|
| `provider` | `LLMProvider` | *(required)* | Provider for the per-shard mappers |
| `model` | `string` | *(required)* | Model id for the mappers |
| `mapPrompt` | `string` | *(required)* | System prompt applied to every shard |
| `shardCount` | `number` | *(required)* | Fan-out width (≥ 2), fixed at build time |
| `split` | `(input, shardCount) => readonly string[]` | *(required)* | Run-time splitter; must return exactly `shardCount` strings |
| `reduce` | `{ kind: 'fn'; fn } \| { kind: 'llm'; opts }` | *(required)* | Reducer — pure function or LLM synthesizer (`opts: MergeWithLLMOptions`) |
| `temperature` / `maxTokens` | `number` | — | Forwarded to every mapper |
| `name` / `id` | `string` | `'MapReduce'` / `'mapreduce'` | Topology + narrative labels |

Throws if `shardCount < 2` — use a single `LLMCall` for one shard. If `split` returns fewer than `shardCount` strings, the remaining shards receive empty strings; extra strings are truncated.

Under the hood: `Sequence(split → Parallel(shard-0..N-1).mergeWithFn|mergeWithLLM)`. The reducer's pure-function form receives the per-branch results keyed by `shard-i`.

**Observability:** each shard appears as a labeled branch (`shard-i`) in the narrative. You can trace every claim in the final report back to which shard produced it.

**Failure modes:** one shard throws → the whole `Parallel` subflow rejects (strict-merge behavior). If your mappers hit external services, wrap the provider with `withRetry(...)` from `agentfootprint/resilience`. Reduce-step hallucination risk: the LLM reducer may drop or invent content — when the source-of-truth mappings matter, prefer `reduce.kind === 'fn'` with a deterministic combiner.

---

### `selfConsistency` — Sample N → majority vote

> **Like:** asking the same question several times and going with the most common answer.

**Built from:** Parallel(LLM × N) + majority-vote merge.
**Paper:** *Self-Consistency Improves Chain of Thought Reasoning in Language Models* (Wang et al. 2022).

Run `samples` parallel LLMCalls with the same input (high temperature for diversity), extract a "vote token" from each, then return the most frequent one. Ties break toward the first sample.

```typescript
import { mock } from 'agentfootprint';
import { selfConsistency } from 'agentfootprint/patterns';

const provider = mock();

const voter = selfConsistency({
  provider,
  model: 'claude-sonnet-4',
  systemPrompt: 'Solve step by step, then end with "ANSWER: <value>".',
  samples: 5,
  extract: (response) => response.split('ANSWER:').pop()?.trim() ?? response.trim(),
});

const result = await voter.run({ message: 'What is 17 × 24?' });
```

**Options:**

| Field | Type | Default | Meaning |
|---|---|---|---|
| `provider` / `model` | `LLMProvider` / `string` | *(required)* | Sampler provider + model |
| `systemPrompt` | `string` | *(required)* | Prompt for every sample |
| `samples` | `number` | *(required)* | Parallel samples (≥ 2) |
| `extract` | `(response: string) => string` | trim | Maps a response to its vote token |
| `temperature` / `maxTokens` | `number` | `0.7` / — | Higher temperature = more diverse samples |
| `name` / `id` | `string` | `'SelfConsistency'` / `'self-consistency'` | Topology + narrative labels |

Throws if `samples < 2` — use a single `LLMCall` for one sample.

---

### `debate` — Proposer ↔ Critic → Judge

> **Like:** two advocates argue, then a judge rules.

**Built from:** Sequence(proposer, critic, judge) — or `Loop(Sequence(...))` when `rounds > 1`.
**Paper:** *Improving Factuality and Reasoning in Language Models through Multiagent Debate* (Du et al. 2023).

A proposer asserts a position, a critic argues against it (`rounds` times), then a judge reads the transcript and renders the verdict.

```typescript
import { mock } from 'agentfootprint';
import { debate } from 'agentfootprint/patterns';

const provider = mock();

const panel = debate({
  provider,
  model: 'claude-sonnet-4',
  proposerPrompt: 'Argue FOR the proposition.',
  criticPrompt: 'Argue AGAINST the previous argument.',
  judgePrompt: 'Read the transcript and give the final verdict.',
  rounds: 2,   // propose+critique rounds before the judge weighs in (default 1)
});

const result = await panel.run({ message: 'Should this PR be merged?' });
```

**Options:**

| Field | Type | Default | Meaning |
|---|---|---|---|
| `provider` / `model` | `LLMProvider` / `string` | *(required)* | Shared by all three personas |
| `proposerPrompt` / `criticPrompt` / `judgePrompt` | `string` | *(required)* | The three personas |
| `rounds` | `number` | `1` | Propose+critique rounds before the judge |
| `temperature` / `maxTokens` | `number` | — | Forwarded to every LLMCall |
| `name` / `id` | `string` | `'Debate'` / `'debate'` | Topology + narrative labels |

Throws if `rounds < 1`.

---

### `swarm` — Route to a specialist each turn

> **Like:** a switchboard that hands each turn to whichever specialist fits.

**Built from:** Loop(Conditional(route-to-agent)).
**Paper:** OpenAI Swarm (2024).

A fixed roster of agents plus a synchronous `route({ message })` function that picks which agent's id handles the next turn. The chosen agent's output feeds the next iteration; the loop halts when `route` returns `undefined`, `'done'`, or an unknown id — or when `maxHandoffs` is reached.

```typescript
import { Agent, mock } from 'agentfootprint';
import { swarm } from 'agentfootprint/patterns';

const provider = mock();
const model = 'claude-sonnet-4';

const flow = swarm({
  agents: [
    { id: 'triage',  runner: Agent.create({ provider, model }).system('Triage the request.').build() },
    { id: 'billing', runner: Agent.create({ provider, model }).system('Handle billing.').build() },
  ],
  route: ({ message }) => (message.includes('refund') ? 'billing' : 'triage'),
  maxHandoffs: 10,
});

const result = await flow.run({ message: 'I want a refund.' });
```

**Options:**

| Field | Type | Default | Meaning |
|---|---|---|---|
| `agents` | `SwarmAgent[]` | *(required)* | Fixed roster (≥ 2). `SwarmAgent = { id, name?, runner }` |
| `route` | `(input: { message }) => string \| undefined` | *(required)* | Picks the next agent's id; `undefined`/`'done'`/unknown halts |
| `maxHandoffs` | `number` | `10` | Loop cap |
| `name` / `id` | `string` | `'Swarm'` / `'swarm'` | Topology + narrative labels |

Throws if there are fewer than 2 agents, or if any agent id is `'done'` (reserved for the halt branch).

---

## Composing patterns with primitives and compositions

Every pattern returns a `Runner`, so they plug into every composition (Sequence / Parallel / Conditional):

```typescript
import { Sequence, Conditional } from 'agentfootprint';

// Pattern inside a Sequence:
Sequence.create({ name: 'research-then-write' })
  .step('research', mapReduce({ provider, model, mapPrompt, shardCount: 3, split, reduce }))
  .step('write',    reflection({ provider, model, proposerPrompt, criticPrompt }))
  .build();

// Pattern inside a Conditional (.when(id, predicate, runner, name?), .otherwise(id, runner)):
Conditional.create({ name: 'triage' })
  .when('complex', (input) => isComplex(input.message), tot({ provider, model, thoughtPrompt, depth: 2, branchingFactor: 3, score }))
  .otherwise('simple', simpleRunner)
  .build();
```

For dynamic specialist hand-offs inside a loop, use the `swarm()` factory shown above rather than hand-wiring the Conditional + Loop yourself.

---

## Beyond the shipped patterns

The six factories cover the most common shapes (self-review, beam search, vote, debate, map-reduce, hand-off). When you need something outside that set, remember: **every named pattern is a composition of 2 primitives + 3 compositions.** Don't invent new Agent classes — compose primitives.

1. **Start with the primitives + compositions** — Agent + Sequence / Parallel / Conditional already express most graph shapes.
2. **Give the Agent tools** — registering tools on an `Agent` and letting the LLM choose covers most dynamic-control cases without leaving the Agent abstraction; for specialist hand-offs use `swarm()`.
3. **Drop to footprintjs** — the builder (`flowChart()`, `addFunction`, `addDeciderFunction`, `addSubFlowChart`, `loopTo`) is the same library agentfootprint is built on. No escape, no re-learning.

If you build a shape worth reusing, the source of the patterns in [src/patterns/](../../src/patterns/) is ~85–230 lines each — copy one and modify.

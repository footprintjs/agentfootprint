# Concepts — The Taxonomy

agentfootprint organizes AI work into five layers. Read top to bottom; each layer is built from the one above.

```
PRIMITIVES (2 — atomic invocation units)
  1. LLM      — one call
  2. Agent    — a loop of calls + tools + decisions (= ReAct)

COMPOSITIONS (3 — how primitives arrange)
  1. Sequence     — one after another
  2. Parallel     — at the same time
  3. Conditional  — branch on a decider

PATTERNS (N — named configurations; every named paper is a recipe)
  ReAct              = Agent (default)
  Dynamic ReAct      = Agent with slots re-evaluating per iter
  Swarm (hand-off)   = Loop(Conditional(route-to-agent))         swarm()
  Reflection         = Sequence(Agent, LLM-critique, revise)     reflection()
  Tree-of-Thoughts   = Parallel(Agent × N) + LLM-rank            tot()
  Self-Consistency   = Parallel(Agent × N) + vote                selfConsistency()
  Debate             = Parallel(Agent × N) + LLM-judge           debate()
  Map-Reduce         = Parallel(Agent × N) + LLM-merge           mapReduce()

CONTEXT ENGINEERING (cross-cutting — what you inject into Agent slots)
  RAG          → messages
  Memory       → messages
  Skills       → system-prompt (+ tools)
  Instructions → system-prompt (after specific tool results)
  Tools        → tools slot
  Grounding    → system-prompt (style, rules)

FEATURES (infrastructure)
  Providers · Runtime · Observability · Security · Resilience
```

**Two theses to hold in your head:**

1. **Agent = ReAct.** If it doesn't loop-with-tools, it isn't an Agent — it's an LLM call. Don't call something an Agent unless there's a loop.
2. **Every named pattern in the literature = a composition of the 2 primitives + 3 compositions.** `reflection()` isn't a new Agent class; it's `Sequence(Agent, critique-LLM, revise)`. `tot()` isn't a new runtime; it's `Parallel(Agent × N) + rank`. `swarm()` is `Loop(Conditional(route-to-agent))`.

**Paper citations tie each pattern to its source:** ReAct (Yao 2022), Reflection (Shinn 2023), Tree-of-Thoughts (Yao 2023), Swarm (OpenAI 2024). We express those papers as factory functions composing the 5 primitives — not as new class names per paper.

All runners share the same `Runner` interface — that's what makes composition work:

```typescript
// Builder: .create({...}) → .system() → .build()
// Runner:  .run(input) → .getSnapshot() → .getSpec()  (+ .on()/.attach()/.enable for observation)
```

---

## PRIMITIVES

### 1. LLM — one call (`LLMCall`)

> **Like:** asking a question and getting an answer. No back-and-forth.

The simplest concept: one prompt in, one response out. No tools, no loops.

**Internal flowchart:** `Client → sf-llm-call (Initialize → SystemPrompt → Messages → CallLLM → ExtractFinal) → loopTo(Client)` (the loop fires once — LLMCall is one-shot)

```typescript
import { LLMCall, mock } from 'agentfootprint';

const call = LLMCall.create({
  provider: mock({ replies: ['Positive sentiment.'] }),
  model: 'mock',
})
  .system('Classify the sentiment of the input as positive, negative, or neutral.')
  .build();

const content = await call.run({ message: 'I love this product!' });
console.log(content); // "Positive sentiment." — run() resolves to the answer string
```

**Builder API:**

| Method | Description |
|--------|-------------|
| `LLMCall.create({ provider, model, name?, ... })` | Create builder — `provider` and `model` are required |
| `.system(prompt)` | Set system prompt |
| `.build()` | Returns an `LLMCall` runner |

**Runner API:** (every runner implements the shared `Runner` interface)

| Method | Returns | Description |
|--------|---------|-------------|
| `.run({ message }, options?)` | `Promise<string \| RunnerPauseOutcome>` | Execute the LLM call; resolves to the answer string |
| `.getSnapshot()` | `RuntimeSnapshot \| undefined` | Full execution state of the last run |
| `.getSpec()` | `FlowChart` | Design-time flowchart blueprint |
| `.attach(recorder)` / `.on(event, fn)` | `Unsubscribe` | Observe execution events |

**Failure modes:** provider call throws → the error propagates out of `run()` (wrap the provider with `withRetry` from `agentfootprint/resilience`). Provider returns empty content → `run()` resolves to `''`. No tool support — if your prompt asks the LLM to "search", you'll get refusal text, not a search.

---

### 2. Agent — a loop of calls + tools + decisions (= ReAct)

> **Like:** a research assistant — you ask, it looks things up, then answers.

**Agent = ReAct.** This is the definition, not a default. The Agent primitive IS the ReAct loop (Yao et al. 2022, ICLR — "Reasoning + Acting" interleaved). If it doesn't loop-with-tools, it isn't an Agent.

**Internal flowchart:** `Initialize → InjectionEngine → [Context: SystemPrompt ‖ Messages ‖ Tools] → CallLLM → Route → { tool-calls → loopTo(InjectionEngine) | Final }`

```typescript
import { Agent, mock, defineTool } from 'agentfootprint';

const calculator = defineTool({
  name: 'calculate',
  description: 'Evaluate a math expression.',
  inputSchema: {
    type: 'object',
    properties: { expression: { type: 'string' } },
    required: ['expression'],
  },
  // execute() receives the parsed args and returns the tool result.
  execute: async ({ expression }) => String(eval(expression)),
});

const agent = Agent.create({
  provider: mock({
    replies: [
      {
        content: 'Let me calculate that.',
        toolCalls: [{ id: 'tc1', name: 'calculate', args: { expression: '2 + 2' } }],
      },
      { content: 'The answer is 4.' },
    ],
  }),
  model: 'mock',
  name: 'math-agent',
})
  .system('You are a math assistant. Use the calculator tool.')
  .tool(calculator)
  .maxIterations(5)
  .build();

const answer = await agent.run({ message: 'What is 2 + 2?' });
console.log(answer); // "The answer is 4." — run() resolves to the final answer string
```

**Builder API:**

| Method | Description |
|--------|-------------|
| `Agent.create({ provider, model, name?, maxIterations?, ... })` | Create builder — `provider` and `model` are required |
| `.system(prompt, opts?)` | Set system prompt |
| `.tool(toolDef)` | Register a single tool (`defineTool(...)`) |
| `.tools(toolDefs)` | Register multiple tools at once |
| `.maxIterations(n)` | Override the ReAct loop cap (default: 10, hard cap 50) |
| `.outputSchema(parser, opts?)` | Declare a terminal JSON contract; enables `.runTyped()` |
| `.memory(def)` / `.rag(def)` / `.skill(inj)` / `.instruction(inj)` | Context-engineering injections |
| `.recorder(rec)` | Attach a `CombinedRecorder` |
| `.build()` | Returns an `Agent` runner |

**Runner API:**

| Method | Returns | Description |
|--------|---------|-------------|
| `.run({ message, identity? }, options?)` | `Promise<string \| RunnerPauseOutcome>` | Execute the ReAct loop; resolves to the final answer string |
| `.runTyped({ message }, options?)` | `Promise<T>` | Run + parse + validate against `.outputSchema()` |
| `.getNarrativeEntries()` | `CombinedNarrativeEntry[]` | Structured narrative entries from the last run |
| `.getSnapshot()` | `RuntimeSnapshot \| undefined` | Full execution state of the last run |
| `.getSpec()` | `FlowChart` | Design-time flowchart blueprint (mount as a subflow with `getSpec()`) |

**Failure modes:** tool throws → the error is converted to a synthetic tool-result string the LLM sees and may recover from; LLM may retry or apologize. Hits `maxIterations` → loop terminates with whatever the LLM last said. Tool result too large → may exceed model context window; consider summarizing tool output.

> **Conversation memory:** each `agent.run(...)` is independent by default. To carry context across turns, attach a memory subsystem via `.memory(defineMemory({...}))` (see [Memory](https://footprintjs.github.io/agentfootprint/docs/build/memory)). Multi-tenant isolation flows through the `identity` field on the run input.

---

## COMPOSITIONS

The three ways primitives arrange into bigger shapes. Every named pattern below is some arrangement of these three.

### 1. Sequence — one after another (`Sequence`)

> **Like:** an assembly line — each station does one thing, output of one feeds the next.

Composes multiple runners (LLMs, Agents, or other compositions) into a sequential pipeline. Each step's string output becomes the next step's input.

**Internal flowchart:** `Seed → step1 (subflow) → step2 (subflow) → ... → stepN (subflow) → Finalize`

Each step is mounted as a subflow via the runner's `getSpec()`, enabling UI drill-down via `getSubtreeSnapshot()`.

```typescript
import { Sequence, Agent, LLMCall, mock } from 'agentfootprint';

const researcher = Agent.create({
  provider: mock({ replies: ['Key findings: AI is growing in healthcare.'] }),
  model: 'mock',
  name: 'researcher',
})
  .system('Research the given topic thoroughly.')
  .build();

const writer = LLMCall.create({
  provider: mock({ replies: ['Article: The Rise of AI in Healthcare...'] }),
  model: 'mock',
})
  .system('Write a polished article based on the research provided.')
  .build();

const pipeline = Sequence.create({ name: 'research-then-write' })
  .step('research', researcher)
  .step('write', writer)
  .build();

const content = await pipeline.run({ message: 'AI trends in healthcare' });
console.log(content); // Final output string from the last step
```

**Builder API:**

| Method | Description |
|--------|-------------|
| `Sequence.create(opts?)` | Create a pipeline builder (`{ name?, id? }`) |
| `.step(id, runner, opts?)` | Add a runner as a sequential step |
| `.pipeVia(fn)` | Transform the previous step's output before the next step |
| `.build()` | Returns a `Sequence` runner |

By default a step's string output feeds the next step as `{ message }`; use `.pipeVia(fn)` to customize that mapping.

**Runner result:** `run({ message })` resolves to the final step's output **string**.

**Failure modes:** any step throws → the entire pipeline fails (no partial-success). Wrap individual runners with `withRetry`/`withFallback` (from `agentfootprint/resilience`) if upstream stages must survive downstream failures. Latency is **sum** of all steps — no parallelism.

---

### 2. Parallel — at the same time (`Parallel`)

> **Like:** asking three colleagues the same question, then merging their answers.

Fan out N runners concurrently (minimum 2 branches), then merge their results either via an LLM call or a custom function.

**Internal flowchart:** `Initialize → [fork] → branch-A | branch-B | branch-C → Merge`

```typescript
import { Parallel, Agent, mock } from 'agentfootprint';

const provider = mock({ replies: ['review text'] });

const ethicsReviewer = Agent.create({ provider, model: 'mock', name: 'ethics' })
  .system('Review the proposal from an ethics perspective.').build();
const costReviewer = Agent.create({ provider, model: 'mock', name: 'cost' })
  .system('Review the proposal from a cost perspective.').build();
const techReviewer = Agent.create({ provider, model: 'mock', name: 'tech' })
  .system('Review the proposal from a technical feasibility perspective.').build();

const review = Parallel.create({ name: 'panel-review' })
  .branch('ethics', ethicsReviewer, 'Ethics review')
  .branch('cost',   costReviewer,   'Cost review')
  .branch('tech',   techReviewer,   'Technical review')
  .mergeWithLLM({
    provider,
    model: 'mock',
    prompt: 'Synthesize the three reviews into a single recommendation.',
  })
  .build();

const content = await review.run({ message: 'Build an internal LLM proxy.' });
console.log(content); // merged recommendation string
```

**Builder API:**

| Method | Description |
|--------|-------------|
| `Parallel.create(opts?)` | Create builder (`{ name?, id? }`) |
| `.branch(id, runner, nameOrOpts?)` | Add a parallel branch (≥ 2 needed). Third arg: a `name` string, or `{ name?, required?, groupTranslator? }` |
| `.mergeWithLLM({ provider, model, prompt, ... })` | Merge results via an LLM call |
| `.mergeWithFn(fn)` | Merge `{ [branchId]: string }` via a pure function (no LLM call) |
| `.mergeOutcomesWithFn(fn)` | Tolerant merge — receives `{ [branchId]: BranchOutcome }` (successes + failures) |
| `.build()` | Returns a `Parallel` runner |

**Runner result:** `run({ message })` resolves to the merged output **string**.

**Failure modes:** with the strict merges (`.mergeWithFn` / `.mergeWithLLM`), one branch throwing makes the whole Parallel **reject** with an aggregated error listing the failed branches. Use `.mergeOutcomesWithFn(fn)` for tolerant partial-failure handling — its callback receives a `BranchOutcome` (`{ ok: true, value }` or `{ ok: false, error }`) per branch, and you decide how to proceed.

**Required branches:** `.branch(id, runner, { required: true })` marks a branch whose failure must reject the WHOLE run — even under a tolerant `.mergeOutcomesWithFn()` merge — with an error naming the branch. When EVERY branch is required, footprintjs's fork-level `failFast` is engaged (`Promise.all`): the first failure aborts immediately, without waiting for slow siblings or running the merge. With a MIXED required/optional set, the fan-out stays best-effort and required failures are enforced at the merge join instead (fork-level `failFast` is all-or-nothing, so engaging it would wrongly abort the run when an *optional* sibling throws); optional siblings' failures keep their normal strict/tolerant handling.

---

### 3. Conditional — branch on a decider (`Conditional`)

> **Like:** a triage nurse — look at the request, route to the right specialist.

`if/else` routing between runners. Predicates run in `.when()` order, first match wins; no match runs `.otherwise()`. Each predicate is a sync function of the input `{ message }`.

```typescript
import { Conditional } from 'agentfootprint';

const triage = Conditional.create({ name: 'triage' })
  .when('refund', (input) => input.message.toLowerCase().includes('refund'), refundAgent)
  .when('long',   (input) => input.message.length > 500,                     ragRunner)
  .otherwise('general', generalAgent)
  .build();

const content = await triage.run({ message: 'I want a refund please' });
// Emits agentfootprint.composition.route_decided with { chosen: 'refund', rationale }
```

**Builder API:**

| Method | Description |
|--------|-------------|
| `Conditional.create(opts?)` | Create builder (`{ name?, id? }`) |
| `.when(id, predicate, runner, name?)` | Add a branch — `predicate: (input: { message }) => boolean` |
| `.otherwise(id, runner, name?)` | Default branch (required) |
| `.build()` | Returns a `Conditional` runner |

`Conditional` is a top-level routing decision between runners — "pick one runner and return its result" (triage, classification). For mid-loop routing inside a ReAct loop, register tools on an `Agent` and let the LLM choose; for dynamic specialist hand-offs, use the `swarm()` pattern factory.

**Failure modes:** no `.otherwise()` registered → build error (every Conditional requires a fallback). A predicate that throws propagates out of `run()` (predicates should be pure and total).

---

## PATTERNS — named compositions

Every paper in the agent literature is a composition of 2 primitives + 3 compositions. We ship a handful as factories; see the [Patterns guide](patterns.md) for the full set with source papers. A sample:

| Pattern | Factory | Built from | Paper |
|---|---|---|---|
| **ReAct** | `Agent` (default) | Agent primitive | Yao et al. 2022 |
| **Dynamic ReAct** | `Agent` (`reactMode: 'dynamic'`, default) | Agent with slots re-evaluating per iter | — (this library) |
| **Swarm (hand-off)** | `swarm()` | `Loop(Conditional(route-to-agent))` | OpenAI Swarm 2024 |
| **Reflection** | `reflection()` | Sequence(Agent, LLM-critique, revise) | Shinn et al. 2023 |
| **Tree-of-Thoughts** | `tot()` | Parallel(Agent × N) + LLM-rank | Yao et al. 2023 |
| **Self-Consistency** | `selfConsistency()` | Parallel(Agent × N) + vote | Wang et al. 2022 |
| **Debate** | `debate()` | Parallel(Agent × N) + LLM-judge | Du et al. 2023 |
| **Map-Reduce** | `mapReduce()` | Parallel(Agent × N) + LLM-merge | Dean & Ghemawat 2004 |

> **Display-name note.** Don't invent a new primitive class for each pattern — that's LangChain's mistake. Each pattern ships as a **factory function** (`swarm()`, `reflection()`, `tot()`, …) that returns a plain `Runner` built from the 2 primitives + 3 compositions. The factory composes; it doesn't introduce a new runtime.

### Swarm (hand-off) — worked example

> **Like:** a front desk that reads each request and hands it to the right specialist on the team.

Multi-agent hand-off. At each step a routing function picks which specialist handles the next turn; the chosen agent's output becomes the next iteration's input.

**Built from:** `Loop(Conditional(route-to-agent))`. Not a new primitive — a composition over `Loop` + `Conditional`. The agent roster is fixed at build time; the routing decision is made at runtime by a consumer-supplied `route(input)` function.

```typescript
import { swarm, Agent, mock } from 'agentfootprint';
import type { Runner } from 'agentfootprint';

const researcher: Runner<{ message: string }, string> = Agent.create({
  provider: mock({ replies: ['Research findings: ...'] }),
  model: 'mock',
  name: 'researcher',
}).system('Deep research on any topic.').build();

const coder: Runner<{ message: string }, string> = Agent.create({
  provider: mock({ replies: ['function solve() { /* ... */ }'] }),
  model: 'mock',
  name: 'coder',
}).system('Write code to solve problems.').build();

const team = swarm({
  name: 'project-team',
  agents: [
    { id: 'research', name: 'Researcher', runner: researcher },
    { id: 'code',     name: 'Coder',      runner: coder },
  ],
  // Pure sync routing — pick the next agent by id, or return undefined / 'done' to halt.
  route: (input) => (input.message.includes('code') ? 'code' : 'research'),
  maxHandoffs: 10,
});

const content = await team.run({ message: 'Explain quantum computing' });
console.log(content); // final hand-off output string
```

**Factory options (`SwarmOptions`):**

| Field | Description |
|--------|-------------|
| `agents` | Fixed roster: `{ id, name?, runner }[]` (≥ 2 required) |
| `route(input)` | Sync function returning the next agent id, or `undefined` / `'done'` to halt |
| `maxHandoffs?` | Max hand-offs before the loop halts (default: 10) |
| `name?` / `id?` | Display name + stable id for topology/events |

**Runner result:** `run({ message })` resolves to the final hand-off output **string**. (`'done'` is reserved as the halt branch id — don't name an agent `done`.)

**Failure modes:** `route()` returns an unknown id → falls to the halt branch and the loop exits. A specialist throws → the error propagates (wrap the specialist runner with `withRetry` / `withFallback` if needed). Hits `maxHandoffs` → loop terminates with the latest output.

> **LLM-driven routing:** for the classic Swarm style where the LLM picks the next agent, compose a "router" `LLMCall` as a step and parse its response inside your `route()` function.

---

## CONTEXT ENGINEERING (cross-cutting)

These are **not primitives.** They're injection patterns — what you put into an Agent's three slots (system-prompt / messages / tools). Every "RAG-agent", "memory-agent", or "skills-agent" is still an Agent; it just has different context plumbed into its slots.

| Technique | Where it injects | Purpose |
|---|---|---|
| **RAG** | messages | Retrieve relevant chunks at query time |
| **Memory** | messages | Persist conversation / facts across turns |
| **Skills** | system-prompt (+ tools) | Auto-activate persona + tools when a trigger fires |
| **Instructions** | system-prompt (after specific tool results) | Conditional behavior after a tool observation |
| **Tools** | tools slot | Actions the Agent can invoke |
| **Grounding** | system-prompt | Style / citation / safety rules |

> **Callout: RAG is context engineering, not a primitive.** `defineRAG(...)` in this library returns a `MemoryDefinition` you attach to any Agent via `.rag(def)` (an alias of `.memory(def)`). It isn't a new kind of runner — it's a worked example of "inject retrieved chunks into the slots." *Retrieval-Augmented Generation* is the technique (Lewis et al. 2020, NeurIPS); the helper is the packaging. See [RAG](https://footprintjs.github.io/agentfootprint/docs/build/rag).

Individual guides: [RAG](https://footprintjs.github.io/agentfootprint/docs/build/rag), [Memory](https://footprintjs.github.io/agentfootprint/docs/build/memory), [Skills](https://footprintjs.github.io/agentfootprint/docs/build/skills), [Instructions](instructions.md), [Tools](https://footprintjs.github.io/agentfootprint/docs/build/tools), [Grounding](https://footprintjs.github.io/agentfootprint/docs/build/grounding).

---

## FEATURES (infrastructure)

Cross-cutting infrastructure that every primitive and composition uses. See:

- [Providers](providers.md) — LLM adapters (`mock`, `anthropic`, `openai`, `bedrock`, …) and `ToolProvider` (`staticTools`, `gatedTools`, `skillScopedTools`)
- [Recorders](recorders.md) — observability factories (`costRecorder`, `evalRecorder`, `memoryRecorder`, `skillRecorder`, `toolsRecorder`, `permissionRecorder`, …) plus `CombinedNarrativeRecorder`
- [Orchestration](orchestration.md) — `withRetry`, `withFallback`, `withCircuitBreaker` (from `agentfootprint/resilience`)
- [Security](security.md) — tool gating, `PermissionPolicy`, audit trail
- [Streaming](streaming.md) — `toSSE`, real-time lifecycle events

---

## Runner Interface

All runners — primitives, compositions, and pattern factories — conform to the `Runner` interface. That's what makes composition work:

```typescript
interface Runner<TIn = unknown, TOut = unknown> {
  run(input: TIn, options?: RunOptions): Promise<TOut | RunnerPauseOutcome>;
  resume(checkpoint: FlowchartCheckpoint, input?: unknown, options?: RunOptions): Promise<TOut | RunnerPauseOutcome>;
  getSpec(): FlowChart;                 // design-time blueprint (mount as a subflow)
  getSnapshot(): RuntimeSnapshot | undefined;
  on(type, listener, options?): Unsubscribe;   // typed event subscription
  attach(recorder: CombinedRecorder): Unsubscribe;
  readonly enable: EnableNamespace;     // .enable.flowchart() / .observability() / ...
  // ...emit(), off(), once(), getUIGroup()
}
```

The compositions and primitives use `{ message: string }` as their `TIn` and a `string` as their `TOut`. Any runner plugs into any composition (Sequence / Parallel / Conditional) or any pattern factory — that uniform `run()/getSpec()` shape is what lets them nest freely.

---

## Choosing the right shape

| Need | Use |
|------|-----|
| Summarization, classification, extraction | **LLM** (`LLMCall`) |
| Research, code generation, multi-step reasoning | **Agent** |
| Q&A over documents or knowledge bases | Agent + `.rag(defineRAG(...))` |
| Ordered multi-step pipelines (research then write) | **Sequence** (`Sequence`) |
| Independent perspectives merged together | **Parallel** |
| Static if/else routing (triage, content classification) | **Conditional** |
| Multi-agent hand-off across specialists | Pattern: `swarm()` |
| Draft → critique → improve | Pattern: `reflection()` |
| Multiple attempts, rank picks best | Pattern: `tot()` |
| Sample N answers, take the majority vote | Pattern: `selfConsistency()` |
| Fan-out across N inputs, reduce | Pattern: `mapReduce()` |

For the named patterns (`swarm` / `reflection` / `tot` / `selfConsistency` / `debate` / `mapReduce`), see the [Patterns guide](patterns.md).

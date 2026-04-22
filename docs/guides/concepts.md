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
  Hierarchy (Swarm)  = Agent with specialist-Agents as tools
  Reflexion          = Sequence(Agent, LLM-critique, Agent)
  Tree-of-Thoughts   = Parallel(Agent × N) + LLM-rank
  Plan-Execute       = LLM-plan + Sequence(Agent per step)
  Map-Reduce         = Parallel(Agent × N) + LLM-merge

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
2. **Every named pattern in the literature = a composition of the 2 primitives + 3 compositions.** Reflexion isn't a new Agent class; it's `Sequence(Agent, critique-LLM, Agent)`. Tree-of-Thoughts isn't a new runtime; it's `Parallel(Agent × N) + rank`. Hierarchy/Swarm is an Agent whose tools happen to be other Agents.

**Paper citations tie each pattern to its source:** ReAct (Yao 2022), Reflexion (Shinn 2023), Tree-of-Thoughts (Yao 2023), Swarm (OpenAI 2024). We express those papers as compositions of the 5 primitives — not as new class names per paper.

All runners share the same interface — that's what makes composition work:

```typescript
// Builder: .create() → .system() → .recorder() → .build()
// Runner:  .run() → .getNarrative() → .getSnapshot() → .getSpec()
```

---

## PRIMITIVES

### 1. LLM — one call (`LLMCall`)

> **Like:** asking a question and getting an answer. No back-and-forth.

The simplest concept: one prompt in, one response out. No tools, no loops.

**Internal flowchart:** `SeedScope → CallLLM → ParseResponse → Finalize`

```typescript
import { LLMCall, mock } from 'agentfootprint';

const call = LLMCall.create({ provider: mock([{ content: 'Positive sentiment.' }]) })
  .system('Classify the sentiment of the input as positive, negative, or neutral.')
  .build();

const result = await call.run('I love this product!');
console.log(result.content); // "Positive sentiment."
```

**Builder API:**

| Method | Description |
|--------|-------------|
| `LLMCall.create({ provider })` | Create builder with an LLM provider |
| `.system(prompt)` | Set system prompt |
| `.recorder(rec)` | Attach an AgentRecorder |
| `.build()` | Returns `LLMCallRunner` |

**Runner API:**

| Method | Returns | Description |
|--------|---------|-------------|
| `.run(message, options?)` | `{ content, messages }` | Execute the LLM call |
| `.getNarrative()` | `string[]` | Human-readable trace |
| `.getSnapshot()` | `RuntimeSnapshot` | Full execution state |
| `.getSpec()` | Stage graph | Flowchart metadata |

**Failure modes:** provider call throws → propagates as `LLMError` (use `withRetry`). Provider returns empty content → returned as `{ content: '' }`. No tool support — if your prompt asks the LLM to "search", you'll get refusal text, not a search.

---

### 2. Agent — a loop of calls + tools + decisions (= ReAct)

> **Like:** a research assistant — you ask, it looks things up, then answers.

**Agent = ReAct.** This is the definition, not a default. The Agent primitive IS the ReAct loop (Yao et al. 2022, ICLR — "Reasoning + Acting" interleaved). If it doesn't loop-with-tools, it isn't an Agent.

**Internal flowchart:** `SeedScope → PromptAssembly → CallLLM → ParseResponse → HandleResponse → loopTo(CallLLM)`

```typescript
import { Agent, mock, defineTool } from 'agentfootprint';

const calculator = defineTool({
  id: 'calculate',
  description: 'Evaluate a math expression.',
  inputSchema: {
    type: 'object',
    properties: { expression: { type: 'string' } },
    required: ['expression'],
  },
  handler: async ({ expression }) => ({ content: String(eval(expression)) }),
});

const agent = Agent.create({
  provider: mock([
    {
      content: 'Let me calculate that.',
      toolCalls: [{ id: 'tc1', name: 'calculate', arguments: { expression: '2 + 2' } }],
    },
    { content: 'The answer is 4.' },
  ]),
  name: 'math-agent',
})
  .system('You are a math assistant. Use the calculator tool.')
  .tool(calculator)
  .maxIterations(5)
  .build();

const result = await agent.run('What is 2 + 2?');
console.log(result.content);    // "The answer is 4."
console.log(result.iterations); // 2
```

**Builder API (extends LLMCall):**

| Method | Description |
|--------|-------------|
| `Agent.create({ provider, name? })` | Create builder |
| `.system(prompt)` | Set system prompt |
| `.tool(toolDef)` | Register a single tool |
| `.tools(toolDefs)` | Register multiple tools |
| `.maxIterations(n)` | Max ReAct loop iterations (default: 10) |
| `.recorder(rec)` | Attach an AgentRecorder |
| `.build()` | Returns `AgentRunner` |

**Runner API (extends LLMCallRunner):**

| Method | Returns | Description |
|--------|---------|-------------|
| `.run(message, options?)` | `{ content, messages, iterations }` | Execute the agent loop |
| `.getMessages()` | `Message[]` | Conversation history (for multi-turn) |
| `.resetConversation()` | `void` | Clear conversation history |
| `.toFlowChart()` | `FlowChart` | Expose internal flowchart for subflow composition |
| `.getNarrative()` | `string[]` | Human-readable trace |
| `.getNarrativeEntries()` | `NarrativeEntry[]` | Structured narrative entries |
| `.getSnapshot()` | `RuntimeSnapshot` | Full execution state |
| `.getSpec()` | Stage graph | Flowchart metadata |

**Failure modes:** tool throws → result becomes `{ error: true, content: errorMessage }` and flows into the conversation; LLM may retry or apologize. Hits `maxIterations` → loop terminates with whatever the LLM last said. Tool result too large → may exceed model context window; consider summarizing tool output.

**Multi-turn conversations:**

```typescript
const agent = Agent.create({ provider, name: 'chat' })
  .system('You are a helpful assistant.')
  .build();

await agent.run('My name is Alice.');
const result = await agent.run('What is my name?');
// Agent remembers — conversation history persists across runs
agent.resetConversation(); // Clear when done
```

---

## COMPOSITIONS

The three ways primitives arrange into bigger shapes. Every named pattern below is some arrangement of these three.

### 1. Sequence — one after another (`FlowChart`)

> **Like:** an assembly line — each station does one thing, output of one feeds the next.

Composes multiple runners (LLMs, Agents, or other compositions) into a sequential pipeline. Each runner feeds into the next.

**Internal flowchart:** `Seed → Runner1 (subflow) → Runner2 (subflow) → ... → RunnerN (subflow)`

Runners with `.toFlowChart()` (LLMCallRunner, AgentRunner, RAGRunner) are mounted as subflows, enabling UI drill-down via `getSubtreeSnapshot()`.

```typescript
import { FlowChart, Agent, LLMCall, mock } from 'agentfootprint';

const researcher = Agent.create({
  provider: mock([{ content: 'Key findings: AI is growing in healthcare.' }]),
  name: 'researcher',
})
  .system('Research the given topic thoroughly.')
  .build();

const writer = LLMCall.create({
  provider: mock([{ content: 'Article: The Rise of AI in Healthcare...' }]),
})
  .system('Write a polished article based on the research provided.')
  .build();

const pipeline = FlowChart.create()
  .agent('research', 'Research', researcher)
  .agent('write', 'Write', writer)
  .build();

const result = await pipeline.run('AI trends in healthcare');
console.log(result.content); // Final output from the last runner
console.log(result.agents);  // Per-agent results: [{ id, name, content, latencyMs }]
console.log(result.totalLatencyMs);
```

**Builder API:**

| Method | Description |
|--------|-------------|
| `FlowChart.create()` | Create empty pipeline builder |
| `.agent(id, name, runner, options?)` | Add a runner to the pipeline |
| `.recorder(rec)` | Attach an AgentRecorder |
| `.build()` | Returns `FlowChartRunner` |

The `.agent()` options support `inputMapper` and `outputMapper` for custom data flow between stages.

**Runner result:** `{ content, agents, totalLatencyMs }`

**Failure modes:** any runner throws → entire pipeline fails (no partial-success). Wrap individual runners with `withRetry`/`withFallback` if upstream stages must survive downstream failures. Latency is **sum** of all stages — no parallelism.

---

### 2. Parallel — at the same time (`Parallel`)

> **Like:** asking three colleagues the same question, then merging their answers.

Fan out N runners concurrently, then merge their results either via an LLM call or a custom function. Capped at 10 branches as a safety guard.

**Internal flowchart:** `Seed → [fork] → branch-A | branch-B | branch-C → Merge → Finalize`

```typescript
import { Parallel, Agent, mock } from 'agentfootprint';

const ethicsReviewer = Agent.create({ provider, name: 'ethics' })
  .system('Review the proposal from an ethics perspective.').build();
const costReviewer = Agent.create({ provider, name: 'cost' })
  .system('Review the proposal from a cost perspective.').build();
const techReviewer = Agent.create({ provider, name: 'tech' })
  .system('Review the proposal from a technical feasibility perspective.').build();

const review = Parallel.create({ provider, name: 'panel-review' })
  .agent('ethics', ethicsReviewer, 'Ethics review')
  .agent('cost',   costReviewer,   'Cost review')
  .agent('tech',   techReviewer,   'Technical review')
  .mergeWithLLM('Synthesize the three reviews into a single recommendation.')
  .build();

const result = await review.run('Build an internal LLM proxy.');
console.log(result.content);   // merged recommendation
console.log(result.branches);  // per-reviewer outputs with status: 'fulfilled' | 'rejected'
```

**Builder API:**

| Method | Description |
|--------|-------------|
| `Parallel.create({ provider, name? })` | Create builder |
| `.agent(id, runner, description)` | Add a parallel branch |
| `.mergeWithLLM(prompt)` | Merge results via an LLM call |
| `.merge(fn)` | Merge results via a pure function (no LLM call) |
| `.recorder(rec)` | Attach an AgentRecorder |
| `.build()` | Returns `ParallelRunner` |

**Runner result:** `{ content, branches: BranchResult[], messages }` where each `BranchResult` carries `{ id, status, content, error? }`.

**Failure modes:** one branch throws → the failed branch surfaces as `{ status: 'rejected', error }`; the LLM merge step still runs over the remaining branches (so reduce keeps going). The `.merge(fn)` callback receives all branches including failures — you decide how to handle them. Cap at 10 branches; raise via raw footprintjs if you genuinely need more.

---

### 3. Conditional — branch on a decider (`Conditional`)

> **Like:** a triage nurse — look at the request, route to the right specialist.

`if/else` routing between runners. Predicates run in `.when()` order, first match wins; no match runs `.otherwise()`. A predicate that throws is treated as a miss (fail-open).

```typescript
import { Conditional } from 'agentfootprint';

const triage = Conditional.create({ name: 'triage' })
  .when((input) => input.toLowerCase().includes('refund'), refundAgent)
  .when((input) => input.length > 500,                      ragRunner)
  .otherwise(generalAgent)
  .build();

const result = await triage.run('I want a refund please');
// Narrative: "[triage] Chose refundAgent — predicate 0 matched"
```

**Builder API:**

| Method | Description |
|--------|-------------|
| `Conditional.create({ name? })` | Create builder |
| `.when(predicate, runner)` | Add a branch (predicate: `(input, state) => boolean`) |
| `.otherwise(runner)` | Default branch (required) |
| `.recorder(rec)` | Attach an AgentRecorder |
| `.build()` | Returns `ConditionalRunner` |

**Difference from `Agent.route()`:** `Conditional` is a top-level routing decision between runners. `Agent.route()` branches **inside** a ReAct loop. Use `Conditional` when the shape is "pick one runner and return its result" (triage, classification). Use `Agent.route()` when the routing happens mid-loop based on tool results.

**Failure modes:** all predicates miss AND no `.otherwise()` → build error. Predicate throws → silent miss (intentional fail-open); enable dev mode to see warnings on suspicious predicates.

---

## PATTERNS — named compositions

Every paper in the agent literature is a composition of 2 primitives + 3 compositions. We ship a handful as factories; see the [Patterns guide](patterns.md) for the full set with source papers. A sample:

| Pattern | Built from | Paper |
|---|---|---|
| **ReAct** | Agent (default) | Yao et al. 2022 |
| **Dynamic ReAct** | Agent with slots re-evaluating per iter | — (this library) |
| **Hierarchy (Swarm)** | Agent with specialist-Agents as tools | OpenAI Swarm 2024 |
| **Reflexion** | Sequence(Agent, LLM-critique, Agent) | Shinn et al. 2023 |
| **Tree-of-Thoughts** | Parallel(Agent × N) + LLM-rank | Yao et al. 2023 |
| **Plan-Execute** | LLM-plan + Sequence(Agent per step) | Wang et al. 2023 |
| **Map-Reduce** | Parallel(Agent × N) + LLM-merge | Dean & Ghemawat 2004 |

> **Display-name note.** Runtime class names (`SwarmRunner`, `LLMCallRunner`, `FlowChartRunner`) don't change. In prose we use display labels: "LLM", "Agent", "Sequence", "Hierarchy (Swarm)". Don't invent a new primitive class for each pattern — that's LangChain's mistake. Hierarchy is an Agent whose tools happen to be other Agents.

### Hierarchy (Swarm) — worked example

> **Like:** a project manager who reads each request and assigns it to the right specialist on the team.

Dynamic LLM-driven delegation. An orchestrator Agent decides which specialist to call based on the conversation.

**Built from:** Agent, with specialist-Agents exposed as tools (via `agentAsTool`). Not a new primitive — an Agent with a specific tool shape.

Unlike Sequence (static), Hierarchy lets the LLM decide routing at runtime by converting specialists into tools.

```typescript
import { Swarm, mock } from 'agentfootprint';
import type { RunnerLike } from 'agentfootprint';

const researcher: RunnerLike = {
  run: async (msg) => ({ content: `Research on ${msg}: findings here.` }),
};
const coder: RunnerLike = {
  run: async (msg) => ({ content: `Code: function solve() { /* ${msg} */ }` }),
};

const swarm = Swarm.create({
  provider: mock([
    {
      content: 'This needs research first.',
      toolCalls: [{ id: 'tc1', name: 'research', arguments: { message: 'quantum computing' } }],
    },
    { content: 'Here is a summary of quantum computing research.' },
  ]),
  name: 'project-manager',
})
  .system('You are a project manager. Delegate tasks to the right specialist.')
  .specialist('research', 'Deep research on any topic.', researcher)
  .specialist('code', 'Write code to solve problems.', coder)
  .maxIterations(10)
  .build();

const result = await swarm.run('Explain quantum computing');
console.log(result.content); // Orchestrator's final response
console.log(result.agents);  // Which specialists were called
```

**Builder API:**

| Method | Description |
|--------|-------------|
| `Swarm.create({ provider, name? })` | Create builder with orchestrator LLM |
| `.system(prompt)` | Set orchestrator system prompt |
| `.specialist(id, description, runner, options?)` | Register a specialist agent |
| `.tool(toolDef)` | Add a non-agent tool to the orchestrator |
| `.maxIterations(n)` | Max orchestrator loop iterations |
| `.recorder(rec)` | Attach an AgentRecorder |
| `.build()` | Returns `SwarmRunner` |

**Runner result:** `{ content, agents, totalLatencyMs }`

**Failure modes:** orchestrator hallucinates a specialist name → call returns `{ error: true }` and orchestrator sees the error, may recover or loop. Specialist throws → flows back as a tool error message; orchestrator decides what to do. Hits `maxIterations` → returns whatever the orchestrator last said. **Cost note:** every specialist invocation is also wrapped as an LLM tool call → orchestrator pays its own LLM cost on top of each specialist's cost.

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

> **Callout: RAG is context engineering, not a primitive.** `RAG.create(...)` in this library is a convenience helper that builds an LLM call with a retriever wired into its messages slot. It isn't a new kind of thing — it's a worked example of "inject retrieved chunks into the messages slot." You can do the same thing by hand in any Agent via a `MessageStrategy` that calls a retriever. *Retrieval-Augmented Generation* is the technique (Lewis et al. 2020, NeurIPS); the helper is the packaging.

Individual guides: [RAG](../../docs-site/src/content/docs/guides/rag.mdx), [Memory](../../docs-site/src/content/docs/guides/memory.mdx), [Skills](../../docs-site/src/content/docs/guides/skills.mdx), [Instructions](instructions.md), [Tools](../../docs-site/src/content/docs/guides/tools.mdx), [Grounding](../../docs-site/src/content/docs/guides/grounding.mdx).

---

## FEATURES (infrastructure)

Cross-cutting infrastructure that every primitive and composition uses. See:

- [Providers](providers.md) — LLM adapters, PromptProvider, MessageStrategy, ToolProvider
- [Recorders](recorders.md) — observability (Token, Cost, Turn, ToolUsage, Quality, Guardrail, Composite)
- [Orchestration](orchestration.md) — `withRetry`, `withFallback`, `withCircuitBreaker`
- [Security](security.md) — tool gating, permission policy, audit trail
- [Streaming](streaming.md) — real-time lifecycle events

---

## RunnerLike Interface

All runners — primitives, compositions, and pattern factories — conform to the `RunnerLike` interface. That's what makes composition work:

```typescript
interface RunnerLike {
  run(message: string, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<{ content: string }>;
  getNarrative?(): string[];
  getSnapshot?(): unknown;
}
```

Any object implementing `run(message) => { content }` plugs into any composition (Sequence / Parallel / Conditional) or any pattern factory. External services, A2A agents, and plain functions all compose naturally.

---

## Choosing the right shape

| Need | Use |
|------|-----|
| Summarization, classification, extraction | **LLM** (`LLMCall`) |
| Research, code generation, multi-step reasoning | **Agent** |
| Q&A over documents or knowledge bases | Agent + RAG context (or `RAG` helper) |
| Ordered multi-step pipelines (research then write) | **Sequence** (`FlowChart`) |
| Independent perspectives merged together | **Parallel** |
| Static if/else routing (triage, content classification) | **Conditional** |
| Dynamic LLM-driven routing across specialists | **Hierarchy (Swarm)** |
| Draft → critique → improve | Pattern: `reflexion` |
| Multiple attempts, judge picks best | Pattern: `treeOfThoughts` |
| Plan first, execute per step | Pattern: `planExecute` |
| Fan-out across N inputs, reduce | Pattern: `mapReduce` |

For the named patterns (Dynamic ReAct / Plan-Execute / Reflexion / Tree-of-Thoughts / Map-Reduce / Hierarchy), see the [Patterns guide](patterns.md).

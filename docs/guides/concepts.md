# Concepts — The Concept Ladder

agentfootprint organizes AI patterns into seven concepts, each building on the previous one. Start with the simplest concept that solves your problem — **pick the lowest rung that works, because each step adds cost and latency** — and compose up only when you need more.

```
Single-LLM
  LLMCall  → one prompt in, one response out
  Agent    → + tool-use loop (ReAct)
  RAG      → + retrieval before generation

Multi-runner composition
  FlowChart    → sequential pipeline (runner → runner → runner)
  Parallel     → fan out N runners concurrently, merge results
  Conditional  → if/else routing between runners
  Swarm        → LLM decides which specialist to call (dynamic routing)
```

**Background:** the loop concept is *ReAct* (Yao et al. 2023, ICLR — "reasoning and acting" interleaved). RAG is *Retrieval-Augmented Generation* (Lewis et al. 2020, NeurIPS). Swarm follows the orchestrator-worker pattern (popularized by OpenAI's Swarm 2024 reference implementation).

All seven share the same interface:

```typescript
// Builder: .create() → .system() → .recorder() → .build()
// Runner:  .run() → .getNarrative() → .getSnapshot() → .getSpec()
```

---

## LLMCall

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

## Agent

> **Like:** a research assistant — you ask, it looks things up, then answers.

Adds a tool-use loop (ReAct pattern). The agent calls tools repeatedly until it decides to respond.

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

## RAG

> **Like:** open-book exam — look up the relevant pages, then answer.

Adds retrieval before generation. Fetches relevant chunks from a knowledge base and injects them into the prompt.

**Internal flowchart:** `SeedScope → Retrieve → AugmentPrompt → CallLLM → ParseResponse → Finalize`

```typescript
import { RAG, mock, mockRetriever } from 'agentfootprint';

const rag = RAG.create({
  provider: mock([{ content: 'Employees receive 20 days PTO per year.' }]),
  retriever: mockRetriever([{
    query: 'PTO policy',
    chunks: [
      { content: 'Employees receive 20 days PTO per year.', score: 0.95 },
      { content: 'PTO requests must be submitted 2 weeks in advance.', score: 0.82 },
    ],
  }]),
})
  .system('Answer questions using the provided context.')
  .topK(5)
  .minScore(0.7)
  .build();

const result = await rag.run('What is our PTO policy?');
console.log(result.content); // "Employees receive 20 days PTO per year."
console.log(result.chunks);  // Retrieved chunks with scores
console.log(result.query);   // The query used for retrieval
```

**Builder API:**

| Method | Description |
|--------|-------------|
| `RAG.create({ provider, retriever })` | Create builder with LLM + retriever |
| `.system(prompt)` | Set system prompt |
| `.topK(n)` | Number of chunks to retrieve |
| `.minScore(score)` | Minimum relevance threshold |
| `.recorder(rec)` | Attach an AgentRecorder |
| `.build()` | Returns `RAGRunner` |

**Runner result:** `{ content, messages, chunks, query }`

**Custom retriever:**

```typescript
const retriever = {
  retrieve: async (query: string, options?: { topK?: number; minScore?: number }) => ({
    query,
    chunks: [{ content: 'Retrieved text...', score: 0.9 }],
  }),
};
```

**Failure modes:** retriever returns zero chunks → LLM gets an empty context block and may answer from training data (not grounded). Always inspect `result.chunks.length` for callers that require grounding. `minScore` too high → silent zero-chunk problem.

---

## FlowChart

> **Like:** an assembly line — each station does one thing, output of one feeds the next.

Composes multiple runners into a sequential pipeline. Each runner feeds into the next.

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

## Parallel

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

## Conditional

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

## Swarm

> **Like:** a project manager who reads each request and assigns it to the right specialist on the team.

Dynamic LLM-driven delegation. An orchestrator agent decides which specialist to call based on the conversation.

Unlike FlowChart (static sequential), Swarm lets the LLM decide routing at runtime by converting specialists into tools via `agentAsTool`.

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

## RunnerLike Interface

All runners conform to the `RunnerLike` interface, making them composable:

```typescript
interface RunnerLike {
  run(message: string, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<{ content: string }>;
  getNarrative?(): string[];
  getSnapshot?(): unknown;
}
```

Any object implementing `run(message) => { content }` can be used in FlowChart or Swarm. This means external services, A2A agents, or simple functions all compose naturally.

---

## Choosing the Right Concept

| Need | Use |
|------|-----|
| Summarization, classification, extraction | **LLMCall** |
| Research, code generation, multi-step reasoning | **Agent** |
| Q&A over documents or knowledge bases | **RAG** |
| Ordered multi-step pipelines (research then write) | **FlowChart** |
| Independent perspectives merged together (multi-perspective review) | **Parallel** |
| Static if/else routing (triage, content classification) | **Conditional** |
| Dynamic LLM-driven routing (customer support, project manager) | **Swarm** |

For higher-level shapes built on top of these (Plan-Execute, Reflexion, Tree-of-Thoughts, MapReduce, plus the Regular vs Dynamic ReAct loop), see the [Patterns guide](patterns.md).

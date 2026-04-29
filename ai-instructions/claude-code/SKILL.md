---
name: agentfootprint
description: Use when building Generative AI applications with agentfootprint — LLM calls, ReAct agents, multi-agent compositions (Sequence/Parallel/Conditional/Loop), context engineering (Skill/Steering/Instruction/Fact), memory (4 types × 7 strategies including Causal snapshots), tools, providers, observability, pause/resume, and patterns (Reflexion/ToT/Debate/MapReduce/Swarm). Also use when someone asks how agentfootprint works.
---

# agentfootprint — Skill

Building Generative AI applications is mostly **context engineering** — deciding what content lands in which slot of the LLM call, when, and why. agentfootprint exposes this discipline through 2 primitives + 3 compositions + 1 unifying injection primitive + 1 memory factory.

Built on [footprintjs](https://github.com/footprintjs/footPrint) — the flowchart pattern for backend code. Every agent run produces a causal trace through the same DFS traversal, so observability is "free" (no instrumentation, no post-processing).

## The 6-layer mental model

```
2 primitives        : LLMCall · Agent (= ReAct)
3 compositions+Loop : Sequence · Parallel · Conditional · Loop
N patterns          : ReAct · Reflexion · ToT · MapReduce · Debate · Swarm  (RECIPES, not classes)
Context engineering : defineSkill · defineSteering · defineInstruction · defineFact
Memory              : defineMemory({type, strategy, store}) — 4 types × 7 strategies
Production features : pause/resume · cost · permissions · observability · events
```

## Three slots × six flavors

Every LLM call has three slots, every "agent feature" is content flowing into one of them:

| LLM API field | What goes here |
|---|---|
| `system` prompt | Steering · Instruction · Skill body · Fact data · formatted memory |
| `messages` array | Conversation history · RAG chunks · memory replay · injected instructions |
| `tools` array | Tool schemas (registered + Skill-attached) |

The flavors are intent markers — all reduce to one `Injection` primitive:

| Flavor | Trigger | Slots |
|---|---|---|
| **Skill** | LLM-activated (`read_skill`) | system-prompt + tools |
| **Steering** | Always-on | system-prompt |
| **Instruction** | Predicate (`activeWhen` / `on-tool-return`) | system-prompt or messages |
| **Fact** | Always-on (data) | system-prompt or messages |

## Public API

```typescript
import {
  // Primitives + compositions
  Agent, LLMCall, defineTool,
  Sequence, Parallel, Conditional, Loop,

  // Context engineering — 4 typed factories over one Injection primitive
  defineSkill, defineSteering, defineInstruction, defineFact,

  // Memory — one factory, 4 types × 7 strategies
  defineMemory,
  MEMORY_TYPES, MEMORY_STRATEGIES, MEMORY_TIMING, SNAPSHOT_PROJECTIONS,
  InMemoryStore, mockEmbedder,

  // Providers (adapters)
  anthropic, openai, bedrock, ollama, mock,

  // Pause / resume / resilience
  askHuman, pauseHere, isPaused,
  withRetry, withFallback, resilientProvider,
} from 'agentfootprint';
```

**Top-level barrel only.** Don't import from stale subpaths
(`agentfootprint/instructions`, `agentfootprint/observe`,
`agentfootprint/security`, `agentfootprint/explain` — these are v1).

## Mock-first development (RECOMMENDED)

Build the entire agent + context engineering + tools + memory + RAG + MCP with in-memory mocks first. Validate logic and patterns end-to-end with $0 API cost. Swap real infrastructure in one boundary at a time after the flow is right.

| Mock | Production swap |
|---|---|
| `mock({ reply })` · `mock({ replies })` for scripted multi-turn | `anthropic()` / `openai()` / `bedrock()` / `ollama()` |
| `InMemoryStore` | `RedisStore` (`agentfootprint/memory-redis`) · `AgentCoreStore` (`agentfootprint/memory-agentcore`) · Dynamo · Postgres · Pinecone (planned) |
| `mockEmbedder()` | OpenAI / Cohere / Bedrock embedder factory |
| `mockMcpClient({ tools })` — in-memory, no SDK | `mcpClient({ transport })` real server |
| inline `defineTool({ execute: async () => '...' })` | real implementation |

When generating starter code, default to the mock surface unless the user explicitly says they have a key / endpoint / store ready.

## Hello agent — mock-first

```typescript
const weather = defineTool({
  schema: {
    name: 'weather',
    description: 'Current weather for a city.',
    inputSchema: {
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
    },
  },
  execute: async (args) => `${(args as { city: string }).city}: 72°F`,  // mock data
});

const agent = Agent.create({
  provider: mock({ reply: 'San Francisco: 72°F, sunny.' }),  // ← no API key
  model: 'mock',
  maxIterations: 10,
})
  .system('You are a helpful weather assistant.')
  .tool(weather)
  .build();

const result = await agent.run({ message: 'Weather in SF?' });
```

When the logic is right, swap to a real provider — one line:

```typescript
provider: anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! }),
model: 'claude-sonnet-4-5-20250929',
```

## Context engineering

```typescript
// Always-on rule (system-prompt)
const tone = defineSteering({
  id: 'tone',
  prompt: 'Be friendly and concise.',
});

// Predicate-gated
const urgent = defineInstruction({
  id: 'urgent',
  activeWhen: (ctx) => /urgent|asap/i.test(ctx.userMessage),
  prompt: 'Prioritize the fastest path to resolution.',
});

// Dynamic ReAct — fires AFTER a specific tool returned (recency-weighted slot)
const afterRedact = defineInstruction({
  id: 'after-redact',
  activeWhen: (ctx) => ctx.lastToolResult?.toolName === 'redact_pii',
  prompt: 'Use the redacted text only. Do not paraphrase the original.',
  slot: 'messages',  // higher LLM attention than system-prompt
});

// LLM-activated body + tools (auto-attaches `read_skill` activation tool)
const billing = defineSkill({
  id: 'billing',
  description: 'Use for refunds, subscriptions, invoices.',
  body: 'Confirm identity before processing refunds.',
  tools: [refundTool],
});

// Developer-supplied data (not behavior)
const userProfile = defineFact({
  id: 'user',
  data: 'User: Alice (alice@example.com), Plan: Pro.',
});

agent
  .steering(tone)
  .instruction(urgent)
  .instruction(afterRedact)
  .skill(billing)
  .fact(userProfile);
```

Every flavor emits the same `agentfootprint.context.injected` event with `source` discriminating which factory produced it.

## Memory

`defineMemory({ type, strategy, store })` — ONE factory, dispatches `type × strategy.kind` onto the right pipeline. Multiple memories layer cleanly via per-id scope keys.

```typescript
// Short-term sliding window — the 90% case
const shortTerm = defineMemory({
  id: 'short-term',
  type: MEMORY_TYPES.EPISODIC,
  strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },
  store: new InMemoryStore(),
});

// Semantic recall — vector retrieval with strict threshold
const facts = defineMemory({
  id: 'facts',
  type: MEMORY_TYPES.SEMANTIC,
  strategy: {
    kind: MEMORY_STRATEGIES.TOP_K,
    topK: 3,
    threshold: 0.7,                 // STRICT — empty when no match
    embedder: mockEmbedder(),       // swap for openaiEmbedder() in prod
  },
  store: new InMemoryStore(),
});

// Causal — UNIQUE TO AGENTFOOTPRINT.
// Persists footprintjs decision-evidence snapshots so cross-run
// "why was X rejected?" follow-ups answer from EXACT past facts
// (zero hallucination). Same data shape feeds SFT/DPO training-data
// exports in v2.1+.
const causal = defineMemory({
  id: 'causal',
  type: MEMORY_TYPES.CAUSAL,
  strategy: {
    kind: MEMORY_STRATEGIES.TOP_K,
    topK: 1,
    threshold: 0.7,
    embedder: mockEmbedder(),
  },
  store: new InMemoryStore(),
  projection: SNAPSHOT_PROJECTIONS.DECISIONS,
});

agent.memory(shortTerm).memory(facts).memory(causal);

// Multi-tenant identity — plumbs through agent.run:
await agent.run({
  message: '...',
  identity: { tenant: 'acme', principal: 'alice', conversationId: 'thread-42' },
});
```

The 4 **types**:
- `EPISODIC` — raw conversation messages
- `SEMANTIC` — extracted structured facts
- `NARRATIVE` — beats / summaries of prior runs
- `CAUSAL` — footprintjs decision-evidence snapshots ⭐

The 7 **strategies**:
- `WINDOW` (rule, last N) · `BUDGET` (decider, fit-to-tokens) · `SUMMARIZE` (LLM compresses older)
- `TOP_K` (score-threshold) · `EXTRACT` (LLM distills on write)
- `DECAY` (recency-weighted, planned) · `HYBRID` (compose multiple)

## MCP — `mcpClient` (connect to external MCP servers)

```typescript
import { Agent, mcpClient } from 'agentfootprint';

const slack = await mcpClient({
  name: 'slack',
  transport: { transport: 'stdio', command: 'npx', args: ['@example/slack-mcp'] },
});

const agent = Agent.create({ provider })
  .tools(await slack.tools())  // pull ALL tools from server in one call
  .build();

await agent.run({ message: '...' });
await slack.close();
```

Transports:
- `{ transport: 'stdio', command, args, env?, cwd? }` — local subprocess
- `{ transport: 'http', url, headers? }` — remote Streamable HTTP

The `@modelcontextprotocol/sdk` peer-dep is **lazy-required** — zero
runtime cost when MCP isn't used. Friendly install hint if missing.

`agent.tools(arr)` is the bulk-register companion to `agent.tool(t)`.
Tool-name uniqueness is validated at `.build()` across MCP servers +
manual `.tool()` calls — duplicates throw early.

Server-side support (exposing your agent as an MCP tool to other LLMs)
is a separate concern, not yet shipped.

## RAG — `defineRAG` + `indexDocuments`

```typescript
import { defineRAG, indexDocuments, InMemoryStore, mockEmbedder } from 'agentfootprint';

const store = new InMemoryStore();
const embedder = mockEmbedder();

// Seed corpus once at startup
await indexDocuments(store, embedder, [
  { id: 'doc1', content: 'Refunds processed in 3 business days.' },
  { id: 'doc2', content: 'Pro plan: $20/month.' },
]);

// Define retriever
const docs = defineRAG({
  id: 'product-docs',
  store, embedder,
  topK: 3,
  threshold: 0.7,        // STRICT — no fallback when nothing matches
  asRole: 'user',        // chunks land as user-role context
});

// Wire — `.rag()` is alias for `.memory()`, same plumbing
agent.rag(docs);
```

`defineRAG` is sugar over `defineMemory({ type: SEMANTIC, strategy: TOP_K })` with RAG-friendly defaults. Distinction is intent: RAG = document corpus retrieval; `defineMemory` = conversation/run-state memory.

## Multi-agent via control flow

There is **no** `MultiAgentSystem` class. Multi-agent = compositions of single Agents through the same control flow that connects any flowchart stages:

```typescript
// Output flows downstream
const pipeline = Sequence.create()
  .step(researcher)
  .step(writer)
  .step(editor)
  .build();

// Multi-perspective with merge
const tot = Parallel.create()
  .branch(thoughtAgent)
  .branch(thoughtAgent)
  .branch(thoughtAgent)
  .merge(rankerLLM)
  .build();

// Predicate-based routing
const triage = Conditional.create()
  .when((ctx) => ctx.intent === 'billing', billingAgent)
  .when((ctx) => ctx.intent === 'tech', techAgent)
  .otherwise(generalAgent)
  .build();

// Iterate with budget
const refine = Loop.create()
  .body(critiqueAgent)
  .untilGuard((ctx) => ctx.qualityScore > 0.9)
  .maxIterations(5)
  .build();
```

## Named patterns — recipes ship as runnable examples

```
ReAct            = Agent (default loop)
Reflexion        = Sequence(Agent, critique-LLM, Agent)
Tree-of-Thoughts = Parallel(Agent × N) + rank
Self-Consistency = Parallel(Agent × N) + majority-vote
Debate           = Loop(Agent × 2 + judge)
Map-Reduce       = Parallel(Agent × N) + merge
Swarm            = Agent whose tools are other Agents
```

Browse [`examples/patterns/`](examples/patterns/) — every pattern is a runnable end-to-end test.

## Pause / resume (HITL)

```typescript
import { askHuman, pauseHere, isPaused } from 'agentfootprint';

const approveTool = defineTool({
  schema: { name: 'approve', description: 'Ask a human.', inputSchema: { ... } },
  execute: askHuman({ severity: 'high' }),
});

const result = await agent.run({ message: 'Refund $500?' });
if (isPaused(result)) {
  const checkpoint = result.checkpoint;          // JSON-serializable
  // Persist to Redis/DB; later, on possibly different server:
  const final = await agent.resume(checkpoint, { approved: true });
}
```

## Observability — 47 typed events × 13 domains

```typescript
agent.on('agentfootprint.context.injected', (e) =>
  console.log(`[${e.payload.source}] landed in ${e.payload.slot}`));
agent.on('agentfootprint.stream.tool_start', (e) =>
  console.log(`→ ${e.payload.toolName}(${JSON.stringify(e.payload.args)})`));
agent.on('agentfootprint.agent.turn_end', (e) =>
  console.log(`[${e.payload.iterationCount} iter, tokens=${e.payload.totalInputTokens}+${e.payload.totalOutputTokens}]`));

// Wildcards work
agent.on('agentfootprint.*', (e) => log(e));
```

## Anti-patterns — Don't

- ❌ **Don't ship a `ReflexionAgent` class.** Compose `Sequence(Agent, critique-LLM, Agent)`.
- ❌ **Don't use `agent.run('string')`** — use `agent.run({ message: '...', identity? })`.
- ❌ **Don't import from stale subpaths** (`agentfootprint/instructions`, `agentfootprint/observe`, `agentfootprint/security`). Top-level barrel covers everything: `from 'agentfootprint'`.
- ❌ **Don't use `.memoryPipeline(pipeline)`** — that's the v1 API. Use `.memory(defineMemory({...}))`.
- ❌ **Don't fall back when TopK threshold returns nothing.** Strict semantics: garbage past context > none is wrong.
- ❌ **Don't store closures or class instances in scope** — TransactionBuffer can't clone functions. Memory-store entries serialize to JSON.
- ❌ **Don't add new event types per feature.** Route through `agentfootprint.context.injected` with a new `source` value.
- ❌ **Don't reach for `agentObservability()`** — it's a v1 name. Use the recorder factories: `agentRecorder({...})`, `costRecorder({...})`, etc.

## Decision tree — pick the right tool

| Goal | Use |
|---|---|
| One-shot LLM call (summarization, classification) | `LLMCall` |
| Loop with tools (research, code, anything iterative) | `Agent` |
| Two LLM calls in series with output flowing | `Sequence` |
| Multiple critics, merge with LLM | `Parallel` |
| Route to specialist by intent | `Conditional` |
| Iterate until quality bar | `Loop` |
| Output format / persona / safety policy | `defineSteering` |
| Rule that fires when predicate matches | `defineInstruction` |
| LLM activates a body of expertise + its tools | `defineSkill` |
| Inject user profile / current time / env data | `defineFact` |
| Remember last N turns of conversation | `defineMemory({ type: EPISODIC, strategy: WINDOW })` |
| Semantic recall via embeddings | `defineMemory({ type: SEMANTIC, strategy: TOP_K })` |
| Cross-run "why?" replay | `defineMemory({ type: CAUSAL, strategy: TOP_K })` ⭐ |
| Long conversation overflows context | `defineMemory({ type: EPISODIC, strategy: SUMMARIZE })` |

## Build & test

```bash
npm install agentfootprint footprintjs
npm test                           # vitest run — 1100+ tests
npm run example examples/...       # run a single example end-to-end
npm run examples:run-all           # run every example (33 of them)
```

## Roadmap (informs what to defer)

- **v2.0 (current)** — primitives + compositions + InjectionEngine + Memory (incl. Causal) + 6 providers + 33 examples
- **v2.1** — RAG flavor (`defineRAG`) · Redis memory adapter · MCP integration · CircuitBreaker · 3-tier output fallback
- **v2.2** — Governance (Policy + BudgetTracker) · DynamoDB / Postgres / Pinecone adapters
- **v2.3** — Causal training-data exports (`exportForTraining({ format: 'sft' | 'dpo' | 'process' })`)
- **v2.4+** — Deep Agents · A2A protocol · Lens UI integration

When in doubt — read [`examples/`](examples/), every file is a runnable spec.

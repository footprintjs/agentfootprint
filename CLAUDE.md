# agentfootprint — AI Coding Instructions

This is the **agentfootprint** library — a framework for building Generative AI applications where context engineering is buildable at the control-flow level. Built on [footprintjs](https://github.com/footprintjs/footPrint) (the flowchart pattern for backend code).

## Core Thesis

**Building Generative AI applications is mostly *context engineering*** — deciding what content lands in which slot of the LLM call, when, and why. agentfootprint exposes this discipline through:

- **2 primitives** — `LLMCall`, `Agent` (= ReAct loop)
- **3 compositions + Loop** — `Sequence` · `Parallel` · `Conditional` · `Loop`
- **1 unifying injection primitive** — `Injection` with 4 typed sugar factories
- **1 memory factory** — `defineMemory({ type, strategy, store })`

Every named pattern (Reflexion, ToT, Swarm, ...) is a recipe over these. **Don't ship new classes per paper.**

## The Mental Model — Three Slots, Six Flavors

Every LLM call has three slots. Every "agent feature" is content flowing into one of them:

| LLM API field | What goes here |
|---|---|
| `system` prompt | Steering · Instruction text · Skill body · Fact data · formatted memory |
| `messages` array | Conversation history · RAG chunks · memory replay · injected instructions |
| `tools` array | Tool schemas (registered + Skill-attached) |

The flavors are how you *mark intent* — but they all reduce to one `Injection` primitive:

| Flavor | Trigger | Slots |
|---|---|---|
| **Skill** | LLM-activated (`read_skill`) | system-prompt + tools |
| **Steering** | Always-on | system-prompt |
| **Instruction** | Predicate (`activeWhen` / `on-tool-return`) | system-prompt or messages |
| **Fact** | Always-on (data) | system-prompt or messages |

## Mock-first development (RECOMMENDED workflow)

Build the entire app — agent, context engineering, tools, memory, RAG, MCP — against in-memory mocks first. Validate logic and patterns end-to-end with $0 API cost. Swap real infrastructure in, one boundary at a time, only after the flow is right.

```typescript
import { Agent, mock, InMemoryStore, mockEmbedder, defineTool } from 'agentfootprint';

// Mock LLM provider — no API key, deterministic reply.
const provider = mock({ reply: 'Refunds take 3 business days.' });

// Inline-mocked tool — no real backend yet.
const lookup = defineTool({
  schema: { name: 'lookup', description: '...', inputSchema: {} },
  execute: async () => 'mock data',
});

const agent = Agent.create({ provider, model: 'mock' }).tool(lookup).build();
await agent.run({ message: 'How long does a refund take?' });
```

| Boundary | Mock for development | Production swap |
|---|---|---|
| LLM provider | `mock({ reply })` · `mock({ replies })` for scripted ReAct | `anthropic()` · `openai()` · `bedrock()` · `ollama()` (from `agentfootprint/llm-providers`) |
| Embedder | `mockEmbedder()` | OpenAI / Cohere / Bedrock embedder factory |
| Memory store | `InMemoryStore` | `RedisStore` (`agentfootprint/memory-redis`) · `AgentCoreStore` (`agentfootprint/memory-agentcore`) · DynamoDB / Postgres / Pinecone (planned) |
| MCP server | `mockMcpClient({ tools })` — in-memory, no SDK | `mcpClient({ transport })` to a real server |
| Tool execute | inline `async () => '...'` closure | real implementation |

When generating starter code for users, **default to the mock surface** unless they explicitly say they have a key / endpoint / store ready. Show real-provider code as the "swap" step, not the first step.

**Subpath imports** for memory adapters keep the main barrel small + tree-shaking clean:

```typescript
import { RedisStore } from 'agentfootprint/memory-redis';
import { AgentCoreStore } from 'agentfootprint/memory-agentcore';
```

Both lazy-require their SDK (`ioredis` / `@aws-sdk/client-bedrock-agent-runtime`) and accept `_client` for test injection.

**Multi-turn mock for tool-using ReAct:**

```typescript
const provider = mock({
  replies: [
    { toolCalls: [{ id: '1', name: 'lookup', args: { topic: 'refunds' } }] },
    { content: 'Refunds take 3 business days.' },
  ],
});
```

Each `complete()` consumes one reply in order. Exhaustion throws loud — misnumbered scripts fail tests instead of silently looping.

## Public API

### MCP — `mcpClient` (connect to MCP servers, register their tools)

```typescript
import { Agent, mcpClient } from 'agentfootprint';

const slack = await mcpClient({
  name: 'slack',
  transport: { transport: 'stdio', command: 'npx', args: ['@example/slack-mcp'] },
});

const agent = Agent.create({ provider })
  .tools(await slack.tools())  // pull ALL tools from the server in one call
  .build();

await agent.run({ message: '...' });
await slack.close();
```

Transports: `stdio` (local subprocess), `http` (Streamable HTTP). The
`@modelcontextprotocol/sdk` peer-dep is lazy-required — zero runtime
cost when MCP isn't used. Friendly install hint if missing.

`agent.tools(arr)` is the bulk-register companion to `agent.tool(t)`.
Pair with `await client.tools()` to register everything an MCP server
exposes in one builder call. Tool-name uniqueness is still validated
at `.build()` across MCP servers + manual `.tool()` calls.

### RAG — `defineRAG` (one factory, one helper)

```typescript
import {
  defineRAG, indexDocuments,
  InMemoryStore, mockEmbedder,
} from 'agentfootprint';

const embedder = mockEmbedder();
const store = new InMemoryStore();

// Seed the corpus once at startup
await indexDocuments(store, embedder, [
  { id: 'doc1', content: 'Refunds are processed within 3 business days.' },
  { id: 'doc2', content: 'Pro plan costs $20/month.' },
]);

// Define the retriever
const docs = defineRAG({
  id: 'product-docs',
  store, embedder,
  topK: 3,
  threshold: 0.7,        // STRICT — no fallback when nothing matches
  asRole: 'user',        // chunks land as user-role context (RAG default)
});

// Wire to agent — `.rag()` is an alias for `.memory()`, same plumbing
agent.rag(docs);
```

`defineRAG` is sugar over `defineMemory({ type: SEMANTIC, strategy: TOP_K })`. Same plumbing, different intent: RAG = document corpus retrieval; `defineMemory` = conversation/run-state memory.

### Agent (ReAct primitive)

```typescript
import { Agent, defineTool } from 'agentfootprint';
import { anthropic } from 'agentfootprint/llm-providers';

const agent = Agent.create({
  provider: anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! }),
  model: 'claude-sonnet-4-5-20250929',
  maxIterations: 10,
})
  .system('You are a helpful assistant.')
  .tool(weatherTool)
  .build();

const result = await agent.run({ message: 'Weather in SF?' });
```

Builder methods:
- `.system(prompt)` — base system prompt
- `.tool(definedTool)` — register a tool
- `.steering(injection)` · `.instruction(injection)` · `.skill(injection)` · `.fact(injection)` — context-engineering injections
- `.memory(definition)` — register a memory (returned by `defineMemory()`)
- `.build()` → `Agent` — runner with `.run({ message, identity? })`

### LLMCall (one-shot primitive)

```typescript
import { LLMCall } from 'agentfootprint';
import { anthropic } from 'agentfootprint/llm-providers';

const call = LLMCall.create({ provider: anthropic(...), model: 'claude-sonnet-4-5-20250929' })
  .system('You are a terse assistant.')
  .build();

const answer = await call.run({ message: 'Summarize: ...' });
```

### Tools

```typescript
import { defineTool } from 'agentfootprint';

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
  execute: async (args) => `${(args as { city: string }).city}: 72°F`,
});
```

Tool-name uniqueness is validated at `agent.build()` time across `.tool()` registrations AND every Skill's `inject.tools[]`.

### Context Engineering — 4 typed factories

All four return an `Injection` evaluated by the same engine; all emit the same `agentfootprint.context.injected` event with `source` discriminating the flavor.

```typescript
import {
  defineSkill, defineSteering, defineInstruction, defineFact,
} from 'agentfootprint';

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

### Skill graph — declarative, drawable skill routing (`skillGraph`)

`skillGraph()` is NOT a flavor — it's a builder that sets the **trigger** on a set
of **skills** (and draws the routing). It throws on a non-skill. Sugar over the
trigger model; zero engine change.

```typescript
import { skillGraph, decide, type CombinedRecorder } from 'agentfootprint';

// Flat: entry skills + routing edges
const graph = skillGraph()
  .entry(triage)                                            // trigger: always / rule
  .route(triage, sfp, { when: (r) => JSON.parse(r.result).crc > 0, label: 'CRC>0' })
  .route(triage, lookup, { onToolReturn: 'get_fcns' })     // trigger: on-tool-return
  .build();

// Decision tree: predicate nodes route to skill leaves (exactly one fires)
const tree = skillGraph()
  .tree(decide(isIo, ioSkill, decide(isSfp, sfpSkill, triage, 'sfp?'), 'io intent?'))
  .build();

agent.skillGraph(graph);                 // mount (sugar over .injection per skill)
graph.toMermaid();                       // draws itself (predicate diamonds → skill boxes)
graph.nodes; graph.edges;                // the drawn shape (for a custom renderer)
```

- `.entry(skill, { when? })` → `always` / `rule`; `.route(a, b, { when | onToolReturn })`
  → `rule` / `on-tool-return`; a bare `.route` keeps the skill's default `llm-activated`
  (model-reachable via `read_skill`, drawn dashed). `.tree(decide(...))` compiles each
  leaf to the conjunction of its root→leaf predicates (with sibling negation → exactly
  one leaf).
- **On-demand tools (the headline win):** because a `.tree()` routes to exactly ONE leaf
  per turn, each leaf is stamped `autoActivate: 'currentSkill'` **by default** — so a
  skill's `inject.tools` reach the LLM ONLY when the tree routes there, instead of every
  skill's tools landing in the always-on static registry on every call. (`read_skill`
  stays as the escape hatch.) Opt out with `.tree(root, { scopeTools: false })`; a leaf
  that sets its own `autoActivate` in `defineSkill(...)` is always respected. Flat
  `.entry()`/`.route()` graphs are **not** auto-scoped (multiple may be active) — set
  `autoActivate: 'currentSkill'` on those skills yourself if you want per-skill gating.
- **Routing provenance:** each compiled skill carries `metadata.skillGraph` (a
  `SkillRouting` — `via` + decision `path`). At run time it rides out on
  `context.evaluated.routing` (per active skill: id, path, edge label, unlocked tools),
  narrated by the `context.routed` commentary line. The lens `<SkillGraphFlow>` shows the
  same path ("REACHED WHEN").
- Lens viewer: `import { SkillGraphFlow } from 'agentfootprint-lens'` — interactive
  two-panel (graph │ click-to-inspect skill detail + decision path).

### Memory — `defineMemory({ type, strategy, store })`

ONE factory dispatches `type × strategy.kind` onto the right pipeline. Multiple memories layer cleanly via per-id scope keys (`memoryInjection_${id}`).

```typescript
import {
  defineMemory,
  MEMORY_TYPES, MEMORY_STRATEGIES, SNAPSHOT_PROJECTIONS,
  InMemoryStore, mockEmbedder,
} from 'agentfootprint';

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

// Causal — UNIQUE TO AGENTFOOTPRINT. Persists run snapshots so cross-run
// "why was X rejected?" follow-ups answer from stored past runs instead of
// re-running. HONEST STATUS: today the snapshot stores the query + final
// outcome; the operator-level decision evidence (decide() conditions, tool
// calls, token usage) is scaffolded but NOT yet wired into the snapshot —
// the evidence bridge is backlog Phase-1 #5. Don't claim "zero hallucination
// evidence replay" until it lands.
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

// Multi-tenant identity is plumbed through agent.run:
await agent.run({
  message: '...',
  identity: { tenant: 'acme', principal: 'alice', conversationId: 'thread-42' },
});
```

The 4 memory **types**:
- `EPISODIC` — raw conversation messages
- `SEMANTIC` — extracted structured facts
- `NARRATIVE` — beats / summaries of prior runs
- `CAUSAL` — footprintjs decision-evidence snapshots ⭐

The 7 **strategies**:
- `WINDOW` (rule, last N) · `BUDGET` (decider, fit-to-tokens) · `SUMMARIZE` (LLM compresses older)
- `TOP_K` (score-threshold) · `EXTRACT` (LLM distills on write)
- `DECAY` (recency-weighted, planned) · `HYBRID` (compose multiple)

### Compositions — Multi-Agent via Control Flow

There is **no** `MultiAgentSystem` class. Multi-agent = compositions of single Agents through the same control flow that connects any flowchart stages:

```typescript
import { Sequence, Parallel, Conditional, Loop } from 'agentfootprint';

// Output flows downstream — each step takes an id + a runner (Agent / LLMCall / runner)
const pipeline = Sequence.create()
  .step('research', researcher)
  .step('write', writer)
  .step('edit', editor)
  .build();

// Multi-perspective with LLM merge — each branch takes an id + a runner
const tot = Parallel.create()
  .branch('t1', thoughtAgent)
  .branch('t2', thoughtAgent)
  .branch('t3', thoughtAgent)
  .mergeWithLLM({ provider, model: 'claude-sonnet-4-5-20250929', prompt: 'Rank and synthesize.' })
  .build();

// Predicate-based routing — .when(id, predicate, runner); exactly one .otherwise(id, runner).
// predicate receives ConditionalInput { message }.
const triage = Conditional.create()
  .when('billing', (input) => /refund|invoice/i.test(input.message), billingAgent)
  .when('tech', (input) => /error|bug/i.test(input.message), techAgent)
  .otherwise('general', generalAgent)
  .build();

// Iterate with budget — .repeat(runner) sets the body, .times(n) caps iterations.
// until() guard receives { iteration, latestOutput, startMs }.
const refine = Loop.create()
  .repeat(critiqueAgent)
  .until((ctx) => /done/i.test(ctx.latestOutput))
  .times(5)
  .build();
```

### Named patterns — recipes ship as runnable examples

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

### Providers

```typescript
import { mock } from 'agentfootprint';                          // zero-peer-dep, on the main barrel
import { anthropic, openai, azureOpenai, bedrock, ollama } from 'agentfootprint/llm-providers';  // vendor-SDK-backed

// Adapter-swap testing: same agent, different provider, $0 in CI
const provider = process.env.NODE_ENV === 'production'
  ? anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  : mock({ reply: 'test response' });

// Company endpoints (3 buckets):
//  1. OpenAI-compatible (Together/Groq/OpenRouter/vLLM/LiteLLM): openai({ baseURL, apiKey })
//  2. Azure OpenAI (*.openai.azure.com — deployment-as-model, api-key, api-version):
const azure = azureOpenai({
  endpoint: process.env.OPENAI_BASE_URL,            // *.openai.azure.com
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  apiVersion: process.env.AZURE_OPENAI_API_VERSION, // 2024-12-01-preview
  deployment: process.env.MODEL_NAME,               // gpt-4o-128k (the deployment)
});  // Agent.create({ provider: azure, model: 'azure' })
//  3. Anything else: implement the LLMProvider interface (~30 lines).

// Env-driven (no branching): reads .env, detects the provider, returns it.
import { providerFromEnv } from 'agentfootprint';
const { provider: p, model } = providerFromEnv({ fallbackToMock: true });
// Azure (AZURE_OPENAI_API_KEY + endpoint) → anthropic (ANTHROPIC_API_KEY) → openai (OPENAI_API_KEY) → mock
```

Every provider implements the same `LLMProvider` interface. The vendor-SDK providers (`anthropic`, `openai`, `azureOpenai`, `bedrock`, `ollama`, plus their `*Provider` classes) live ONLY at `agentfootprint/llm-providers` (legacy alias `agentfootprint/providers`) — kept off the main barrel so bundlers never walk the lazy peer-dep requires. The main barrel exports the zero-peer-dep providers: `mock`, `browserAnthropic`, `browserOpenai`, `browserAzureOpenai`, plus the resolvers `createProvider` (by `kind`) and `providerFromEnv` (env auto-detect, Node-only). **Azure is NOT OpenAI-compatible** — use `azureOpenai()` (Node) / `browserAzureOpenai()` (browser, `api-key` header, deployment-scoped URL), not `openai({ baseURL })`. Full list + the "connect a company endpoint" buckets + `providerFromEnv()` table: [docs/guides/adapters.md](docs/guides/adapters.md).

### Pause / Resume (Human-in-the-Loop)

```typescript
import { askHuman, pauseHere, isPaused } from 'agentfootprint';

const approveTool = defineTool({
  schema: { name: 'approve', description: 'Ask a human.', inputSchema: { ... } },
  // askHuman()/pauseHere() THROW a PauseRequest — call them INSIDE execute,
  // do not assign them as the execute function.
  execute: async (args) => {
    askHuman({ question: `Approve this action?`, risk: 'high' });
    return ''; // unreachable — askHuman always throws
  },
});

const result = await agent.run({ message: 'Refund $500?' });
if (isPaused(result)) {
  const checkpoint = result.checkpoint;          // JSON-serializable
  // Persist to Redis/DB; later, on possibly different server:
  const final = await agent.resume(checkpoint, { approved: true });
}
```

### Resilience

```typescript
import { withRetry, withFallback, fallbackProvider } from 'agentfootprint/resilience';
import { anthropic, openai, ollama } from 'agentfootprint/llm-providers';

const reliable = withRetry(provider, { maxAttempts: 3 });
const resilient = withFallback(primary, fallback);
const chain = fallbackProvider(anthropic({...}), openai({...}), ollama({...}));
```

Also available: `withCircuitBreaker(provider, opts?)`. The resilience decorators live ONLY at `agentfootprint/resilience` (not the main barrel).

### Observability — 63 typed events × 17 domains

```typescript
agent.on('agentfootprint.context.injected', (e) =>
  console.log(`[${e.payload.source}] landed in ${e.payload.slot}`));
agent.on('agentfootprint.stream.tool_start', (e) =>
  console.log(`→ ${e.payload.toolName}(${JSON.stringify(e.payload.args)})`));
agent.on('agentfootprint.agent.turn_end', (e) =>
  console.log(`[${e.payload.iterationCount} iter, ${e.payload.totalInputTokens}+${e.payload.totalOutputTokens} tokens]`));
```

Wildcards: `.on('*', ...)` for every event, or `.on('agentfootprint.<domain>.*', ...)` per-domain (`agent`, `stream`, `context`, `tools`, `memory`, `cost`, `error`, …). `'agentfootprint.*'` is NOT a valid pattern — the dispatcher accepts `'*'` or `'agentfootprint.<DOMAIN>.*'` only. All events typed via `AgentfootprintEventMap`.

**"What the model saw" (debugging tool/skill selection):**
- `stream.llm_start.tools` — the tool CATALOG (`{ name, description }[]`) the model saw
  for the call (its menu); `toolsCount` reflects the dynamic set actually sent.
- `context.evaluated.skillCatalog` — the skill menu offered; `.routing` — which
  skill-graph injection activated + why (decision path / edge + unlocked tools).
- `agentThinkingTrace` surfaces both: `toolsSeen` on the ask/answer beat (AgentThinkingUI
  ≥0.10 renders "Tools the model saw (N)") + the `context.routed` lead-in.

Recorders (auto-attached when relevant builder method is called):
- `ContextRecorder` — `context.evaluated` / `context.injected` / `context.slot_composed`
- `streamRecorder` — `stream.llm_start` / `stream.llm_end` / `stream.token` / `stream.tool_start` / `stream.tool_end`
- `agentRecorder` — `agent.turn_start` / `agent.turn_end` / `agent.iteration_start` / `agent.iteration_end` / `agent.route_decided`
- `costRecorder` — `cost.tick` / `cost.limit_hit` (when `pricingTable` supplied)
- `permissionRecorder` — `permission.check` (when `permissionChecker` supplied)
- `evalRecorder` · `memoryRecorder` · `skillRecorder`

## Anti-Patterns — Don't

- ❌ **Don't ship a `ReflexionAgent` class.** Compose `Sequence(Agent, critique-LLM, Agent)`.
- ❌ **Don't use `agent.run('string')`** — use `agent.run({ message: '...', identity? })`.
- ❌ **Don't import from removed subpaths** like `'agentfootprint/instructions'` — the injection factories are on the main barrel (or `'agentfootprint/injection-engine'`). NOTE: `'agentfootprint/observe'`, `'agentfootprint/security'`, `'agentfootprint/resilience'`, `'agentfootprint/llm-providers'` ARE real, current subpaths — some symbols (e.g. `buildStepGraph`, `extractSequence`, the resilience decorators, the vendor-SDK providers) are intentionally subpath-only, NOT on the main barrel.
- ❌ **Don't use `.memoryPipeline(pipeline)`** — that's the v1 API. Use `.memory(defineMemory({...}))`.
- ❌ **Don't fall back when TopK threshold returns nothing.** Strict semantics: garbage past context > none is wrong.
- ❌ **Don't store closures or class instances in scope** — TransactionBuffer can't clone functions. Memory-store entries serialize to JSON.
- ❌ **Don't add new event types per feature.** Route through `agentfootprint.context.injected` with a new `source` value.
- ❌ **Don't reach into `getArgs()` / `getEnv()` from injection content.** Predicates run with the engine's `InjectionContext` only.

## Decision Tree — Pick the Right Tool

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
| Cross-run "what happened?" replay (decision-evidence wiring in progress — backlog #5) | `defineMemory({ type: CAUSAL, strategy: TOP_K })` ⭐ |
| Long conversation overflows context | `defineMemory({ type: EPISODIC, strategy: SUMMARIZE })` |
| Retrieve from a document corpus | `defineRAG({ store, embedder, topK, threshold })` |
| Use tools from an external MCP server | `mcpClient({ transport, ... })` + `agent.tools(await c.tools())` |

## Build & Test

```bash
npm install agentfootprint footprintjs
npm test                           # vitest run — 2000+ tests
npm run example examples/...       # run a single example end-to-end
npm run test:examples              # typecheck + run every example end-to-end
```

## Package layout

```
src/
├── core/         — Agent, LLMCall, builder methods, pause/resume
├── core-flow/    — Sequence, Parallel, Conditional, Loop
├── patterns/     — Reflexion, SelfConsistency, ToT, Debate, MapReduce, Swarm
├── lib/
│   └── injection-engine/  — Injection primitive + 4 factories + engine subflow
├── memory/       — defineMemory + 4 types × 7 strategies + InMemoryStore + Causal
├── adapters/llm/ — Anthropic, OpenAI, Bedrock, Ollama, Browser variants, Mock
├── recorders/    — context, stream, agent, cost, skill, permission, eval, memory
├── resilience/   — withRetry, withFallback, fallbackProvider, withCircuitBreaker
└── stream.ts     — SSE formatter

examples/        — 47 runnable end-to-end tests organized by DNA layer
  ├── core/                — primitives
  ├── core-flow/           — compositions
  ├── patterns/            — canonical recipes
  ├── context-engineering/ — InjectionEngine flavors
  ├── memory/              — 7 strategies
  └── features/            — pause/cost/permissions/observability/events
```

## Roadmap (informs what to defer)

- **Shipped (v3.x current)** — primitives + compositions + InjectionEngine + Memory (incl. Causal) + providers (vendor-SDK + browser + mock) + RAG (`defineRAG`) + MCP (`mcpClient`) + Redis/AgentCore memory adapters + resilience (`withRetry` / `withFallback` / `fallbackProvider` / `withCircuitBreaker`) + reliability subsystem + governance (`PermissionPolicy`) + observability subpaths (`/observe`, `/thinking`, `/locales`, `/status`)
- **Planned** — BudgetTracker · DynamoDB / Postgres / Pinecone memory adapters · Causal training-data exports (SFT / DPO / process-RL) · Deep Agents · A2A protocol · Lens UI integration

When in doubt — read [`examples/`](examples/), every file is a runnable spec.

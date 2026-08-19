# agentfootprint — Agent Instructions (OpenAI Codex)

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
| `messages` array | The conversation — user turns, assistant turns, tool results. Assembled from the conversation itself, never injected into |
| `tools` array | Tool schemas (registered + Skill-attached) |

The flavors are how you *mark intent* — but they all reduce to one `Injection` primitive:

| Flavor | Trigger | Slots |
|---|---|---|
| **Skill** | LLM-activated (`read_skill`) | system-prompt + tools |
| **Steering** | Always-on | system-prompt |
| **Instruction** | Predicate (`activeWhen` / `on-tool-return`) | system-prompt |
| **Fact** | Always-on (data) | system-prompt |

## Mock-first development (RECOMMENDED workflow)

Build the entire app — agent, context engineering, tools, memory, RAG, MCP — against in-memory mocks first. Validate logic and patterns end-to-end with $0 API cost. Swap real infrastructure in, one boundary at a time, only after the flow is right.

```typescript
import { Agent, defineTool } from 'agentfootprint';
import { mock } from 'agentfootprint/providers';
import { InMemoryStore, mockEmbedder } from 'agentfootprint/memory';

// Mock LLM provider — no API key, deterministic reply.
const provider = mock({ reply: 'Refunds take 3 business days.' });

// Inline-mocked tool — no real backend yet.
const lookup = defineTool({
  name: 'lookup',
  description: '...',
  inputSchema: { type: 'object', properties: {} },
  execute: async () => 'mock data',
});

const agent = Agent.create({ provider, model: 'mock' }).tool(lookup).build();
await agent.run({ message: 'How long does a refund take?' });
```

| Boundary | Mock for development | Production swap |
|---|---|---|
| LLM provider | `mock({ reply })` · `mock({ replies })` for scripted ReAct | `ollama('<model>')` — a real model, still $0 and no key · then `anthropic()` · `openai()` · `bedrock()` |
| Embedder | `mockEmbedder()` | OpenAI / Cohere / Bedrock embedder factory |
| Memory store | `InMemoryStore` | `RedisStore` (`agentfootprint/memory`) · `AgentCoreStore` (`agentfootprint/memory`) · DynamoDB / Postgres / Pinecone (planned) |
| MCP server | `mockMcpClient({ tools })` — in-memory, no SDK | `mcpClient({ transport })` to a real server |
| Tool execute | inline `async () => '...'` closure | real implementation |

When generating starter code for users, **default to the mock surface** unless they explicitly say they have a key / endpoint / store ready. Show real-provider code as the "swap" step, not the first step.

**Subpath imports** for memory adapters keep the main barrel small + tree-shaking clean:

```typescript
import { RedisStore } from 'agentfootprint/memory';
import { AgentCoreStore } from 'agentfootprint/memory';
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
  threshold: 0.7,        // STRICT — nothing is injected when nothing matches
});
// Retrieved chunks land in the SYSTEM-PROMPT slot, as one system message
// of citable `<source id=… doc=… score=…>` blocks.
// `asRole` was removed in 7.20.0 — it was never read, and passing it throws.

// Wire to agent — `.rag()` is an alias for `.memory()`, same plumbing
agent.rag(docs);

// No identity argument anywhere: a corpus lives in its own namespace
// (`corpus`, default `{ conversationId: '_global' }`) — the same one
// indexDocuments writes to.
await agent.run({ message: 'How long do refunds take?' });
```

**Building the index** (8.10.0) is `agentfootprint/rag`: `indexFolder('./docs', { to: store, embedder })`, or the `loadDocuments` → `splitDocuments` → `indexCorpus` pieces, or `npx agentfootprint-index ./docs --to ./corpus.db`. Loaders for text/Markdown/HTML (zero-dep) and PDF (lazy `unpdf`, per-page text so citations can name a page). Re-running embeds only what changed. `defineRAG` stays on the MAIN barrel — it is run-time wiring; that door is index time.

`defineRAG` runs on `defineMemory({ type: SEMANTIC, strategy: TOP_K })`. Same machinery, three deliberate differences: a corpus is **read-only** (it never stores the conversation), it reads under its **own namespace** rather than the run's identity, and its chunks render as **citable `<source>` blocks**. For conversation memory alongside a corpus, register both — `.rag(defineRAG(...))` and `.memory(defineMemory(...))`, each with its own store.

**Why did the agent read this passage?** `agentfootprint.memory.retrieved` carries every candidate with its score — including the ones that were rejected and why. `agentfootprint.memory.attached` fires per chunk that reached the prompt. `agentfootprint.context.injected` reports `source: 'rag'` with that chunk's `retrievalScore` / `rankPosition` / `threshold`. The whole record is on root state as `retrievalEvidence_<id>`, where a backward slice can reach it.

### Agent (ReAct primitive)

```typescript
import { Agent, defineTool } from 'agentfootprint';
import { anthropic } from 'agentfootprint/providers';

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
import { anthropic } from 'agentfootprint/providers';

const call = LLMCall.create({ provider: anthropic(...), model: 'claude-sonnet-4-5-20250929' })
  .system('You are a terse assistant.')
  .build();

const answer = await call.run({ message: 'Summarize: ...' });
```

### Tools

```typescript
import { defineTool } from 'agentfootprint';

const weather = defineTool({
  name: 'weather',
  description: 'Current weather for a city.',
  inputSchema: {
    type: 'object',
    properties: { city: { type: 'string' } },
    required: ['city'],
  },
  execute: async (args) => `${(args as { city: string }).city}: 72°F`,
});
```

Tool-name uniqueness is validated at `agent.build()` time across `.tool()` registrations AND every Skill's `inject.tools[]`.

A long-running tool can say where it is, mid-call, with `ctx.progress(payload)` —
each call files one `agentfootprint.stream.tool_progress` event between that
call's `tool_start` and `tool_end`, so a forty-second walk reads as "hop 3 of 12"
instead of silence:

```typescript
execute: async (args, ctx) => {
  for (const [i, hop] of hops.entries()) {
    await visit(hop);
    ctx.progress({ done: i + 1, total: hops.length });   // telemetry, never the model's to read
  }
  return summarize(hops);
},
```

The framework stamps `toolCallId` / `toolName` / `iteration`; `payload` is yours,
forwarded verbatim (it must survive `structuredClone`). Always present, never
throws, never blocks — with nothing listening it is a no-op, and a tool that
never calls it emits exactly what it emitted before.

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

// Dynamic ReAct — fires AFTER a specific tool returned (system slot, that turn only)
const afterRedact = defineInstruction({
  id: 'after-redact',
  activeWhen: (ctx) => ctx.lastToolResult?.toolName === 'redact_pii',
  prompt: 'Use the redacted text only. Do not paraphrase the original.',
});
// `slot: 'messages'` DELIVERS since 7.21.0 — it appends to `scope.history`, so the
// window strategies, the trace and the wire all see it. It requires a `role` (no
// default), and both wire rules can refuse: a role the provider does not carry
// inside `messages` throws at RUN START naming the provider (Anthropic-family
// drops 'system' there, OpenAI-family carries it), and a role that would repeat
// the turn at the end of the window is DEFERRED to the next boundary with a
// reason on `messagesDelivery.deferred`. Practical consequence: inside a
// tool-using loop `role: 'user'` typically never delivers (the window ends on
// the user's turn, or on tool results, which count as one) — use 'assistant', or
// return the words from the tool itself.

// LLM-activated body + tools (auto-attaches `read_skill` activation tool)
const billing = defineSkill({
  id: 'billing',
  description: 'Use for refunds, subscriptions, invoices.',
  body: 'Confirm identity before processing refunds.',
  tools: [refundTool],
});
// A declarative `skillGraph()` is fully shipped (lib/injection-engine/skillGraph.ts):
// fluent builder — .entry(skill,{when?}) .route(from,to,{when|onToolReturn}) .tree(decide(...))
// .build() + toMermaid() — or the config form skillGraph({skills, start, steps} | {skills, tree}).
// The v2 hardening ALL shipped versions ago: from-gating via currentSkillId, the scoped
// read_skill gate (toolCalls.ts), per-matcher try/catch, entry scorers (entryBy/entryByRelevance/
// entryByRead), governors + routeRecorder, and build-time validation (graph.checkup()).
// Since 8.3.0 an accepted read_skill pick really activates (and can move the cursor);
// since 8.4.0 invalid combinations refuse at build() with teaching messages, and skills the
// graph doesn't route ("open skills": llm-activated + no incoming edge) activate via read_skill
// without moving the cursor — so .selfExplain() works alongside a graph.
// Spec: docs/design/skill-graph-spec.md; guide: docs/skill-graph-guide.md.

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
// "why was X rejected?" follow-ups answer from the STORED run: decisions
// (footprintjs decide()/select() evidence + route/skill-graph provenance),
// tool calls (args + result previews), iterations, duration, token usage —
// harvested automatically by causalEvidenceRecorder when a CAUSAL memory is
// mounted. (commitLog/narrative capture: not yet — see SnapshotEntry.)
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
- `WINDOW` (rule, last N) · `BUDGET` (decider, fit-to-tokens) · `SUMMARIZE` (one LLM call folds the older entries; the summary is stored, so a span is paid for once — needs `llm` + `model`)
- `TOP_K` (score-threshold) · `EXTRACT` (LLM distills on write)
- `DECAY` (recency-weighted, planned) · `HYBRID` (compose multiple)

### Compositions — Multi-Agent via Control Flow

There is **no** `MultiAgentSystem` class. Multi-agent = compositions of single Agents through the same control flow that connects any flowchart stages:

```typescript
import { Sequence, Parallel, Conditional, Loop } from 'agentfootprint';

// Output flows downstream — every step needs an id + a runner
const pipeline = Sequence.create()
  .step('research', researcher)   // each runner is an Agent / LLMCall / composition
  .step('write', writer)
  .step('edit', editor)
  .build();

// Multi-perspective with LLM merge — branches need ids; rank via mergeWithLLM
const tot = Parallel.create()
  .branch('a', thoughtAgent)
  .branch('b', thoughtAgent)
  .branch('c', thoughtAgent)
  .mergeWithLLM({ provider, model: 'mock', prompt: 'Pick the best answer.' })
  .build();
// (or .mergeWithFn((results) => ...) to merge in code)

// Predicate-based routing — .when(id, predicate, runner); .otherwise is mandatory
const triage = Conditional.create()
  .when('billing', (input) => /refund|invoice/i.test(input.message), billingAgent)
  .when('tech', (input) => /error|bug/i.test(input.message), techAgent)
  .otherwise('general', generalAgent)
  .build();

// Iterate with a REQUIRED budget — .repeat(body) + .times(n) / .forAtMost(ms) / .until(guard)
const refine = Loop.create()
  .repeat(critiqueAgent)
  .until(({ iteration, latestOutput }) => latestOutput.includes('DONE'))
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
import { mock, anthropic, openai, bedrock, ollama } from 'agentfootprint/providers';

// The ladder: shape the logic on the mock → check it against a REAL model for
// free → pay only in production. One argument changes; the agent does not.
const provider = process.env.NODE_ENV === 'production'
  ? anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  : ollama('llama3.2');   // or mock({ reply: 'test response' }) for determinism
```

Every provider implements the same `LLMProvider` interface. `mock`,
`browserAnthropic`, `browserOpenai`, and `createProvider` ship on the main
barrel; `anthropic` · `openai` · `bedrock` · `ollama` live ONLY at
`agentfootprint/providers` so bundlers never walk the vendor-SDK requires.
Browser variants exist for client-side use.

`ollama('<model>')` is the middle rung and needs NO vendor SDK — it talks
Ollama's native API over `fetch`. Install Ollama, `ollama pull llama3.2`, done.
When it can't work it says so in words that contain the fix (`ollama serve`,
`ollama pull <model>`), never a raw connection error. `OLLAMA_MODEL=<model>`
makes `providerFromEnv()` pick it, ahead of the cloud credentials.

### Pause / Resume (Human-in-the-Loop)

```typescript
import { askHuman, pauseHere, isPaused } from 'agentfootprint';

const approveTool = defineTool({
  name: 'approve',
  description: 'Ask a human.',
  inputSchema: { type: 'object', properties: { amount: { type: 'number' } } },
  // askHuman() / pauseHere() throw a PauseRequest — CALL them inside
  // execute, don't pass them as the execute function.
  execute: async (args) =>
    askHuman({ question: `Approve $${(args as { amount: number }).amount}?` }),
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
import { withRetry, withFallback, fallbackProvider, withCircuitBreaker } from 'agentfootprint/resilience';
import { anthropic, openai, ollama } from 'agentfootprint/providers';

const reliable = withRetry(provider, { maxAttempts: 3 });
const resilient = withFallback(primary, fallback);
const chain = fallbackProvider(anthropic({...}), openai({...}), ollama('llama3.2'));
const guarded = withCircuitBreaker(provider);
```

Resilience decorators live on the `agentfootprint/resilience` subpath
(not the main barrel). Each preserves the `LLMProvider` interface and
stacks freely.

### Result primitives — an absence that names itself, a limit that travels

```typescript
import { absent, coverage } from 'agentfootprint';

// A tool that found nothing, in a shape no model can read as "I could not look".
return absent({
  what: `FLOGI entries on ${port}`,
  checked: [`${sw}: the live fcns database`, 'window: the last 24h'],
  cannotCover: [{ what: 'the peer fabric', why: 'this collector is scoped to one fabric' }],
  tryInstead: 'Ask for a different interface, or query the peer fabric by name.',
});

// A verdict with its own boundary attached.
return coverage(verdict, {
  checked: ['SRDF pair state on all 4 arrays'],
  notChecked: [{ what: 'NDM migration sessions', why: 'the API timed out' }],
  cannotCover: [{ what: 'host-side multipathing', why: 'no collector on the ESX hosts' }],
});
```

An absence carries the delivered status `'absent'` (routable by `onToolStatus`),
files `agentfootprint.tools.absent`, and grounds only its coverage in the
evidence gate. It is never an error — nothing retries or refuses it. A ledger
files `agentfootprint.tools.coverage_declared`; with
`.limitsTravelWithTheAnswer()` the framework appends the run's declared limits
to the final answer, which is how a limit survives a model that would rather not
mention it.

### Observability — 102 typed events across 22 domains

```typescript
agent.on('agentfootprint.context.injected', (e) =>
  console.log(`[${e.payload.source}] landed in ${e.payload.slot}`));
agent.on('agentfootprint.stream.tool_start', (e) =>
  console.log(`→ ${e.payload.toolName}(${JSON.stringify(e.payload.args)})`));
agent.on('agentfootprint.agent.turn_end', (e) =>
  console.log(`[${e.payload.iterationCount} iter, ${e.payload.totalInputTokens}+${e.payload.totalOutputTokens} tokens]`));
```

Wildcards: `.on('*', ...)` for every event, or `.on('agentfootprint.<domain>.*', ...)` per-domain (`agent`, `stream`, `context`, `tools`, `memory`, `cost`, `error`, …). `'agentfootprint.*'` is NOT a valid pattern — the dispatcher accepts `'*'` or `'agentfootprint.<DOMAIN>.*'` only. All events typed via `AgentfootprintEventMap`.

Recorders (auto-attached when relevant builder method is called):
- `ContextRecorder` — `context.evaluated` / `context.injected` / `context.slot_composed`
- `streamRecorder` — `stream.llm_start` / `stream.llm_end` / `stream.token` / `stream.tool_start` / `stream.tool_end`
- `agentRecorder` — `agent.turn_start` / `agent.turn_end` / `agent.iteration_start` / `agent.iteration_end` / `agent.route_decided`
- `costRecorder` — `cost.tick` / `cost.limit_hit` (when `pricingTable` supplied)
- `permissionRecorder` — `permission.check` (when `permissionChecker` supplied)
- `evalRecorder` · `memoryRecorder` · `skillRecorder`

**Observer delivery tier (RFC-001 Block 10):** `Agent.create({ observerDelivery:
'deferred' })` routes the bridge recorders above + consumer `.watch()` /
`agent.attach()` recorders through footprintjs's bounded capture queue —
capture inline (≈ µs), deliver one beat behind, drain synchronously at run
resolve / reject / pause. Default `'inline'` = byte-identical attach path, no
queue allocated. `agent.on()` listeners receive deep-equal typed events either
way (parity-tested). EXCEPTION kept inline: the causal-evidence recorder — the
memory write stage reads `collect()` MID-run. A recorder's own `delivery`
field beats the agent default (per-recorder override). Dials via
`observerDeliveryOptions` (throws without `'deferred'`); shutdown via
`agent.drainObservers({ timeoutMs })`; stats on
`getLastSnapshot()?.observerStats`. CONTRACT: typed event payloads must be
detached plain data — never pass a TypedScope read (e.g. `scope.history`, a
live deep-Proxy) into `typedEmit`; use the plain local value (`typedEmit`
dev-warns on unclonable payloads). Bench:
`examples/features/21-deferred-observers.ts`.

### Self-explain — `.selfExplain()` (the agent answers "why?" about its own last run)

One builder call mounts ONE skill that, when the user asks a why-question, unlocks the 5 trace tools (`run_overview` / `trace_node` / `who_wrote` / `get_value` / `trace_slice`) for that iteration ONLY — bound LATE to the agent's PREVIOUS COMPLETED run (captured at `onRunEnd`/`onRunFailed`, so it can never serve an in-flight run; a failed run still explains "why did you fail?"). `delegate: { provider, model }` runs the trace-walk on a cheaper model via one `explain_run` tool. Requires `reactMode: 'dynamic'`/`'dynamic-grouped'` (classic caches the tools slot → throws at build); reserved tool-name clash also throws. Differs from **Causal memory**: `.selfExplain()` = THIS conversation's last run, in-memory, drill-by-id; Causal = any past run, persisted, recalled by similarity — reach for selfExplain on same-conversation follow-ups, Causal for cross-session. Note: Causal *similarity* recall needs a store with `search()` (only `InMemoryStore` today; Redis/AgentCore lack it). Full guide: docs `debug/self-explain`.

## Anti-Patterns — Don't

- ❌ **Don't ship a `ReflexionAgent` class.** Compose `Sequence(Agent, critique-LLM, Agent)`.
- ❌ **Don't use `agent.run('string')`** — use `agent.run({ message: '...', identity? })`.
- ❌ **Don't import from non-existent subpaths** like `'agentfootprint/instructions'` — the injection factories live on the main barrel (or `'agentfootprint/context'`). NOTE: `'agentfootprint/observe'`, `'agentfootprint/security'`, `'agentfootprint/resilience'`, `'agentfootprint/providers'`, `'agentfootprint/memory'`, `'agentfootprint/providers'`, `'agentfootprint/observe'` ARE real subpaths — some surfaces (vendor providers, resilience decorators) live ONLY there, not on the main barrel.
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
| Cross-run "why?" replay | `defineMemory({ type: CAUSAL, strategy: TOP_K })` ⭐ |
| Old memories should stop coming back | `defineMemory({ type: EPISODIC, strategy: DECAY, halfLifeMs })` |
| Long conversation overflows the live window | `.compaction({ summarizer, model })` on the Agent |
| Stored recall outgrew its window | `defineMemory({ type: EPISODIC, strategy: { kind: SUMMARIZE, recent, size, llm, model } })` — folds the older entries into one stored summary; originals kept |
| Retrieve from a document corpus | `defineRAG({ store, embedder, topK, threshold })` |
| Use tools from an external MCP server | `mcpClient({ transport, ... })` + `agent.tools(await c.tools())` |

## Build & Test

```bash
npm install agentfootprint footprintjs   # footprintjs ^6 is a peer dependency
npm test                           # vitest run
npm run example examples/...       # run a single example end-to-end
npm run test:examples              # typecheck + run every example
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

examples/        — runnable end-to-end tests organized by DNA layer
  ├── core/                — primitives
  ├── core-flow/           — compositions
  ├── patterns/            — canonical recipes
  ├── context-engineering/ — InjectionEngine flavors
  ├── memory/              — 7 strategies
  └── features/            — pause/cost/permissions/observability/events
```

## Roadmap (informs what to defer)

- **v3.1 (current)** — primitives + compositions + InjectionEngine + Memory (incl. Causal) + providers + RAG (`defineRAG`) + MCP (`mcpClient`) + Redis/AgentCore memory adapters + resilience (retry / fallback / circuit breaker) + Permission policy + observability subsystem
- **Shipped since v2.0** — RAG flavor · Redis memory adapter · MCP integration · CircuitBreaker · governance (PermissionPolicy)
- **Planned** — Causal training-data exports (SFT / DPO / process-RL) · DynamoDB / Postgres / Pinecone adapters · Deep Agents · A2A protocol · Lens UI integration

When in doubt — read [`examples/`](examples/), every file is a runnable spec.

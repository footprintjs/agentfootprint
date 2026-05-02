<p align="center">
  <h1 align="center"><img width="1536" height="1024" alt="agent-footprint-logo" src="https://github.com/user-attachments/assets/a47840f4-cc8b-4bea-b88d-d9753f59616b" />
agentfootprint</h1>
  <p align="center">
    <strong>Context engineering, abstracted.</strong>
  </p>
</p>

<p align="center">
  <a href="https://github.com/footprintjs/agentfootprint/actions"><img src="https://github.com/footprintjs/agentfootprint/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://codecov.io/gh/footprintjs/agentfootprint"><img src="https://codecov.io/gh/footprintjs/agentfootprint/branch/main/graph/badge.svg" alt="Coverage"></a>
  <a href="https://www.npmjs.com/package/agentfootprint"><img src="https://img.shields.io/npm/v/agentfootprint.svg?style=flat" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/agentfootprint"><img src="https://img.shields.io/npm/dm/agentfootprint.svg" alt="Downloads"></a>
  <a href="https://github.com/footprintjs/agentfootprint/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT"></a>
</p>

<br>

> **PyTorch's autograd abstracted gradient computation. Express abstracted the HTTP request loop. Prisma abstracted SQL CRUD. Kubernetes abstracted reconciliation. React abstracted the DOM.**
>
> Every load-bearing dev tool of the last decade is *the same kind of move* — abstract one specific kind of bookkeeping that practitioners were doing by hand, so they can spend their attention on intent instead of plumbing.
>
> **agentfootprint is that move applied to context engineering** — the discipline of deciding what content lands in which slot of an LLM call, when, and why. You describe injections declaratively. The framework evaluates every trigger every iteration, composes the `system` / `messages` / `tools` slots, observes every decision as a typed event, and persists checkpoints you can replay six months later. So you write the **intent**, not 200 lines of slot-management bookkeeping per agent.

| Framework | You write declaratively | The framework abstracts |
|---|---|---|
| **PyTorch (autograd)** | Forward computation graph | Gradient computation, backward pass, parameter bookkeeping |
| **Express / Fastify** | Routes + handlers | HTTP request loop, middleware chain, response serialization |
| **Prisma / SQLAlchemy** | Schema + query intent | SQL generation, connection pooling, migrations |
| **Kubernetes** | Desired state (manifests) | Scheduling, health checks, reconciliation loop |
| **React** | Components + state | DOM diffing, render path, event delegation |
| **agentfootprint** | Injections (slot × trigger × cache) | Slot composition, iteration loop, prompt caching, observation, replay |

The closest structural parallel is **autograd**: you describe the graph, the framework traverses it, and *because the framework owns the traversal it can record everything that happens for free*. Same idea here — you describe Injections, agentfootprint runs the iteration loop, and the typed-event stream + replayable checkpoints + provider-agnostic prompt caching are consequences, not extra features.

---

## Why it's shaped this way — two pillars

The abstraction lineage above tells you *what* this library is. The two pillars below explain *why* it's structured the way it is. Neither is decorative — both are operationalized in the runtime.

### THE WHY — connected data (the user-visible win)

Palantir's 2003 thesis: enterprise insight is bottlenecked by **data fragmentation**, not analyst skill. Connecting siloed data into one ontology collapses weeks of manual correlation into minutes.

LLM agents face the same fragmentation problem at *runtime*. Disconnected tool state, lost decision evidence, scattered execution context — the agent re-discovers relationships every iteration, burning tokens. agentfootprint connects four classes of agent data so the next token compounds the connection instead of paying for it again:

| Class | Mechanism |
|---|---|
| **State** | `TypedScope<S>` — single typed shared state, every read/write tracked |
| **Decisions** | `decide()` evidence — every branch carries the inputs that triggered it |
| **Execution** | `commitLog` + `runtimeStageId` — every state mutation keyed to its writing stage |
| **Memory** | Causal memory — full footprintjs snapshots persisted, cosine-matched on follow-up runs |

**Connected data → fewer iterations → fewer tokens.** Same arithmetic Palantir was attacking in 2003, different decade, different layer.

### THE HOW — modular boundaries (the engineering discipline)

Liskov's ADT (1974) and LSP (1987) work gives a vocabulary for boundaries that don't leak. Every framework boundary in agentfootprint is an LSP-substitutable interface — `LLMProvider`, `ToolProvider`, `CacheStrategy`, `Recorder`, `MemoryStore` — so you can swap implementations without changing agent code. Subflows are CLU clusters with explicit input/output mappers; nothing leaks across the boundary.

Together: **clean modules + connected data = a runtime that's both fast (Palantir multiplier) and reasonable (Liskov locality).** Boundaries alone produce a clean but dumb library. Connections alone produce a fast but unmaintainable one.

Detailed write-ups: [`docs/inspiration/`](./docs/inspiration/) — *"Connected Data — the Palantir lineage"* and *"Modularity — the Liskov lineage"*. Not required reading for using the library; required reading for extending or evaluating it.

---

## The abstraction, concretely

### Without agentfootprint — context engineering by hand

```typescript
async function runAgentTurn(userMsg, state) {
  let systemPrompt = baseSystem;
  const messages = [...state.history, { role: 'user', content: userMsg }];
  let activeTools = [...baseTools];

  // 1. Apply always-on steering rules
  for (const rule of steeringRules) systemPrompt += '\n' + rule.text;

  // 2. Evaluate conditional instructions
  for (const inst of instructions) {
    if (inst.activeWhen(state)) systemPrompt += '\n' + inst.prompt;
  }

  // 3. Check on-tool-return triggers
  if (state.lastToolResult?.toolName === 'redact_pii') {
    messages.push({ role: 'system', content: 'Use redacted text only.' });
  }

  // 4. Resolve LLM-activated skills
  for (const id of state.activatedSkills) {
    systemPrompt += '\n' + skills[id].body;
    activeTools.push(...skills[id].tools);
  }

  // 5. Load + format memory for this tenant
  const memEntries = await store.list({ tenant, conversationId });
  messages.unshift({ role: 'system', content: formatMemory(memEntries.slice(-10)) });

  // 6. Decide what's cacheable; place provider-specific cache_control markers...
  // 7. Call LLM, route tool calls, loop, capture state for resume...
  // 8. Persist new turn back to memory tagged with identity...
  // 9. Wire SSE for streaming, attach observability hooks...

  // No replay. No audit trail. Per agent, hundreds of lines.
  // Every refactor risks a slot-ordering bug nobody catches until prod.
}
```

### With agentfootprint — declarative

```typescript
const agent = Agent.create({ provider, model: 'claude-sonnet-4-5-20250929' })
  .system('You are a support assistant.')
  .steering(toneRule)            // always-on
  .instruction(urgentRule)       // rule-gated
  .skill(billingSkill)           // LLM-activated
  .memory(conversationMemory)    // cross-run, multi-tenant
  .tool(weather)
  .build();

await agent.run({ message: userInput, identity: { conversationId } });

// Every iteration is a replayable typed event stream — for free.
agent.on('agentfootprint.context.injected', (e) =>
  console.log(`[${e.payload.source}] landed in ${e.payload.slot}`));
```

Same agent. The hand-rolled version is ~80 lines and growing; the declarative version is ~8 and stable. **The framework owns the wiring** — which is exactly why it can observe, replay, audit, and cache it for you.

---

## In 30 seconds — runs offline, no API key

```bash
npm install agentfootprint footprintjs
```

```typescript
import { Agent, defineTool, mock } from 'agentfootprint';

const weather = defineTool({
  name: 'weather',
  description: 'Get current weather for a city.',
  inputSchema: {
    type: 'object',
    properties: { city: { type: 'string' } },
    required: ['city'],
  },
  execute: async ({ city }: { city: string }) => `${city}: 72°F, sunny`,
});

const agent = Agent.create({
  provider: mock({ reply: 'I checked: it is 72°F and sunny.' }),  // ← deterministic, no API key
  model: 'mock',
})
  .system('You answer weather questions using the weather tool.')
  .tool(weather)
  .build();

const result = await agent.run({ message: 'Weather in Paris?' });
console.log(result);  // → "I checked: it is 72°F and sunny."
```

Swap `mock(...)` for `anthropic(...)` / `openai(...)` / `bedrock(...)` / `ollama(...)` for production. Nothing else changes.

---

## The mental model — three slots, four triggers, one Injection

Every LLM call has three slots. **Every "agent feature" — Skill, Steering doc, Instruction, Fact, Memory replay, RAG chunk — is content flowing into one of them, under one of four triggers.** That's the entire abstraction.

```
                       ┌─────────────────────────────────────┐
                       │                                     │
                       │    Your LLM call has 3 slots:       │
                       │                                     │
                       │    system    messages    tools      │
                       │       ▲          ▲          ▲       │
                       └───────┼──────────┼──────────┼───────┘
                               │          │          │
                               │   one    │   one    │
                               │ Injection│ Injection│
                               │  fires…  │  fires…  │
                               │          │          │
                ┌──────────────┴────┐  ┌──┴───┐  ┌──┴────┐
                │ defineSteering     │  │ ...  │  │ ...   │
                │ defineInstruction  │  │      │  │       │
                │ defineSkill        │  │      │  │       │
                │ defineFact         │  │      │  │       │
                │ defineMemory(read) │  │      │  │       │
                │ defineRAG          │  │      │  │       │
                │   …your next idea  │  │      │  │       │
                └────────────────────┘  └──────┘  └───────┘
                          ▲
                   …under one of:
                  always · rule · on-tool-return · llm-activated
```

There's no fourth slot. There won't be. Every named pattern in the agent literature — Reflexion, Tree-of-Thoughts, Skills, RAG, Constitutional AI — reduces to *which slot* + *which trigger*. **You learn one model; the field's growth lands as new factories on the same primitive.**

### The four triggers — *who decides* this injection is needed right now?

| Trigger | Who decides | Fires when | Real-world example |
|---|---|---|---|
| `always` | nobody (always on) | Every iteration, every turn | *"Be friendly and concise."* — `defineSteering` |
| `rule` | **you**, via predicate | A `(ctx) => boolean` you wrote returns true | *"If user wrote 'urgent', prioritize fastest path."* — `defineInstruction({ activeWhen })` |
| `on-tool-return` | **the system** | A specific tool just returned (recency-first injection on the next iteration) | *"After `redact_pii` ran, use redacted text only."* — Dynamic ReAct |
| `llm-activated` | **the LLM** | The LLM called your activation tool (e.g. `read_skill('billing')`) | Skill body + unlocked tools land next iteration — `defineSkill` |

Why exactly four? Because *who decides activation* is a closed axis: nobody / the developer / the system / the LLM. Together those four exhaust the meaningful "when does this content matter?" cases. A fifth would require introducing a new agent of decision — and there isn't one. That's why the primitive surface stays this small even as named patterns proliferate above it.

---

## Why this isn't just an ergonomics win — Dynamic ReAct

The React parallel goes one layer deeper than "less code." Because the framework owns the loop, **the framework recomposes the prompt + tool list every iteration based on what just happened.** That's what we call **Dynamic ReAct** — and it's the thing other agent frameworks don't do.

| You write declaratively | The framework does for you, **every iteration** |
|---|---|
| `.steering(rule)` | Evaluates every iteration, composes into `system` slot |
| `.instruction(activeWhen, prompt)` | Re-evaluates predicate per iteration; routes to `system` or `messages` for attention positioning |
| `.skill(billing)` | Auto-attaches `read_skill` tool; LLM activates by id; body + unlocked tools land in next iteration |
| `.memory(causal)` | Persists footprintjs decision-evidence snapshots; embeds queries; cosine-matches on follow-up runs |
| `.tool(weather)` | Schemas to LLM, dispatches calls, captures args/results, gates by permission policy |
| `.attach(recorder)` | Subscribes to typed events across many domains as the chart traverses |
| `agent.run({...})` | Captures every decision, every commit, every tool call as a JSON checkpoint that's replayable cross-server |

LangChain assembles prompts once per turn. LangGraph composes state per node, not per loop iteration. CrewAI's Agent is tool-aware but not iteration-aware. **Per-iteration recomposition of all three slots based on the latest tool result + accumulated state is structurally distinct.** Frameworks that compose state per-node rather than per-loop-iteration can't recompute cache markers in lockstep with the active injection set — the structural prerequisite for the cache layer below.

### What "every iteration" makes possible

| Use case | The mechanism |
|---|---|
| **Tool-by-tool LLM steering** — agent called `redact_pii` → next iter, system prompt gets *"use redacted text, don't paraphrase original"* | `defineInstruction({ activeWhen: (ctx) => ctx.lastToolResult?.toolName === 'redact_pii' })` |
| **Adaptive tool exposure** — agent activated `billing` skill → next iter, tool list switches to billing-only set (3× context-budget reduction) | `defineSkill({...})` + LLM-activated trigger |
| **Cost guardrails** — accumulated cost > threshold → next iter, system prompt adds *"be concise"* | `defineInstruction({ activeWhen: (ctx) => ctx.accumulatedCostUsd > 0.50 })` |
| **Iterative format refinement** — iter 1 emitted JSON → iter 2 prompt adds *"continue this format"*; iter 5 prompt drops it | predicate over `ctx.iteration` + `ctx.history` |
| **Failure adaptation** — tool X returned an error → next iter, prompt adds *"don't try X again; use Y"* | `on-tool-return` predicate inspecting `ctx.lastToolResult` for error markers |
| **Few-shot evolution** — iter 1 prompt has example for the rare case → iter 2 drops it because example is consumed | predicate that tracks which examples have already fired |

The framework owns the loop. The framework re-evaluates triggers every iteration. Tool results reshape the next iteration's prompt. **That's what makes context engineering compositional instead of static.**

**The flowchart-pattern substrate** ([footprintjs](https://github.com/footprintjs/footPrint)) is what makes the observation automatic. Every stage execution is a typed event during one DFS traversal — no instrumentation, no post-processing. Same way React DevTools shows you the component tree because React owns the render path, agentfootprint shows you the slot composition because agentfootprint owns the prompt path.

### When to use Dynamic ReAct

Use it when **your tools have dependencies** — when one tool's output implies which tool to call next.

A skill body like *"if `get_port_errors` reports CRC > 0, call `get_sfp_diag` next; if it reports `signal_loss`, call `get_flogi` next"* IS a dependency graph. The skill encodes the workflow; Dynamic ReAct gates the tool surface to that workflow at runtime.

If your tools are independent (the LLM can call any of them at any time, ordering doesn't matter), Classic ReAct is fine and simpler — don't reach for Skills.

### Side-by-side example

[`examples/dynamic-react/`](./examples/dynamic-react/) ships two mock-backed scripts solving the same task. Per-iteration tool-count progression makes the shape clear:

```
Classic ReAct                    Dynamic ReAct
───────────────                  ─────────────
iter 1: 12 tools shown           iter 1: 1 tool  (read_skill)
iter 2: 12 tools shown           iter 2: 5 tools (skill activated)
iter 3: 12 tools shown           iter 3: 5 tools
iter 4: 12 tools shown           iter 4: 5 tools
                                 iter 5: 5 tools (final answer)
```

The unactivated skills' tools never enter the LLM context. Classic ReAct has no equivalent — every registered tool ships on every call.

What Dynamic gives you that Classic doesn't:

1. **Constant per-call payload** bounded by active-skill size, not registry size. Scales to 50+ tool catalogs.
2. **Deterministic routing** — `read_skill` forces scope before data tools fire. LLM can't drift to off-topic tools.
3. **Auditability** — each iteration's tool list is a pure function of `activatedInjectionIds`. Recorded, replayable, diff-able across runs.
4. **Less hallucination** — fewer tools per call = more in-distribution on the active task.

> **Compounds with the cache layer (next section).** Because the framework owns both the per-iteration slot recomposition AND the cache marker placement, cache invalidation tracks the live skill state — when a skill deactivates, only its prefix invalidates; the rest of the cached system prompt stays warm.

Run it:

```sh
TSX_TSCONFIG_PATH=examples/runtime.tsconfig.json npx tsx examples/dynamic-react/01-classic-react.ts
TSX_TSCONFIG_PATH=examples/runtime.tsconfig.json npx tsx examples/dynamic-react/02-dynamic-react.ts
```

---

## The cache layer — provider-agnostic prompt caching

Anthropic gives you `cache_control` blocks. OpenAI auto-caches. Bedrock has its own format. Each provider's docs are 30+ pages, the wire formats are different, and the right cache placement depends on what's stable across iterations vs what's volatile.

agentfootprint gives you **one declarative API across all three** (and a `NoOp` wildcard for the rest). You annotate intent at the injection level; the framework computes the cacheable boundary every iteration; per-provider strategies translate to the right wire format.

### Declarative cache directives

Every injection factory has a `cache:` field. Four forms:

| Policy | Meaning |
|---|---|
| `'always'` | Cache whenever this injection is in `activeInjections`. |
| `'never'` | Never cache — volatile content (timestamps, per-request IDs). |
| `'while-active'` | Cache while the injection is active; invalidates the moment it becomes inactive. |
| `{ until: ctx => boolean }` | Predicate-driven invalidation (Turing-complete escape hatch). |

**Smart defaults per factory** — most consumers never write `cache:` explicitly:

```typescript
defineSteering({ id: 'tone',     prompt: '...' });                          // default: 'always'
defineFact({     id: 'profile',  data: '...' });                            // default: 'always'
defineSkill({    id: 'billing',  body: '...', tools: [...] });              // default: 'while-active'
defineInstruction({ id: 'urgent', activeWhen: ..., prompt: '...' });         // default: 'never'
defineMemory({   id: 'causal',   type: MEMORY_TYPES.CAUSAL, ... });          // default: 'while-active'
```

For composition beyond the four sentinels, use the predicate form:

```typescript
// Stable for the first 5 iterations, then flush:
defineSteering({ id: 'examples', prompt: '...', cache: { until: ctx => ctx.iteration > 5 } });

// Invalidate when cumulative spend exceeds budget:
defineFact({ id: 'rules', data: '...', cache: { until: ctx => ctx.cumulativeInputTokens > 50_000 } });
```

### What the framework does every iteration

1. **`CacheDecisionSubflow`** walks `activeInjections`, evaluates each one's cache directive, and emits provider-independent `CacheMarker[]`.
2. **`CacheGate decider`** uses footprintjs `decide()` with three rules — kill switch, hit-rate floor (skip when recent hit-rate < 0.3), skill-churn (skip when ≥3 unique skills in the last 5 iters). Decision evidence captured for free.
3. **The active provider strategy** (registered automatically per `LLMProvider.name`) translates markers to wire format:
   - `AnthropicCacheStrategy` → `cache_control` on system blocks (4-marker clamp)
   - `OpenAICacheStrategy` → no-op writes (auto-cached); extracts metrics from `prompt_tokens_details.cached_tokens`
   - `BedrockCacheStrategy` → model-aware (Anthropic-style for Claude, pass-through else)
   - `NoOpCacheStrategy` → wildcard fallback
4. **`cacheRecorder`** emits typed events: hit rate, fresh-input tokens, cache-read tokens, cache-write tokens, markers applied. Same observability surface as every other event domain.

For the per-iteration cache invalidation walkthrough and the full benchmark numbers, see [`docs/guides/caching.md`](./docs/guides/caching.md).

### When to use it

Always — it's on by default. The smart defaults handle 80% of cases.

To audit it:

```typescript
import { cacheRecorder } from 'agentfootprint';

agent.attach(cacheRecorder({ onTurnEnd: (m) => console.log(m) }));
// → { hitRate: 0.71, freshInput: 1240, cacheRead: 9180, cacheWrite: 0, markersApplied: 2 }
```

To opt out globally for a specific run:

```typescript
const agent = Agent.create({ provider, caching: 'off', ... }).build();
```

---

## What you can build

Three example shapes, all runnable end-to-end with `npm run example examples/<file>.ts`.

### Customer support agent (skills + memory + audit trail + cache)

```typescript
const agent = Agent.create({ provider, model: 'claude-sonnet-4-5-20250929' })
  .system('You are a friendly support assistant.')
  .skill(billingSkill)        // LLM activates with read_skill('billing'); cached while active
  .steering(toneGuidelines)   // always-on; cached forever
  .memory(conversationMemory) // remembers across .run() calls, per-tenant
  .build();
```

→ [`examples/context-engineering/06-mixed-flavors.ts`](examples/context-engineering/06-mixed-flavors.ts)

### Research pipeline (multi-agent fan-out + merge)

```typescript
const research = Parallel.create()
  .branch(optimist).branch(skeptic).branch(historian)
  .merge(synthesizer)
  .build();

await research.run({ message: 'Should we adopt microservices?' });
```

→ [`examples/patterns/05-tot.ts`](examples/patterns/05-tot.ts) (Tree-of-Thoughts) · [`examples/patterns/01-self-consistency.ts`](examples/patterns/01-self-consistency.ts)

### Streaming chat agent (token-by-token to a browser)

```typescript
import express from 'express';
import { toSSE } from 'agentfootprint';

app.get('/chat', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  agent.on('agentfootprint.stream.token',     (e) => res.write(toSSE(e)));
  agent.on('agentfootprint.stream.tool_start', (e) => res.write(toSSE(e)));
  agent.on('agentfootprint.stream.tool_end',   (e) => res.write(toSSE(e)));
  await agent.run({ message: req.query.message as string });
  res.end();
});
```

---

## The differentiator: the trace is a cache of the agent's thinking

Other agent frameworks' memory remembers *what was said*. agentfootprint's `defineMemory({ type: CAUSAL })` records the **decision evidence** — every value the agent's flowchart captured during the run, persisted as a JSON-portable snapshot.

That changes the cost structure of *everything that happens after the agent runs.* The expensive thinking happened once; the recorded trace makes consuming that thinking cheap, three different ways:

### 1. Audit / explain — cross-run, six months later, exact past facts

```typescript
const causal = defineMemory({
  id: 'causal',
  type: MEMORY_TYPES.CAUSAL,
  strategy: { kind: MEMORY_STRATEGIES.TOP_K, topK: 1, threshold: 0.7, embedder },
  store,
  projection: SNAPSHOT_PROJECTIONS.DECISIONS,  // inject "why" only, not "what"
});

// Monday: agent decides loan #42 should be rejected (creditScore=580, threshold=600).
// Friday: user asks "Why was my application rejected?"
// → Causal memory loads the exact decision evidence from Monday.
// → LLM answers from the SOURCE, not reconstruction.
```

→ [`examples/memory/06-causal-snapshot.ts`](examples/memory/06-causal-snapshot.ts) — runs end-to-end with mock embedder, ~50 lines.

### 2. Cheap-model triage — the trace *is* the reasoning

A trace recorded from your expensive production model (Sonnet-4, GPT-4) is a perfectly good *input* for a small, fast, cheap model (Haiku, GPT-4o-mini) answering follow-up questions about that run. The expensive model already did the work; the cheap model just **reads what's in the trace**.

Reading recorded decision evidence is structurally simpler than re-deriving the answer from first principles — so a smaller model is enough. You can compose the routing yourself: when causal memory injected a snapshot on the next turn, send that turn to a cheaper provider.

```typescript
const heavy = anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const cheap = anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// Production turn — heavy model, full reasoning, snapshot persisted.
const productionAgent = Agent.create({ provider: heavy, model: 'claude-sonnet-4-5-20250929' })
  .memory(causal)
  .build();
await productionAgent.run({ message: 'Should we approve loan #42?', identity });

// Follow-up turn — cheaper model reads the snapshot, lower cost per turn.
const followUpAgent = Agent.create({ provider: cheap, model: 'claude-haiku-4-5-20251001' })
  .memory(causal)
  .build();
await followUpAgent.run({ message: 'Why was loan #42 rejected?', identity });
```

This is memoization for agent reasoning — do the expensive work once, serve many queries from the cached result. Across a production system that handles audit / explain / "why did the agent do X?" traffic, this is real money.

### 3. Training data — every successful run becomes a labeled trajectory

The same snapshot data shape is the input to SFT / DPO / process-RL training pipelines (`causalMemory.exportForTraining({ format: 'sft' | 'dpo' | 'process' })` is on the roadmap). You don't run a separate data-collection phase — **your production traffic IS your training set.** Every successful customer interaction is a positive trajectory; every escalation or override is a counter-example.

The same JSON shape that powered the audit trail and the cheap-model follow-up is the training payload. One recording, three downstream consumers, no extra instrumentation.

---

## Mocks first, prod second

Generative AI development is expensive when every iteration hits a paid API. agentfootprint is designed so you build the entire app — agent, context engineering, memory, RAG — against in-memory mocks, prove the logic end-to-end with **zero API cost**, then swap real infrastructure in one boundary at a time.

| Boundary | Dev (mock) | Prod (swap one line) |
|---|---|---|
| LLM provider | `mock({ reply })` · `mock({ replies })` for scripted multi-turn | `anthropic()` · `openai()` · `bedrock()` · `ollama()` |
| Embedder | `mockEmbedder()` | OpenAI / Cohere / Bedrock embedder (factories on roadmap) |
| Memory store | `InMemoryStore` | `RedisStore` (`agentfootprint/memory-redis`) · `AgentCoreStore` (`agentfootprint/memory-agentcore`) · DynamoDB / Postgres / Pinecone (planned) |
| MCP server | `mockMcpClient({ tools })` — in-memory, no SDK | `mcpClient({ transport })` to a real server |
| Tool execution | inline closure | real implementation |
| Cache strategy | `NoOpCacheStrategy` (when `mock` provider) | Auto-selected by provider: `AnthropicCacheStrategy` / `OpenAICacheStrategy` / `BedrockCacheStrategy` |

The flowchart, recorders, narrative, and tests don't change between dev and prod. **Ship the patterns first; pay for tokens last.**

---

## Pick your starting door

| If you are... | Start here |
|---|---|
| 🎓 **New to agents** | [5-minute Quick Start](https://footprintjs.github.io/agentfootprint/getting-started/quick-start/) → first agent runs offline |
| 🛠️ **A LangChain / CrewAI / LangGraph user** | [Migration sketch](https://footprintjs.github.io/agentfootprint/getting-started/vs/) — same patterns, fewer classes |
| 🏗️ **Architecting an enterprise rollout** | [Production guide](https://footprintjs.github.io/agentfootprint/guides/deployment/) — multi-tenant identity, audit trails, redaction, OTel |
| 🏛️ **Doing production due diligence** | [Architecture page](https://footprintjs.github.io/agentfootprint/architecture/dependency-graph/) — 8-layer stack, hexagonal ports, the conventions SSOT |
| 💡 **Curious about the design philosophy** | [Inspiration](./docs/inspiration/) — Palantir-style connected data + Liskov-style modular boundaries |
| 🔬 **Researcher / extending the framework** | [Extension guide](https://footprintjs.github.io/agentfootprint/contributing/extension-guide/) — add a new flavor in 50 lines |

Every code snippet on the docs site is imported from a real, runnable file in [`examples/`](examples/) — every example is also an end-to-end test in CI. There is no docs-only code in this repo.

---

## What ships today

- **2 primitives** — `LLMCall`, `Agent` (the ReAct loop)
- **4 compositions** — `Sequence`, `Parallel`, `Conditional`, `Loop`
- **7 LLM providers** — Anthropic · OpenAI · Bedrock · Ollama · Browser-Anthropic · Browser-OpenAI · Mock (with `mock({ replies })` for scripted multi-turn)
- **One Injection primitive** — `defineSkill` / `defineSteering` / `defineInstruction` / `defineFact` (one engine, four typed factories, all reduce to `{ trigger, slot, cache }`)
- **One Memory factory** — `defineMemory({ type, strategy, store })` — 4 types × 7 strategies including **Causal**
- **Provider-agnostic prompt caching** — declarative `cache:` field per injection · per-iteration marker recomputation via `CacheDecisionSubflow` · registered strategies for Anthropic / OpenAI / Bedrock with `NoOp` wildcard fallback · `cacheRecorder` for hit-rate observability
- **RAG** — `defineRAG()` + `indexDocuments()` (sugar over Semantic + TopK)
- **MCP** — `mcpClient({ transport })` for real servers · `mockMcpClient({ tools })` for in-memory development
- **Memory store adapters** — `InMemoryStore` · `RedisStore` (subpath `agentfootprint/memory-redis`) · `AgentCoreStore` (subpath `agentfootprint/memory-agentcore`)
- **48+ typed observability events** across context · stream · agent · cost · skill · permission · eval · memory · cache · embedding · error · …
- **Chat-bubble status surface** — `agent.enable.thinking({ onStatus })` for one-callback Claude-Code-style updates · `agentfootprint/status` subpath (`selectThinkingState` · `renderThinkingLine` · `defaultThinkingTemplates`) for custom UIs with per-tool template overrides + locale switching — see [`examples/features/06-status-subpath.md`](./examples/features/06-status-subpath.md)
- **Pause / resume** — JSON-serializable checkpoints; pause via `askHuman` / `pauseHere`, resume hours later on a different server
- **Resilience** — `withRetry`, `withFallback`, `resilientProvider`
- **AI-coding-tool support** — bundled instructions for Claude Code · Cursor · Windsurf · Cline · Kiro · Copilot (see `ai-instructions/`)
- **Runnable examples** organized by DNA layer (core · core-flow · patterns · context-engineering · memory · features) — every example is also an end-to-end CI test

## What's next (clearly marked roadmap)

| Theme | Focus |
|---|---|
| **Reliability subsystem** | `CircuitBreaker` · 3-tier output fallback · auto-resume-on-error · Skills upgrades (`surfaceMode`, `refreshPolicy`) · `MockEnvironment` composer |
| **Causal training-data exports** | `causalMemory.exportForTraining({ format: 'sft' \| 'dpo' \| 'process' })` — production traffic becomes labeled SFT / DPO / process-RL trajectories |
| **Governance** | `Policy` · `BudgetTracker` · DynamoDB / Postgres / Pinecone memory adapters · production embedder factories |
| **Cache layer v2** | Gemini handle-based caching · automatic provider routing based on causal-memory state · `cacheRecorder` cost-attribution |
| **Deep Agents · A2A protocol** | Planning-before-execution · agent-to-agent protocol · Lens UI deep-link |

For shipped features per release see [CHANGELOG.md](./CHANGELOG.md). Roadmap items are *not* claims about the current API — if a feature isn't in `npm install agentfootprint` today, it's listed here, not in the documentation.

---

## Built on

[footprintjs](https://github.com/footprintjs/footPrint) — the flowchart pattern for backend code. The decision-evidence capture, narrative recording, and time-travel checkpointing this library uses are footprintjs primitives. The same way autograd's forward-pass traversal is what makes gradient inspection automatic, footprintjs's flowchart traversal is what makes agentfootprint's typed-event stream and replayable traces automatic. You don't need to learn footprintjs to use agentfootprint — but if you want to build your own primitives at this depth, [start there](https://footprintjs.github.io/footPrint/).

## License

[MIT](./LICENSE) © [Sanjay Krishna Anbalagan](https://github.com/sanjay1909)

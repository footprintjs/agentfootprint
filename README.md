<p align="center">
  <h1 align="center">agentfootprint</h1>
  <p align="center">
    <strong>Context engineering, abstracted.</strong>
  </p>
</p>

<p align="center">
  <a href="https://github.com/footprintjs/agentfootprint/actions"><img src="https://github.com/footprintjs/agentfootprint/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
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
| **agentfootprint** | Injections (slot × trigger) | Slot composition, iteration loop, observation, replay |

The closest structural parallel is **autograd**: you describe the graph, the framework traverses it, and *because the framework owns the traversal it can record everything that happens for free*. Same idea here — you describe Injections, agentfootprint runs the iteration loop, and the typed-event stream + replayable checkpoints are a consequence, not an extra feature.

<!-- ┌────────────────────────────────────────────────────────────────┐
     │  📹  30-second demo video here.                                 │
     │      Embed: paste-trace → drag time-travel slider →             │
     │      every slot, every decision, every tool call visible.       │
     │      Frame this as "agent DevTools" — the React DevTools moment.│
     └────────────────────────────────────────────────────────────────┘ -->

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

  // 6. Call LLM, route tool calls, loop, capture state for resume...
  // 7. Persist new turn back to memory tagged with identity...
  // 8. Wire SSE for streaming, attach observability hooks...

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

Same agent. The hand-rolled version is ~80 lines and growing; the declarative version is ~8 and stable. **The framework owns the wiring** — which is exactly why it can observe, replay, and audit it for you.

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

## Why this isn't just an ergonomics win

The React parallel goes one layer deeper than "less code." Because the framework owns the wiring, the framework can do things you couldn't do by hand:

| You write declaratively | The framework does for you |
|---|---|
| `.steering(rule)` | Evaluates every iteration, composes into `system` slot |
| `.instruction(activeWhen, prompt)` | Re-evaluates predicate per iteration; routes to `system` or `messages` for attention positioning |
| `.skill(billing)` | Auto-attaches `read_skill` tool; LLM activates by id; body + unlocked tools land in next iteration |
| `.memory(causal)` | Persists footprintjs decision-evidence snapshots; embeds queries; cosine-matches on follow-up runs |
| `.tool(weather)` | Schemas to LLM, dispatches calls, captures args/results, gates by permission policy |
| `.attach(recorder)` | Subscribes to 47 typed events across 13 domains as the chart traverses |
| `agent.run({...})` | Captures every decision, every commit, every tool call as a JSON checkpoint that's replayable cross-server |

**The flowchart-pattern substrate** ([footprintjs](https://github.com/footprintjs/footPrint)) is what makes the observation automatic. Every stage execution is a typed event during one DFS traversal — no instrumentation, no post-processing. Same way React DevTools shows you the component tree because React owns the render path, agentfootprint shows you the slot composition because agentfootprint owns the prompt path.

---

## What you can build

Three example shapes, all runnable end-to-end with `npm run example examples/<file>.ts`.

### Customer support agent (skills + memory + audit trail)

```typescript
const agent = Agent.create({ provider, model: 'claude-sonnet-4-5-20250929' })
  .system('You are a friendly support assistant.')
  .skill(billingSkill)        // LLM activates with read_skill('billing')
  .steering(toneGuidelines)   // always-on
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

<!-- ┌────────────────────────────────────────────────────────────────┐
     │  📹  Streaming demo clip here.                                  │
     │      Short loop: user types → tokens stream → tool call         │
     │      surfaces mid-stream → final answer.                        │
     └────────────────────────────────────────────────────────────────┘ -->

```typescript
agent.on('agentfootprint.stream.token', (e) => res.write(e.payload.content));
agent.on('agentfootprint.stream.tool_start', (e) => res.write(`\n→ ${e.payload.toolName}...\n`));
await agent.run({ message: userInput });
```

→ [`docs-site/guides/streaming/`](docs-site/src/content/docs/guides/streaming.mdx)

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

The same snapshot data shape is the input to SFT / DPO / process-RL training pipelines (`causalMemory.exportForTraining({ format: 'sft' | 'dpo' | 'process' })` is on the roadmap — see below). You don't run a separate data-collection phase — **your production traffic IS your training set.** Every successful customer interaction is a positive trajectory; every escalation or override is a counter-example.

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

The flowchart, recorders, narrative, and tests don't change between dev and prod. **Ship the patterns first; pay for tokens last.**

---

## Pick your starting door

| If you are... | Start here |
|---|---|
| 🎓 **New to agents** | [5-minute Quick Start](https://footprintjs.github.io/agentfootprint/getting-started/quick-start/) → first agent runs offline |
| 🛠️ **A LangChain / CrewAI / LangGraph user** | [Migration sketch](https://footprintjs.github.io/agentfootprint/getting-started/vs/) — same patterns, fewer classes |
| 🏗️ **Architecting an enterprise rollout** | [Production guide](https://footprintjs.github.io/agentfootprint/guides/deployment/) — multi-tenant identity, audit trails, redaction, OTel |
| 🔬 **Researcher / extending the framework** | [Extension guide](https://footprintjs.github.io/agentfootprint/contributing/extension-guide/) — add a new flavor in 50 lines |

Every code snippet on the docs site is imported from a real, runnable file in [`examples/`](examples/) — every example is also an end-to-end test in CI. There is no docs-only code in this repo.

---

## What ships today

- **2 primitives** — `LLMCall`, `Agent` (the ReAct loop)
- **4 compositions** — `Sequence`, `Parallel`, `Conditional`, `Loop`
- **6 LLM providers** — Anthropic · OpenAI · Bedrock · Ollama · Browser-Anthropic · Browser-OpenAI · Mock (with `mock({ replies })` for scripted multi-turn)
- **One Injection primitive** — `defineSkill` / `defineSteering` / `defineInstruction` / `defineFact` (one engine, four typed factories, all reduce to `{ trigger, slot }`)
- **One Memory factory** — `defineMemory({ type, strategy, store })` — 4 types × 7 strategies including **Causal**
- **RAG** — `defineRAG()` + `indexDocuments()` (sugar over Semantic + TopK)
- **MCP** — `mcpClient({ transport })` for real servers · `mockMcpClient({ tools })` for in-memory development
- **Memory store adapters** — `InMemoryStore` · `RedisStore` (subpath `agentfootprint/memory-redis`) · `AgentCoreStore` (subpath `agentfootprint/memory-agentcore`)
- **47 typed observability events** across 13 domains — context · stream · agent · cost · skill · permission · eval · memory · …
- **Pause / resume** — JSON-serializable checkpoints; pause via `askHuman` / `pauseHere`, resume hours later on a different server
- **Resilience** — `withRetry`, `withFallback`, `resilientProvider`
- **AI-coding-tool support** — bundled instructions for Claude Code · Cursor · Windsurf · Cline · Kiro · Copilot
- **Runnable examples** organized by DNA layer (core · core-flow · patterns · context-engineering · memory · features) — every example is also an end-to-end CI test

## What's next (clearly marked roadmap)

| Theme | Focus |
|---|---|
| **Reliability subsystem** | `CircuitBreaker` · 3-tier output fallback · auto-resume-on-error · Skills upgrades (`surfaceMode`, `refreshPolicy`) · `MockEnvironment` composer |
| **Causal training-data exports** | `causalMemory.exportForTraining({ format: 'sft' \| 'dpo' \| 'process' })` — production traffic becomes labeled SFT / DPO / process-RL trajectories |
| **Governance** | `Policy` · `BudgetTracker` · DynamoDB / Postgres / Pinecone memory adapters · production embedder factories |
| **Deep Agents · A2A protocol** | Planning-before-execution · agent-to-agent protocol · Lens UI deep-link |

For shipped features per release see [CHANGELOG.md](./CHANGELOG.md). Roadmap items are *not* claims about the current API — if a feature isn't in `npm install agentfootprint` today, it's listed here, not in the documentation.

---

## Built on

[footprintjs](https://github.com/footprintjs/footPrint) — the flowchart pattern for backend code. The decision-evidence capture, narrative recording, and time-travel checkpointing this library uses are footprintjs primitives. The same way autograd's forward-pass traversal is what makes gradient inspection automatic, footprintjs's flowchart traversal is what makes agentfootprint's typed-event stream and replayable traces automatic. You don't need to learn footprintjs to use agentfootprint — but if you want to build your own primitives at this depth, [start there](https://footprintjs.github.io/footPrint/).

## License

[MIT](./LICENSE) © [Sanjay Krishna Anbalagan](https://github.com/sanjay1909)

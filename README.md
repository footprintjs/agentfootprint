
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/hero-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/hero-light.svg">
    <img alt="agentfootprint mascot composing context flavors (Skills, Grounding, Steering, Tools, Short-term memory, Long-term memory) into three structured LLM slots (System Prompt, Messages API, Tools API) — the central abstraction, visualized." src="docs/assets/hero-light.svg" width="100%"/>
  </picture>
</p>

<h1 align="center">agentfootprint</h1>

<p align="center">
  <a href="https://github.com/footprintjs/agentfootprint/actions"><img src="https://github.com/footprintjs/agentfootprint/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://codecov.io/gh/footprintjs/agentfootprint"><img src="https://codecov.io/gh/footprintjs/agentfootprint/branch/main/graph/badge.svg" alt="Coverage"></a>
  <a href="https://www.npmjs.com/package/agentfootprint"><img src="https://img.shields.io/npm/v/agentfootprint.svg?style=flat" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/agentfootprint"><img src="https://img.shields.io/npm/dm/agentfootprint.svg" alt="Downloads"></a>
  <a href="https://github.com/footprintjs/agentfootprint/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT"></a>
</p>

---

> Your agents deserve a typed context loop.

agentfootprint turns the context plumbing every agent reinvents — slot juggling, trigger evaluation, memory loading, cache markers, observability hooks, retry logic — into one primitive: **Injection = slot × trigger × cache**. You declare; the framework owns the loop. Every run produces a JSON-portable causal trace — audit, replay, export training data, no extra instrumentation.

**One primitive · Own the loop · Causal trace for free · 7 LLM providers · Mocks first · 10-min setup**

---

## 1. What we abstract

The messy reality every agent codebase reinvents — usually badly:

- Which instructions go in `system`
- Which messages get added after a tool returns
- Which tools should be exposed right now
- Which memory to load for this tenant
- Which parts of the prompt are stable enough to cache
- When to retry, what to log, where to put cache markers

Hand-rolled, every agent does this differently — and brittlely. agentfootprint replaces all of it with one primitive. The next beat shows what that primitive looks like.

---

## 2. How we abstract it

Every LLM call has three slots:

```text
system     messages     tools
```

Every agent feature — steering, instructions, skills, facts, memory, RAG, tool schemas — is content flowing into one of those slots. agentfootprint models all of them as one primitive:

```text
Injection = slot × trigger × cache
```

An Injection answers three questions:

1. **Where does this content land?** `system`, `messages`, or `tools`
2. **When does it activate?** `always` · `rule` · `on-tool-return` · `llm-activated`
3. **How is it cached?** `always` · `never` · `while-active` · predicate

That is the whole abstraction. Every named pattern in the agent literature — Reflexion, Tree-of-Thoughts, Skills, RAG, Constitutional AI — reduces to *which slot* + *which trigger*. You learn one model; the field's growth lands as new factories on the same primitive.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/triggers-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/triggers-light.svg">
    <img alt="agentfootprint — Every LLM call has 3 fixed slots (system, messages, tools). Every flavor lands in one slot under one of 4 fixed triggers (always · rule · on-tool-return · llm-activated). Sparkle streams flow from each trigger lane down to a specific pill inside its destination slot — same slot can hold pills from different triggers (RAG via rule, Instruction via on-tool-return), and the same flavor (Skill) can land in different slots." src="docs/assets/triggers-light.svg" width="100%"/>
  </picture>
</p>

**4 triggers — 1 static, 3 dynamic.** All four are config you give the builder; the runtime handles the rest.

| # | Trigger | Fires when | One-line example | Default slot |
|---|---|---|---|---|
| 1 | `always` *(static)* | Every iteration | `.steering('You are a triage agent…')` | `system` |
| 2 | `rule` *(dynamic — predicate)* | Consumer rule returns true | `.rag({ when: s => /price\|refund/.test(s.userQuery), source: docs })` | `messages` |
| 3 | `on-tool-return` *(dynamic — lifecycle)* | After a specific tool returns | `.instruction({ after: 'search_db', text: 'Cite source IDs.' })` | `messages` |
| 4 | `llm-activated` *(dynamic — agent-driven)* | LLM calls `read_skill('id')` | `.skill({ id: 'refund-policy', activatedBy: 'read_skill' })` | `messages` (body) |

> **Slot is a default, not a coupling — same flavor lives in any slot, strategy is config.**
> A `Skill` can live in:
> - `tools` slot → schema only, LLM discovers it via `read_skill` — trigger `always`
> - `messages` slot → body injected on activation — trigger `llm-activated`
> - `system` slot → body baked into the system prompt as permanent steering — trigger `always`
>
> Tomorrow's flavor (few-shot, reflection, persona, A2A handoff…) plugs into the same matrix — no new abstraction.

**3 slots × 4 triggers × N flavors = the entire context-engineering surface.** When you look at any agent feature in the wild, locate it on this grid; that's enough to model it.

### Why this design works — we own the loop

Every load-bearing dev tool of the last decade made the same move — own the runtime loop, not just the API:

| Framework | You write | The framework abstracts |
|---|---|---|
| **PyTorch (autograd)** | Forward graph | Gradient computation, backward pass |
| **Express / Fastify** | Routes + handlers | HTTP loop, middleware chain |
| **Prisma** | Schema + query intent | SQL generation, migrations |
| **React** | Components + state | DOM diffing, render path |
| **agentfootprint** | Injections (slot × trigger × cache) | Slot composition, iteration loop, caching, observation, replay |

The closest structural parallel is **autograd**: you describe the graph, the framework traverses it, and *because the framework owns the traversal it can record everything for free*. Same idea here. **Owning the loop is what makes Beats 3 and 4 possible.** In every other framework, flexibility and observability are a tradeoff — bolt-on instrumentation breaks when you customize. Here, both fall out of the same property: customization happens *inside* the recorded loop, not around it.

> 📖 Long-form: [the Palantir lineage](https://footprintjs.github.io/agentfootprint/inspiration/connected-data/) · [the Liskov lineage](https://footprintjs.github.io/agentfootprint/inspiration/modularity/)

---

## 3. How do I design my agent or system of agents?

Same vocabulary, two scales.

### Single agent — compose CONTEXT with the Injection primitive

The agent loop itself is dynamic. Every iteration recomposes the slots, so injections that fired on the previous tool result get a chance to recompose the next prompt.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/dynamic-vs-classic-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/dynamic-vs-classic-light.svg">
    <img alt="Classic ReAct vs Dynamic ReAct loop topology — same 5 stages (SystemPrompt, Messages, Tools, CallLLM, Route → ExecuteTools/Finalize), but the loop edge differs: Classic returns to CallLLM only (slots frozen at 12 tools every iteration), Dynamic returns to SystemPrompt (slots recompose, tools shrink from 1 to 5 as skills activate)." src="docs/assets/dynamic-vs-classic-light.svg" width="100%"/>
  </picture>
</p>

**Same five stages on both sides. Only one thing differs — where the loop returns.**

- **Classic ReAct** loops back to `CallLLM`. The slot subflows ran once at the top of the turn and stay frozen. The agent sees the same 12 tools on every iteration regardless of what it just discovered.
- **Dynamic ReAct** (agentfootprint) loops back to `SystemPrompt`. Per-iteration recomposition is also the structural prerequisite for the cache layer — cache markers can't track active injections in lockstep without it.

```text
Classic ReAct                    Dynamic ReAct
───────────────                  ─────────────
iter 1: 12 tools shown           iter 1: 1 tool  (read_skill)
iter 2: 12 tools shown           iter 2: 5 tools (skill activated)
iter 3: 12 tools shown           iter 3: 5 tools
```

Use **Dynamic ReAct** when your tools have dependencies (one tool's output implies which tool to call next). Use **Classic ReAct** when all tools are independent and ordering doesn't matter.

> 📖 [Dynamic ReAct guide](https://footprintjs.github.io/agentfootprint/guides/dynamic-react/) · [Cache layer](https://footprintjs.github.io/agentfootprint/guides/caching/)

### System of agents — compose AGENTS with control flows

```text
Primitives:    Agent · LLMCall
Control flows: Sequence · Parallel · Decide · Loop
```

Every named multi-agent pattern in the literature reduces to a composition of these:

| Pattern | Composition |
|---|---|
| **Swarm** | `Loop( Parallel( Agent×N ) → merge )` |
| **Tree-of-Thoughts** | `Loop( Parallel( Agent×N ) → Decide(score) )` |
| **Reflexion** | `Loop( Agent → Decide(critique) → Agent )` |
| **Debate** | `Parallel( Agent_pro, Agent_con ) → Agent_judge` |
| **Router** | `Decide → Agent_A \| Agent_B \| Agent_C` |
| **Hierarchical** | `Agent_planner → Sequence( Agent_worker×N ) → synth` |

Same trick as Beat 1: instead of N libraries for N patterns, we found the M building blocks all N patterns are made of.

### A real agent in 8 lines

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
```

The hand-rolled equivalent is ~80 lines of slot management, trigger evaluation, memory loading, and cache marker placement — and growing with every feature. The declarative version stays at 8.

> 📖 Compare: [hand-rolled vs declarative](https://footprintjs.github.io/agentfootprint/getting-started/why/) · [migration from LangChain / CrewAI / LangGraph](https://footprintjs.github.io/agentfootprint/getting-started/vs/)

---

## 4. How do I see what my agent did?

Because the framework owns the loop (Beat 2), **every decision and execution is captured during traversal** — not bolted on afterward. You get observability freedom: wire the recorders you need, view the trace through any lens, export to any sink. In every other framework, flexibility kills observability — bolt-on instrumentation breaks when you customize. Here it doesn't.

The default capture is the **causal trace** — every stage, read, write, and decision evidence — saved as a JSON-portable, scrubbable, queryable, exportable artifact. Beyond the default, wire custom recorders for cost tracking, latency, quality scoring — any observation hook fires on the same traversal stream.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/causal-memory-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/causal-memory-light.svg">
    <img alt="agentfootprint causal memory — Each agent run produces a JSON-portable causal trace: a scrubbable timeline of every stage with reads, writes, and captured decision evidence. The trace card shows a time-travel slider (Step 5 of 17, Live), an execution timeline with stage-duration bars, and the captured decision evidence pill (riskTier eq high → reject). Two built-in lenses view it: Lens (agent-centric) and Explainable Trace (structural). Three programmatic consumers fan out from it: audit replay (GDPR Article 22 adverse-action notice answered from chain, no LLM call, $15/1M to $0.25/1M tokens), cheap-model triage (Sonnet trace fed to Haiku for follow-ups), and training data export (every chain is a labeled trajectory ready for SFT/DPO/process-RL). One recording, two lenses, three consumers, zero extra instrumentation. Powered by footprintjs causalChain()." src="docs/assets/causal-memory-light.svg" width="100%"/>
  </picture>
</p>

The same trace serves three downstream consumers — no extra instrumentation:

1. **Audit / compliance.** Six months later, *"why was loan #42 rejected?"* answers from the chain (`creditScore=580 < 620 ∧ dti=0.6 > 0.43 → riskTier=high → REJECTED`). No LLM call. GDPR Art. 22, ECOA, and EU AI Act adverse-action notices write themselves from the captured decision evidence.

2. **Cheap-model triage.** A Sonnet trace becomes good *input* for Haiku to answer follow-ups. ~200 tokens at any model ($0.25/1M) vs ~2,500 tokens at a reasoning model ($15/1M). Memoization for agent thinking — no agent rerun.

3. **Training data export.** Every successful chain is a labeled trajectory — `causalMemory.exportForTraining({ format: 'sft' \| 'dpo' \| 'process-rl' })`. The chain provides per-step rewards out of the box, so process-RL is ready without a separate data-collection phase.

Two built-in lenses view the same trace:

| Lens | View | When to use |
|---|---|---|
| **Lens** | Agent-centric — User/Agent[3 slots]/Tool flowchart with iteration scrubber and round commentary | Live debugging, "what did Neo see at step 5?" |
| **Explainable Trace** | Structural — subflow tree, full flowchart, memory inspector, per-stage execution timeline | Architecture review, root-cause analysis |

> 📖 Powered by [footprintjs `causalChain()`](https://footprintjs.github.io/footPrint/blog/backward-causal-chain/) — backward thin-slicing on the commit log. [Causal memory guide](https://footprintjs.github.io/agentfootprint/guides/causal-memory/) · [Explainability & compliance](https://footprintjs.github.io/footPrint/blog/explainability-compliance/)

**One recording. Two lenses. Three consumers. Zero extra instrumentation.**

---

## Quick start — runs offline, no API key

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
  provider: mock({ reply: 'I checked: it is 72°F and sunny.' }),
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

## Mocks first, production second

Build the entire app against in-memory mocks with **zero API cost**, then swap real infrastructure one boundary at a time.

| Boundary | Dev | Prod |
|---|---|---|
| LLM provider | `mock(...)` | `anthropic()` · `openai()` · `bedrock()` · `ollama()` |
| Memory store | `InMemoryStore` | `RedisStore` · `AgentCoreStore` · DynamoDB / Postgres / Pinecone |
| MCP | `mockMcpClient(...)` | `mcpClient({ transport })` |
| Cache strategy | `NoOpCacheStrategy` | auto-selected per provider |

The flowchart, recorders, and tests don't change between dev and prod.

---

## What ships today

**Core**
- 2 primitives — `LLMCall`, `Agent` (the ReAct loop)
- 4 control flows — `Sequence`, `Parallel`, `Conditional`, `Loop`
- One Injection primitive — `defineSkill` / `defineSteering` / `defineInstruction` / `defineFact`

**Adapters**
- 7 LLM providers — Anthropic · OpenAI · Bedrock · Ollama · Browser-Anthropic · Browser-OpenAI · Mock
- RAG · MCP · Memory store adapters — InMemory · Redis · AgentCore (Postgres / DynamoDB / Pinecone via lazy peer-deps)

**Operability**
- One Memory factory — 4 types × 7 strategies including **Causal**
- Provider-agnostic prompt caching — declarative per-injection, per-iteration marker recomputation
- Pause / resume — JSON-serializable checkpoints; resume hours later on a different server
- Resilience — `withRetry`, `withFallback`, `resilientProvider`
- 48+ typed observability events — context · stream · agent · cost · skill · permission · eval · memory · cache · embedding · error

**Tooling**
- **Lens** · **Explainable Trace** — two visual replays of the causal trace
- AI-coding-tool support — Claude Code · Cursor · Windsurf · Cline · Kiro · Copilot

> 📖 [Full feature list & API reference](https://footprintjs.github.io/agentfootprint/reference/) · [CHANGELOG](./CHANGELOG.md)

---

## Roadmap

| Theme | Focus |
|---|---|
| Reliability | Circuit breaker, output fallback, auto-resume-on-error |
| Causal exports | `causalMemory.exportForTraining({ format: 'sft' \| 'dpo' \| 'process' })` |
| Governance | Policies, budget tracking, production memory adapters |
| Cache v2 | Gemini handle-based caching, cost attribution |
| Deep agents | Planning-before-execution, A2A protocol, Lens UI |

Roadmap items are *not* current API claims. If a feature isn't in `npm install agentfootprint` today, it's listed here, not in the docs.

---

## Where to next

| If you are... | Go here |
|---|---|
| New to agents | [5-minute quick start](https://footprintjs.github.io/agentfootprint/getting-started/quick-start/) |
| Coming from LangChain / CrewAI / LangGraph | [Migration guide](https://footprintjs.github.io/agentfootprint/getting-started/vs/) |
| Architecting an enterprise rollout | [Production guide](https://footprintjs.github.io/agentfootprint/guides/deployment/) |
| Doing due diligence | [Architecture overview](https://footprintjs.github.io/agentfootprint/architecture/) |
| Researcher / extending | [Extension guide](https://footprintjs.github.io/agentfootprint/contributing/extension-guide/) |
| Curious about design | [Inspiration docs](https://footprintjs.github.io/agentfootprint/inspiration/) |

Or jump into the [examples gallery](https://github.com/footprintjs/agentfootprint/tree/main/examples) — every example is also an end-to-end CI test.

---

## Built on

[footprintjs](https://github.com/footprintjs/footPrint) — the flowchart pattern for backend code. The decision-evidence capture, narrative recording, and time-travel checkpointing this library uses are footprintjs primitives. The same way autograd's forward-pass traversal is what makes gradient inspection automatic, footprintjs's flowchart traversal is what makes agentfootprint's typed-event stream and replayable traces automatic.

You don't need to learn footprintjs to use agentfootprint — but if you want to build your own primitives at this depth, [start there](https://footprintjs.github.io/footPrint/).

---

## License

[MIT](./LICENSE) © [Sanjay Krishna Anbalagan](https://github.com/sanjay1909)

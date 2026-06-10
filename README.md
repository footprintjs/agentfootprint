
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/hero-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/hero-light.svg">
    <img alt="agentfootprint mascot composing context flavors (Skills, Steering, Guardrails, RAG, Tool APIs, Memory) into three structured LLM slots (system, messages, tools) — the central abstraction, visualized." src="docs/assets/hero-light.svg" width="100%"/>
  </picture>
</p>

<h1 align="center">Agentfootprint</h1>

<p align="center">
  <strong>We abstract context engineering — and hand back the trace.</strong><br/>
  <strong>Live</strong> to develop · <strong>offline</strong> to monitor · <strong>detailed</strong> to improve.
</p>

<p align="center">
  <a href="https://github.com/footprintjs/agentfootprint/actions"><img src="https://github.com/footprintjs/agentfootprint/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <!-- coverage-badge --><img src="https://img.shields.io/badge/coverage-87%25-green.svg" alt="coverage: 87%"><!-- /coverage-badge -->
  <a href="https://www.npmjs.com/package/agentfootprint"><img src="https://img.shields.io/npm/v/agentfootprint.svg?style=flat" alt="npm version"></a>
  <a href="https://bundlephobia.com/package/agentfootprint"><img src="https://img.shields.io/bundlephobia/minzip/agentfootprint?label=minzipped" alt="minzipped size"></a>
  <a href="#tree-shakeable--esm-first"><img src="https://img.shields.io/badge/tree--shakeable-%E2%9C%93-success?style=flat" alt="tree-shakeable"></a>
  <a href="https://www.npmjs.com/package/agentfootprint"><img src="https://img.shields.io/npm/dm/agentfootprint.svg" alt="Downloads"></a>
  <a href="https://github.com/footprintjs/agentfootprint/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT"></a>
</p>

---

## 1. What we abstract

When you build an Agentic Application, you collect domain-specific data and instructions, then wire them up based on what your system receives.

That data and those instructions wear many names — **Skills · Steering · Guardrails · RAG · Tool APIs · Memory** — with more on the way. But they all do the same thing: they **inject into one of three slots** in the LLM call (`system`, `messages`, `tools`).

So we abstracted the injection itself.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/triggers-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/triggers-light.svg">
    <img alt="agentfootprint — Every LLM call has 3 fixed slots (system, messages, tools). Every flavor lands in one slot under one of 4 fixed triggers (always · rule · on-tool-return · llm-activated). Sparkle streams flow from each trigger lane down to a specific pill inside its destination slot — same slot can hold pills from different triggers (RAG via rule, Instruction via on-tool-return), and the same flavor (Skill) can land in different slots." src="docs/assets/triggers-light.svg" width="100%"/>
  </picture>
</p>

The abstraction is three rules:

1. **Three slots are fixed.** `system`, `messages`, `tools` — the LLM API surface.
2. **N flavors are open.** You declare what you have. Tomorrow's flavor (few-shot, reflection, persona, A2A handoff…) plugs in the same way.
3. **Rules decide *where* and *when*.** You provide the rules. We collect your data, fire the right one, land it in the right slot at the right iteration.

That's the whole model: `Injection = slot × trigger × cache`.

- **Slot** — which of the 3 LLM API regions the content lands in (`system` / `messages` / `tools`).
- **Trigger** — when the content fires (see below).
- **Cache** — how stable the content is across iterations. The framework places provider cache markers for you — stable content gets 80–90% cheaper prefixes.

### The 4 triggers

| Trigger | Flavor | Fires when | Illustration | Default slot |
|---|---|---|---|---|
| `always` | static | Every iteration | `.steering(defineSteering({ id, prompt: 'You are a triage agent…' }))` | `system` |
| `rule` | runtime — predicate | Your rule returns true | `.instruction(defineInstruction({ id, activeWhen: s => /price\|refund/.test(s.userQuery), prompt }))` | `system` |
| `on-tool-return` | runtime — lifecycle | After a specific tool returns | `.instruction(defineInstruction({ id, slot: 'messages', activeWhen, prompt: 'Cite source IDs.' }))` | `messages` |
| `llm-activated` | runtime — agent-driven | LLM calls `read_skill('id')` | `.skill(defineSkill({ id: 'refund-policy', description, body, viaToolName: 'read_skill' }))` | `messages` (body) |

> [!NOTE]
> The "Illustration" column shows the shape of each flavor — the typed builder methods (`.steering` / `.instruction` / `.skill` / `.fact` / `.rag`) take an `Injection` (or `MemoryDefinition` for `.rag`) produced by the matching `defineSteering` / `defineInstruction` / `defineSkill` / `defineFact` / `defineRAG` factory. Slot is a default, not a coupling — the same `Skill` can live in `tools` (schema only, discovered via `read_skill`), `messages` (body injected on activation), or `system` (baked into the prompt as steering).

**3 slots × 4 triggers × N flavors = the entire context-engineering surface.**

---

## 2. Why we chose this abstraction

The agent space has many credible primary abstractions:

| Framework | What it abstracts |
|---|---|
| **LangChain** | Pipelines of composable components |
| **LangGraph** | State machines of nodes and edges |
| **CrewAI · AutoGen** | Crews of role-playing agents |
| **Mastra · Genkit · Pydantic AI** | Typed full-stack bundles |
| **DSPy** | Compiled prompts |
| **Inngest AgentKit** | Durable workflows |

We didn't have to choose between them.

agentfootprint is built on **footprintjs** — the flowchart pattern for backend code. footprintjs gives us every one of those abstractions out of the box:

| Capability | What footprintjs hands us |
|---|---|
| Composition | `Sequence` · `Parallel` · `Conditional` · `Loop` |
| State machines | The ReAct loop *is* a flowchart |
| Multi-agent crews | Compose Agents through control flow — no special class needed |
| Durable workflows | `pauseHere()` plus JSON-portable `resume()` |
| Typed observation | 60+ events for free, because the framework owns the loop |

So we used the budget those abstractions would have cost us to invest deeply in something they all leave to the developer: **the injection loop.**

> [!IMPORTANT]
> **We abstract context engineering — and hand back the trace.**
> Live to develop · offline to monitor · detailed to improve.

### The reason — agents have a new class of bug

For fifty years, software bugs have been **logic errors**. A wrong condition, a missed edge case, an off-by-one. You step through the code until you find the bad branch.

LLM-powered apps add a second class of bug: **contextual errors.** The code is correct. The model is correct. The answer is wrong because **the LLM's decision rests on context that was ambiguous, confusing, or misleading at the moment of inference.**

Tracking *which content the model actually saw, and why,* is the entire debugging job. Without it, the failure mode is invisible:

| What got injected wrong | What the model did |
|---|---|
| Wrong instruction landed in the `system` slot | Followed the wrong rule |
| Predicate fired one iteration too early | Reasoned with stale assumptions |
| Skill body missing when the LLM called `read_skill` | Invented its own |
| Cache prefix invalidated mid-iteration | Saw a silently rewritten stale version |
| Tool returned but the `on-tool-return` injection didn't fire | Couldn't interpret the result |

> [!IMPORTANT]
> **The model doesn't tell you which of these went wrong. It just gives you the wrong answer.**

You can't step through that with a debugger. By the time you read the response, the context that produced it is gone unless something recorded it.

That's the gap agentfootprint fills. A framework that owns the control flow can debug logic errors. A framework that owns the *injection* can debug contextual errors — because every injection is a typed event with a where, when, why, and how-it-cached.

### What that buys you

Because we own the injection, every LLM call backtracks to four typed answers:

- **What** was injected
- **Who** triggered it (which rule)
- **When** it fired
- **How** it landed — slot, position, cache

Same trace, three workflows:

- **Live — debug as you build.** See exactly which injection produced which token, which predicate fired this iteration, which prefix actually got cached.
- **Offline — monitor what shipped.** Replay any past run from its trace. Alert on drift. Attribute cost per injection.
- **Detailed — improve via export.** Every successful trajectory is labeled training data for SFT, DPO, or RL — no separate data-collection phase.

And a fourth, novel: **the agent can read its own trace.** Six months after the agent rejected loan #42, *"why did you reject it?"* answers from the recorded evidence — the tool calls (`credit_score_check → 580`), the decisions, the rules that fired — not a rerun. Causal memory turns the trace into the agent's working memory.

---

## 3. How do I design my agent or system of agents?

Two scales — same alphabet. Four control flows are the entire vocabulary.

<table>
<tr>
<td width="50%" align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/sequence-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/sequence-light.svg">
    <img alt="Sequence — linear chain A → B → C." src="docs/assets/sequence-light.svg" width="100%"/>
  </picture>
</td>
<td width="50%">

```typescript
import { Sequence } from 'agentfootprint';

const flow = Sequence.create()
  .step('a', stageA)
  .step('b', stageB)
  .step('c', stageC)
  .build();
```

</td>
</tr>
<tr>
<td width="50%" align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/parallel-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/parallel-light.svg">
    <img alt="Parallel — fan-out then fan-in across N agents." src="docs/assets/parallel-light.svg" width="100%"/>
  </picture>
</td>
<td width="50%">

```typescript
import { Parallel } from 'agentfootprint';

const fan = Parallel.create()
  .branch('web', searchWeb)
  .branch('docs', searchDocs)
  .mergeWithFn(synthesizer)
  .build();
```

</td>
</tr>
<tr>
<td width="50%" align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/conditional-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/conditional-light.svg">
    <img alt="Conditional — diamond gate routes to one of N branches based on a predicate." src="docs/assets/conditional-light.svg" width="100%"/>
  </picture>
</td>
<td width="50%">

```typescript
import { Conditional } from 'agentfootprint';

const router = Conditional.create()
  .when('billing', s => /bill|invoice|refund/.test(s.message), billingAgent)
  .when('tech',    s => /error|bug|crash/.test(s.message),     techAgent)
  .otherwise('default', defaultAgent)
  .build();
```

</td>
</tr>
<tr>
<td width="50%" align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/loop-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/loop-light.svg">
    <img alt="Loop — body cycles back from end to start until a condition is met." src="docs/assets/loop-light.svg" width="100%"/>
  </picture>
</td>
<td width="50%">

```typescript
import { Loop } from 'agentfootprint';

const reflexion = Loop.create()
  .repeat(thinkAgent)
  .until(({ latestOutput }) => latestOutput.includes('DONE'))
  .build();
```

</td>
</tr>
</table>

### Inside one agent — Dynamic vs Classic ReAct

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/dynamic-vs-classic-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/dynamic-vs-classic-light.svg">
    <img alt="Classic ReAct vs Dynamic ReAct loop topology — same 5 stages (SystemPrompt, Messages, Tools, CallLLM, Route → ExecuteTools/Finalize), but the loop edge differs: Classic returns to CallLLM only (slots frozen at 12 tools every iteration), Dynamic returns to SystemPrompt (slots recompose, tools shrink from 1 to 5 as skills activate)." src="docs/assets/dynamic-vs-classic-light.svg" width="100%"/>
  </picture>
</p>

**Same five stages on both sides. Only one thing differs — where the loop returns.** Classic ReAct loops back to `CallLLM` and slots stay frozen. Dynamic ReAct (agentfootprint) loops back to `SystemPrompt`, so injections that fired on the previous tool result recompose the next prompt. Per-iteration recomposition is also the structural prerequisite for the cache layer.

| Iteration | Classic ReAct | Dynamic ReAct (agentfootprint) |
|---|---|---|
| 1 | 12 tools shown | **1 tool** (`read_skill`) |
| 2 | 12 tools shown | **5 tools** (skill activated) |
| 3 | 12 tools shown | 5 tools |

> 📖 [Dynamic ReAct guide](https://footprintjs.github.io/agentfootprint/guides/dynamic-react/) · [Key concepts](https://footprintjs.github.io/agentfootprint/getting-started/key-concepts/)

### Multi-agent — compose with the alphabet

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/compose-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/compose-light.svg">
    <img alt="A custom research agent built from the same 4 control flows: input flows into a Conditional gate (plan more research?), which fans out to a Parallel block (search_web, search_docs, search_kb), then chains into a Sequence (synthesize → critique), and a Loop arrow returns from the end back to the Conditional gate so the agent iterates until satisfied. Formula: Loop( Conditional(plan?) → Parallel(search_web, search_docs, search_kb) → Sequence(synth → critique) )." src="docs/assets/compose-light.svg" width="100%"/>
  </picture>
</p>

Pick the flows that match your problem. Chain them. **That's your Agentic Application.**

```typescript
const research = Loop.create()
  .repeat(Sequence.create().step('plan', plan).step('search', searchAll).build())
  .until(({ iteration, latestOutput }) => iteration >= 3 || latestOutput.includes('DONE'))
  .build();
```

Same `.create().method().build()` shape as the four rows above — just composed.

### Named patterns — also compositions of the same 4

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/patterns-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/patterns-light.svg">
    <img alt="6 named multi-agent patterns reduce to compositions of the same 4 control flows: Swarm = Loop(Parallel(Agent×N) → merge); Tree-of-Thoughts = Loop(Parallel(Agent×N) → Conditional(score)); Reflexion = Loop(Agent → Conditional(critique) → Agent); Debate = Parallel(Agent_pro, Agent_con) → Agent_judge; Router = Conditional → Agent_A | Agent_B | Agent_C; Hierarchical = Agent_planner → Sequence(Agent_worker×N) → synth." src="docs/assets/patterns-light.svg" width="100%"/>
  </picture>
</p>

The patterns the field knows reduce to the same alphabet:

| Pattern | Composition |
|---|---|
| **Swarm** | `Loop( Parallel( Agent×N ) → merge )` |
| **Tree-of-Thoughts** | `Loop( Parallel( Agent×N ) → Conditional(score) )` |
| **Reflexion** | `Loop( Agent → Conditional(critique) → Agent )` |
| **Debate** | `Parallel( Agent_pro, Agent_con ) → Agent_judge` |
| **Router** | `Conditional → Agent_A \| Agent_B \| Agent_C` |
| **Hierarchical** | `Agent_planner → Sequence( Agent_worker×N ) → synth` |

Same trick as Beat 1: instead of N libraries for N patterns, we found the M building blocks all N patterns are made of.

> 📖 Compare: [hand-rolled vs declarative](https://footprintjs.github.io/agentfootprint/getting-started/why/) · [migration from LangChain / CrewAI / LangGraph](https://footprintjs.github.io/agentfootprint/getting-started/vs/)

---

## 4. How do I see what my agent did?

Because we own the loop (Beat 2), every decision and execution is captured during traversal — not bolted on. The default capture is the **causal trace**: every stage, read, write, and decision evidence, as a JSON-portable, scrubbable, queryable, exportable artifact. Beyond the default, wire custom recorders for cost, latency, or quality scoring — any observation hook fires on the same stream.

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

3. **Training data — the substrate is already there.** Every successful chain is a labeled trajectory. SFT pairs (`{prompt, completion}`) fall out of the snapshot's history field; the export wrapper is roadmap work tracked in [GitHub issues](https://github.com/footprintjs/agentfootprint/issues). DPO and process-RL need additional collection layers (preference feedback, per-step reward annotation) that don't ship today.

Two built-in lenses view the same trace:

| Lens | View | When to use |
|---|---|---|
| **Lens** | Agent-centric — User/Agent[3 slots]/Tool flowchart with iteration scrubber and round commentary | Live debugging, "what did Neo see at step 5?" |
| **Explainable Trace** | Structural — subflow tree, full flowchart, memory inspector, per-stage execution timeline | Architecture review, root-cause analysis |

> 📖 Powered by [footprintjs `causalChain()`](https://footprintjs.github.io/footPrint/blog/backward-causal-chain/) — backward thin-slicing on the commit log. [Causal memory deep dive](https://footprintjs.github.io/agentfootprint/causal-deep-dive/) · [Explainability & compliance](https://footprintjs.github.io/footPrint/blog/explainability-compliance/)

**One recording. Two lenses. Three consumers. Zero extra instrumentation.**

### Non-blocking observers — `observerDelivery: 'deferred'` (RFC-001)

By default every `agent.on()` listener runs **synchronously inside the
producing statement** — a slow exporter or pretty-printer taxes every
iteration of the ReAct loop. One option moves observation off the hot path:

```ts
const agent = Agent.create({
  provider,
  model,
  observerDelivery: 'deferred', // default 'inline' — byte-identical to prior releases
})
  .system('…')
  .build();

await agent.run({ message });
// serverless / shutdown: settle async listener work before the freeze
await agent.drainObservers({ timeoutMs: 5_000 });
```

Every event is **captured** into footprintjs's bounded queue (≈ microseconds
on the hot path) and **delivered one beat behind** at the next microtask
checkpoint — same typed events, same payloads, same order (a drop-in port,
deep-equal tested). Terminal boundaries (resolve, crash, pause) drain the
queue synchronously **before control returns**, so crash checkpoints and
pause records are always complete. Queue stats land on
`agent.getLastSnapshot()?.observerStats` (drops, flushes, per-listener time —
"name the hog"). The causal-evidence recorder stays inline by design (the
memory write stage reads it mid-run); a recorder declaring its own `delivery`
field keeps it — a per-recorder override for free.

**The measured deal** — 50-iteration full-feature agent, 3 747 events, a
deliberately slow 5 ms-per-event wildcard listener, 100 ms mock LLM latency
([`examples/features/21-deferred-observers.ts`](examples/features/21-deferred-observers.ts)):

| Streaming cadence | Mode | Wall | p95 / iteration | Drops |
|---|---|---|---|---|
| — | no listener (the floor) | 5.6 s | 115 ms | — |
| 0 ms (back-to-back chunks) | inline + listener | 24.5 s | 727 ms | — |
| 0 ms (back-to-back chunks) | **deferred** + listener | 24.0 s | 710 ms | 0 |
| 20 ms (realistic streaming) | inline + listener | 34.8 s | 926 ms | — |
| 20 ms (realistic streaming) | **deferred** + listener | **32.1 s (−2.7 s, −8%)** | **868 ms** | 0 |

Honest mechanism: on a single thread a CPU-burning listener's total work is
conserved — deferral recovers wall time where waits sit **adjacent** to the
producing events (`llm_start` before the provider wait, `tool_start` before
tool I/O, tokens between stream chunks). Back-to-back streaming
(`chunkDelayMs: 0`) is the worst case (~2% wall saved); realistic streaming
cadence makes token events wait-adjacent and the saving grows several-fold.
What never depends on shape: the **bounded** queue (no OOM), **error
isolation** (a throwing listener can't kill the run), **per-listener stats**,
**zero loss** (`drops: 0`, gap-detectable), and **terminal completeness**.
Not opting in costs nothing — the default path attaches exactly as before and
allocates no queue.

> 📖 Full semantics (capture policies, backpressure, `'block'` overflow):
> [footprintjs deferred-observers guide](https://github.com/footprintjs/footPrint/blob/main/docs/guides/observers-deferred.md)

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

For production, import a real provider from `agentfootprint/llm-providers` and swap it in — `anthropic(...)` / `openai(...)` / `bedrock(...)` / `ollama(...)`. Only the import line changes; the agent code stays the same. (The vendor-SDK providers live on the `agentfootprint/llm-providers` subpath so the main `agentfootprint` barrel stays free of optional peer-dep requires; `mock`, `browserAnthropic`, and `browserOpenai` are on the main barrel.)

---

## Mocks first, production second

Build the entire app against in-memory mocks with **zero API cost**, then swap real infrastructure one boundary at a time.

| Boundary | Dev | Prod |
|---|---|---|
| LLM provider | `mock(...)` | `anthropic()` · `openai()` · `bedrock()` · `ollama()` |
| Memory store | `InMemoryStore` | `RedisStore` · `AgentCoreStore` |
| MCP | `mockMcpClient(...)` | `mcpClient({ transport })` |
| Cache strategy | `NoOpCacheStrategy` | auto-selected per provider |

The flowchart, recorders, and tests don't change between dev and prod.

---

## What ships today

**Core**
- 2 primitives — `LLMCall`, `Agent` (the ReAct loop)
- 4 control flows — `Sequence`, `Parallel`, `Conditional`, `Loop`
- 1 Injection primitive — `defineSkill` / `defineSteering` / `defineInstruction` / `defineFact`
- 1 reliability gate — `.reliability({ preCheck, postDecide, providers, circuitBreaker, fallback })`
- 1 tool dispatch primitive — `ToolProvider` (sync OR async) — `staticTools` · `gatedTools` · `skillScopedTools` · or a custom `ToolProvider` that discovers over hubs / MCP / per-tenant catalogs

**LLM providers** (7)

| Factory | Use for |
|---|---|
| `anthropic` | Claude (Sonnet, Opus, Haiku) via `@anthropic-ai/sdk` |
| `openai` | GPT-4o, GPT-4-turbo via `openai` SDK |
| `bedrock` | Claude / Titan / Mistral via AWS Bedrock runtime |
| `ollama` | Local models (OpenAI-compatible endpoint) |
| `browserAnthropic` | Browser-side Claude calls (no proxy server) |
| `browserOpenai` | Browser-side OpenAI calls (no proxy server) |
| `mock` | Deterministic dev/test (zero API cost) |

**Memory + adapters**
- Memory factory — 4 types (`episodic` / `semantic` / `narrative` / `causal`) × 7 strategies (`window` / `budget` / `summarize` / `topK` / `extract` / `decay` / `hybrid`)
- Memory stores — `InMemoryStore`, `RedisStore` (peer-dep `ioredis`), `AgentCoreStore` (peer-dep AWS SDK)
- RAG · MCP adapters — `mockMcpClient(...)` / `mcpClient({ transport })`

**Operability**
- Provider-agnostic prompt caching — declarative per-injection, per-iteration marker recomputation
- Pause / resume — JSON-serializable checkpoints; resume hours later on a different server
- Resilience primitives — `withRetry`, `withFallback`, `withCircuitBreaker`, `.outputFallback`, `agent.resumeOnError`
- 60+ typed observability events — `agent` · `composition` · `context` · `stream` · `tools` · `skill` · `memory` · `cache` · `cost` · `permission` · `eval` · `embedding` · `pause` · `error` · `fallback` · `resilience` · `reliability` · `risk`

**Tooling**
- **Lens** · **Explainable Trace** — two visual replays of the causal trace (separate `agentfootprint-lens` package)
- AI-coding-tool support — Claude Code · Cursor · Windsurf · Cline · Kiro · Copilot

> 📖 [Agent API reference](https://footprintjs.github.io/agentfootprint/api/agent/) · [CHANGELOG](./CHANGELOG.md)

---

## Where to next

| If you are... | Go here |
|---|---|
| New to agents | [5-minute quick start](https://footprintjs.github.io/agentfootprint/getting-started/quick-start/) |
| Coming from LangChain / CrewAI / LangGraph | [Migration guide](https://footprintjs.github.io/agentfootprint/getting-started/vs/) |
| Architecting an enterprise rollout | [Production guide](https://footprintjs.github.io/agentfootprint/guides/deployment/) |
| Doing due diligence | [Architecture overview](https://footprintjs.github.io/agentfootprint/architecture/dependency-graph/) |
| Researcher / academic background | [Citations & prior art](https://footprintjs.github.io/agentfootprint/research/citations/) |
| Curious about design | [Inspiration docs](https://footprintjs.github.io/agentfootprint/inspiration/) |

Or jump into the [examples gallery](https://github.com/footprintjs/agentfootprint/tree/main/examples) — every example is also an end-to-end CI test.

---

## Tree-shakeable & ESM-first

Import one thing, ship one thing. agentfootprint is built so your bundle grows only with what you actually use:

- **Dual build, true ESM.** Ships CommonJS (`require`) **and** real ECMAScript Modules (`import`) with TypeScript types. The ESM build is `type:module` with explicit `.js` import extensions, so it loads as true ESM under Node, Vite, Next, Deno, and Bun — no shims.
- **Per-file modules + honest `sideEffects`.** The dist is emitted file-by-file (never pre-bundled), so bundlers drop every export you don't touch. A small `import { defineTool }` doesn't pull in the Agent runtime, injection engine, memory stores, or LLM providers.
- **Subpath exports + lazy peer-deps.** Heavyweight integrations live behind their own subpaths and load their SDK **only when you instantiate them** — importing agentfootprint never bundles `@anthropic-ai/sdk`, `ioredis`, the AWS SDKs, or the MCP SDK unless you actually use that adapter.

**Proven, not promised.** A CI smoke test bundles a minimal `import { defineTool }` and asserts the Agent runtime, injection engine, memory stores, and providers are pruned; a second test loads the main barrel and every subpath as true ESM and verifies the lazy-adapter loader works under ESM (`createRequire`, not a bare `require`). See [`test/esm-packaging.test.ts`](test/esm-packaging.test.ts).

---

## Built on

[footprintjs](https://github.com/footprintjs/footPrint) — the flowchart pattern for backend code. agentfootprint's decision-evidence capture, narrative recording, and time-travel checkpointing are footprintjs primitives at the runtime layer.

You don't need to learn footprintjs to use agentfootprint — but if you want to build your own primitives at this depth, [start there](https://footprintjs.github.io/footPrint/).

---

## License

[MIT](./LICENSE) © [Sanjay Krishna Anbalagan](https://github.com/sanjay1909)

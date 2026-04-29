<p align="center">
  <h1 align="center">AgentFootPrint</h1>
  <p align="center">
    <strong>Context engineering, made buildable.</strong>
  </p>
</p>

<p align="center">
  <a href="https://github.com/footprintjs/agentfootprint/actions"><img src="https://github.com/footprintjs/agentfootprint/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/agentfootprint"><img src="https://img.shields.io/npm/v/agentfootprint.svg?style=flat" alt="npm version"></a>
  <a href="https://github.com/footprintjs/agentfootprint/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
  <a href="https://www.npmjs.com/package/agentfootprint"><img src="https://img.shields.io/npm/dm/agentfootprint.svg" alt="Downloads"></a>
  <a href="https://footprintjs.github.io/agentfootprint/"><img src="https://img.shields.io/badge/Docs-agentfootprint-facc15?style=flat&logo=typescript&logoColor=white" alt="Docs"></a>
  <a href="https://github.com/footprintjs/footPrint"><img src="https://img.shields.io/badge/Built_on-footprintjs-ca8a04?style=flat" alt="Built on footprintjs"></a>
</p>

<br>

**Building Generative AI applications is mostly *context engineering*** &mdash; deciding *what content lands in which slot of the LLM call, when, and why*. agentfootprint gives you a framework to build generative AI apps — single LLM calls, agents, multi-agent systems — where this discipline is **buildable at the control-flow level** (Sequence, Parallel, Conditional, Loop), not hidden inside new classes per paper.

```bash
npm install agentfootprint footprintjs
```

```typescript
const agent = Agent.create({ provider: anthropic(...) })
  .steering(tone)              // always-on persona
  .instruction(urgentRule)     // rule-gated, fires when matched
  .skill(billingSkill)         // LLM-activated body + tools
  .memory(causalMemory)        // cross-run "why" replay
  .build();
```

---

## What is context engineering?

Every LLM call has **three slots**:

```
┌──────────────────────────────────────────────────────────────┐
│  ┌─────────────────────┐  ┌──────────────┐  ┌────────────┐   │
│  │  system-prompt slot │  │ messages slot│  │ tools slot │   │
│  │  (instructions,     │  │ (history,    │  │ (functions │   │
│  │   persona, rules)   │  │  user input, │  │  the LLM   │   │
│  │                     │  │  tool results)│ │  may call) │   │
│  └─────────────────────┘  └──────────────┘  └────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

Context engineering is **deciding what flows into each slot, when**. The same content can be a *Skill* (LLM activates it), a *Steering* doc (always-on), an *Instruction* (rule-gated), a *Fact* (developer-supplied data), or a *Memory* (learned across runs). They're flavors of the same idea: **injection into a slot at the right moment**.

| Flavor | Slot | When it injects |
|---|---|---|
| **Skill** | system-prompt + tools | When the LLM calls `read_skill('billing')` |
| **Steering** | system-prompt | Always-on (persona, output format, safety) |
| **Instruction** | system-prompt or messages | Rule-gated (predicate matches the turn / a tool just returned) |
| **Fact** | system-prompt or messages | Always-on, but data &mdash; user profile, env, current time |
| **Memory** | messages | Learned across runs &mdash; window / facts / narrative / **causal snapshots** |
| **RAG** | messages | Retrieved chunks (rule + score threshold) |

You're not learning N new framework classes &mdash; you're learning **one model**: slot &times; flavor &times; timing.

---

## Where do you inject?

Into the three slots of the LLM API call:

| LLM API field | Holds | Examples of what you'd inject here |
|---|---|---|
| **`system` prompt** | Persona, rules, available capabilities | Steering doc · Instruction text · Skill body · Fact data · formatted memory |
| **`messages` array** | Conversation turns + tool results | Memory replay · RAG chunks · synthetic tool results · injected instructions on a recent turn |
| **`tools` array** | Function schemas the LLM may call | Skill-attached tools · permission-gated subset · per-iteration dynamic registry |

Every injection — Skill, Steering, Instruction, Fact, Memory, RAG, Guardrail — lands in **one of these three places**. There is no fourth slot.

## When (and how) do we inject?

Context engineering happens at runtime. Three timing levels of expressiveness:

```
1.  LLMCall                  ← one-shot. Inject once before the call.
       ↓
2.  Agent (ReAct loop)       ← inject before EVERY iteration.
       ↓
3.  Dynamic Agent            ← inject DIFFERENTLY per iteration based on
                                tool results, reasoning state, or user input.
```

The third level is where context engineering pays off. The agent calls a `redact_pii` tool → on the *next* iteration, an Instruction with `trigger: 'on-tool-return'` fires that says *"use the redacted text only, don't paraphrase the original"*. That kind of just-in-time injection is what separates an LLM that follows the rules from one that drifts.

agentfootprint handles all three timing levels through the **same** primitive (`Injection`), evaluated by the **same** engine, observed by the **same** event (`agentfootprint.context.injected`).

---

## Building a generative app = deciding when/how to inject

That's the discipline. agentfootprint abstracts it for you in two layers, both built on the [footprintjs](https://github.com/footprintjs/footPrint) flowchart substrate:

### Layer 1 — Single agent: one `Injection` primitive

For ONE agent, every Skill / Steering / Instruction / Fact / Memory / RAG is the same `Injection` primitive: *"this content lands in this slot when this trigger matches."* You define them; the engine evaluates them per iteration; observability flows through one event.

```
Agent  ─►  InjectionEngine  ─►  ┌─ system-prompt slot ─► CallLLM ─► Tools ─► loop
                                  ├─ messages slot
                                  └─ tools slot
```

### Layer 2 — Multi-agent: connect agents through control flow

For MULTIPLE agents, you don't need a new primitive. Connect them with the same control-flow building blocks that connect any flowchart stages:

| Composition | What it does | Multi-agent example |
|---|---|---|
| **Sequence** | A → B → C | `Sequence(Researcher, Writer, Editor)` — output flows downstream |
| **Parallel** | fan-out, merge | `Parallel(Critic1, Critic2, Critic3) + merge` — multi-perspective review |
| **Conditional** | predicate-based routing | route to specialist Agent based on intent classification |
| **Loop** | repeat with budget | `Loop(Agent + judge)` — iterate until quality bar hit |

That's it. **No `MultiAgentSystem` class. No `Orchestrator` class. No new vocabulary.** Multi-agent is just compositions of single Agents through control flow.

### Same abstraction → native patterns

Because the substrate is so small (Agent + Sequence/Parallel/Conditional/Loop), every named multi-agent pattern is just a recipe — and we ship runnable examples for the canonical ones:

| Pattern | Recipe | Source |
|---|---|---|
| **ReAct** | `Agent` with the default loop | Yao 2022 |
| **Reflexion** | `Sequence(Agent, critique-LLM, Agent)` | Shinn 2023 |
| **Tree-of-Thoughts** | `Parallel(Agent × N) + rank` | Yao 2023 |
| **Self-Consistency** | `Parallel(Agent × N) + majority-vote` | Wang 2022 |
| **Debate** | `Loop(Agent × 2 + judge)` | Du 2023 |
| **Map-Reduce** | `Parallel(Agent × N) + merge` | Dean 2004 |
| **Swarm** | `Agent` whose tools are other `Agent`s | OpenAI 2024 |

Browse them in [`examples/patterns/`](examples/patterns/). Every file runs end-to-end with `npm run example examples/patterns/<file>.ts`. **You compose. We don't ship a `ReflexionAgent` class.**

> **Show me the smallest one** — [`examples/patterns/02-reflection.ts`](examples/patterns/02-reflection.ts) implements Reflexion in ~30 lines. Run it: `npm run example examples/patterns/02-reflection.ts`.

---

## Why a context-engineering framework

If you're going to build generative AI apps on a framework, pick the one whose **core stays small as the field grows**. agentfootprint's core has *one* Injection primitive. Every current flavor reduces to it &mdash; and so will every flavor that hasn't been invented yet.

```
Skill        =  Injection { trigger: 'llm-activated', slots: [system-prompt, tools] }
Steering     =  Injection { trigger: 'always-on',     slots: [system-prompt] }
Instruction  =  Injection { trigger: 'rule',          slots: [system-prompt | messages] }
Fact         =  Injection { trigger: 'always-on',     slots: [system-prompt | messages] }
RAG          =  Injection { trigger: 'rule + score',  slots: [messages] }            (v2.1) ✓
Guardrail    =  Injection { trigger: 'on-tool-return',slots: [system-prompt]  }      (v2.x)
???          =  Injection { trigger: ?,               slots: ? }                    (your idea)
```

Adding the next flavor is **one new factory file** &mdash; no engine change, no slot subflow change, no consumer-API change. Lens chips, observability events, audit trails all flow through the same plumbing.

| | Frameworks growing class-per-paper | agentfootprint |
|---|---|---|
| Adding a new flavor (e.g. *guardrail*) | New `GuardrailAgent` class, new event type, new UI surface | One factory file, same `Injection` shape, same `context.injected` event |
| Cross-run "why was X rejected?" | LLM reconstructs from messages | Replay EXACT past decisions from causal snapshots |
| Training-data export | Manual, lossy, optional | Same snapshot shape → SFT / DPO / process-RL ready (v2.1+) |
| Decision evidence | Lost &mdash; only the final answer survives | First-class events from `decide()` / `select()` captured during traversal |

---

## Quick Start

```typescript
import {
  Agent, defineTool, defineSteering, defineInstruction,
  defineMemory, MEMORY_TYPES, MEMORY_STRATEGIES,
  InMemoryStore, anthropic,
} from 'agentfootprint';

// Want $0 testing? Swap `anthropic({...})` for `mock({ reply: '...' })`
// — same agent, same flowchart, no API key needed.

// 1. A tool the agent can call
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
  execute: async (args) => `${(args as { city: string }).city}: 72°F, sunny`,
});

// 2. Context engineering: one steering doc + one rule-gated instruction
const tone = defineSteering({
  id: 'tone',
  prompt: 'Be friendly and concise. Acknowledge feelings before facts.',
});

const urgent = defineInstruction({
  id: 'urgent',
  activeWhen: (ctx) => /urgent|asap|emergency/i.test(ctx.userMessage),
  prompt: 'The user marked this urgent. Prioritize the fastest resolution.',
});

// 3. Memory across runs
const memory = defineMemory({
  id: 'short-term',
  type: MEMORY_TYPES.EPISODIC,
  strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },
  store: new InMemoryStore(),
});

// 4. Build — every layer composes
const agent = Agent.create({
  provider: anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! }),
  model: 'claude-sonnet-4-5-20250929',
})
  .system('You are a helpful weather assistant.')
  .tool(weather)
  .steering(tone)
  .instruction(urgent)
  .memory(memory)
  .build();

// 5. Run with multi-tenant identity
const id = { conversationId: 'alice-session' };
await agent.run({ message: 'Weather in SF urgently?', identity: id });
```

Every `.steering` / `.instruction` / `.memory` / `.tool` call adds an injection or a binding. The Agent's flowchart shows them as visible subflows in the narrative &mdash; you can read exactly *what landed in which slot, when, and why* for any run.

---

## Memory &mdash; one factory, four types, seven strategies

`defineMemory({ type, strategy, store })` &mdash; one factory dispatches `type &times; strategy.kind` onto the right pipeline.

| Type | What's stored |
|---|---|
| `EPISODIC` | Raw conversation messages |
| `SEMANTIC` | Extracted structured facts |
| `NARRATIVE` | Beats / summaries of prior runs |
| **`CAUSAL`** ⭐ | **footprintjs decision-evidence snapshots** &mdash; replay "why" cross-run, zero hallucination |

| Strategy | How content is selected |
|---|---|
| `WINDOW` | Last N entries (rule, no LLM, no embeddings) |
| `BUDGET` | Fit-to-tokens (decider) |
| `SUMMARIZE` | LLM compresses older turns |
| `TOP_K` | Score-threshold semantic retrieval |
| `EXTRACT` | LLM distills facts/beats on write |
| `DECAY` | Recency-weighted (planned) |
| `HYBRID` | Compose multiple |

**Causal memory** is the differentiator: footprintjs's `decide()` and `select()` capture decision evidence as first-class events. Causal memory persists those snapshots tagged with the user's original query. New questions cosine-match past queries → inject the prior decision evidence → the LLM answers from EXACT past facts. Cross-run "why was X rejected last week?" follow-ups answer correctly without reconstruction.

The same snapshot data shape becomes RL/SFT/DPO training data in v2.1+.

---

## Documentation

| Resource | Link |
|---|---|
| **Getting Started** | [Quick Start](https://footprintjs.github.io/agentfootprint/getting-started/quick-start/) &middot; [Key Concepts](https://footprintjs.github.io/agentfootprint/getting-started/key-concepts/) &middot; [Why agentfootprint?](https://footprintjs.github.io/agentfootprint/getting-started/why/) |
| **Guides** | [Agent](https://footprintjs.github.io/agentfootprint/guides/agent/) &middot; [Memory](https://footprintjs.github.io/agentfootprint/guides/memory/) &middot; [Skills](https://footprintjs.github.io/agentfootprint/guides/skills-explained/) &middot; [Instructions](https://footprintjs.github.io/agentfootprint/guides/instructions/) &middot; [Streaming](https://footprintjs.github.io/agentfootprint/guides/streaming/) |
| **Examples** | [33 runnable examples](https://github.com/footprintjs/agentfootprint/tree/main/examples) &mdash; primitives, compositions, patterns, context engineering, memory, runtime features |
| **Integrations** | [Anthropic](https://footprintjs.github.io/agentfootprint/integrations/anthropic/) &middot; [OpenAI](https://footprintjs.github.io/agentfootprint/integrations/openai/) &middot; [AWS Bedrock](https://footprintjs.github.io/agentfootprint/integrations/aws-bedrock/) &middot; [Ollama](https://footprintjs.github.io/agentfootprint/integrations/ollama/) |
| **Built on** | [footprintjs](https://github.com/footprintjs/footPrint) &mdash; the flowchart pattern for backend code |

---

## What v2.0 ships (today)

- **2 primitives** — `LLMCall`, `Agent` (ReAct loop)
- **3 compositions + Loop** — Sequence · Parallel · Conditional · Loop
- **6 LLM providers** — Anthropic · OpenAI · Bedrock · Ollama · Browser-Anthropic · Browser-OpenAI · Mock (for $0 testing)
- **InjectionEngine** — one `Injection` primitive + 4 typed factories (`defineSkill` / `defineSteering` / `defineInstruction` / `defineFact`); covers Dynamic ReAct via `on-tool-return` triggers
- **Memory subsystem** — `defineMemory` factory, 4 types (Episodic / Semantic / Narrative / **Causal** ⭐) × 7 strategies (Window / Budget / Summarize / TopK / Extract / Decay / Hybrid)
- **Multi-agent through control flow** — no separate `MultiAgentSystem` class; agents compose via Sequence / Parallel / Conditional / Loop
- **6 canonical patterns** runnable as examples — ReAct · Reflexion · ToT · Self-Consistency · Debate · Map-Reduce · Swarm
- **Observability** — 47 typed events × 13 domains; recorders for context · stream · agent · cost · skill · permission · eval · memory
- **Resilience helpers** — `withRetry`, `withFallback`, `resilientProvider`
- **Pause / resume** — JSON-serializable checkpoints; agent can pause via `askHuman`/`pauseHere` and resume hours later on a different server
- **AI-coding-tool support** — bundled instructions for Claude Code / Cursor / Windsurf / Cline / Kiro / Copilot
- **33 runnable end-to-end examples** — every example is a real test exercising the documented surface

## What's next

| Release | Focus |
|---|---|
| ~~v2.1~~ ✓ | RAG flavor (`defineRAG`) — shipped in 2.1.0 |
| v2.2 | MCP integration (`mcpClient`) ✓ · Redis memory store adapter · CircuitBreaker primitive · 3-tier structured-output fallback |
| v2.2 | Governance subsystem (`Policy`, `BudgetTracker`, role-based access) · DynamoDB / Postgres / Pinecone store adapters |
| v2.3 | Causal training-data exports — `causalMemory.exportForTraining({ format: 'sft' \| 'dpo' \| 'process' })` for HuggingFace / OpenAI / Anthropic batch fine-tune |
| v2.4+ | Deep Agents (planning-before-execution) · A2A protocol · Lens UI deep-link |

---

[MIT](./LICENSE) &copy; [Sanjay Krishna Anbalagan](https://github.com/sanjay1909)

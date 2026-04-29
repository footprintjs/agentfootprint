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

**Building agents is mostly *context engineering*** &mdash; deciding *what content lands in which slot of the LLM call, when, and why*. agentfootprint is the library that makes this discipline buildable: at the **control-flow level** (Sequence, Parallel, Conditional, Loop), not as another framework with new classes per paper.

```bash
npm install agentfootprint footprintjs
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

## How does this library help you build it?

agentfootprint sits on [footprintjs](https://github.com/footprintjs/footPrint) &mdash; the flowchart pattern for backend code. That gives you context engineering at the **control-flow level**, not as a new abstraction layer:

```
┌─ 2 primitives ──────────────────────────────────────────────┐
│  LLMCall   — one shot                                       │
│  Agent     — ReAct loop (LLM ↔ tools)                       │
├─ 3 compositions + Loop ─────────────────────────────────────┤
│  Sequence    — A → B → C                                     │
│  Parallel    — fan-out, merge                                │
│  Conditional — predicate-based routing                       │
│  Loop        — repeat-with-budget                            │
└─────────────────────────────────────────────────────────────┘
```

That's the whole substrate. Every "named pattern" is a **recipe** built from these:

- **ReAct** = `Agent` with the default loop
- **Reflexion** = `Sequence(Agent, critique-LLM, Agent)`
- **Tree-of-Thoughts** = `Parallel(Agent &times; N) + rank`
- **Map-Reduce** = `Parallel(Agent &times; N) + merge`
- **Swarm** = `Agent` whose tools are other `Agent`s

You compose. We don't ship a `ReflexionAgent` class.

---

## Out-of-box patterns &mdash; ready to copy

For the canonical patterns, we ship runnable examples. Each is pure composition over the substrate:

| Pattern | Built from | Source |
|---|---|---|
| **ReAct** | Agent (default) | Yao 2022 |
| **Reflexion** | Sequence(Agent, critique, Agent) | Shinn 2023 |
| **Tree-of-Thoughts** | Parallel + rank | Yao 2023 |
| **Self-Consistency** | Parallel + majority-vote | Wang 2022 |
| **Debate** | Loop(Agent &times; 2 + judge) | Du 2023 |
| **Map-Reduce** | Parallel + merge | Dean 2004 (LLM-applied) |
| **Swarm (Hierarchy)** | Agent whose tools are Agents | OpenAI 2024 |

Browse them all in [`examples/patterns/`](examples/patterns/) &mdash; every file runs end-to-end with `npm run example examples/patterns/<file>.ts`.

---

## Quick Start

```typescript
import {
  Agent, defineTool, defineSteering, defineInstruction,
  defineMemory, MEMORY_TYPES, MEMORY_STRATEGIES,
  InMemoryStore, mock,
} from 'agentfootprint';

// 1. A tool the agent can call
const weather = defineTool({
  schema: { name: 'weather', description: 'Current weather.', inputSchema: {...} },
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
const agent = Agent.create({ provider: mock({ reply: '...' }), model: 'mock' })
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

## Why a context-engineering framework

If you're going to build agents on a framework, pick the one whose **core stays small as the field grows**. agentfootprint's core has *one* Injection primitive. Every current flavor reduces to it &mdash; and so will every flavor that hasn't been invented yet.

```
Skill        =  Injection { trigger: 'llm-activated', slots: [system-prompt, tools] }
Steering     =  Injection { trigger: 'always-on',     slots: [system-prompt] }
Instruction  =  Injection { trigger: 'rule',          slots: [system-prompt | messages] }
Fact         =  Injection { trigger: 'always-on',     slots: [system-prompt | messages] }
RAG          =  Injection { trigger: 'rule + score',  slots: [messages] }            (v2.1)
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

## Documentation

| Resource | Link |
|---|---|
| **Getting Started** | [Quick Start](https://footprintjs.github.io/agentfootprint/getting-started/quick-start/) &middot; [Key Concepts](https://footprintjs.github.io/agentfootprint/getting-started/key-concepts/) &middot; [Why agentfootprint?](https://footprintjs.github.io/agentfootprint/getting-started/why/) |
| **Guides** | [Agent](https://footprintjs.github.io/agentfootprint/guides/agent/) &middot; [Memory](https://footprintjs.github.io/agentfootprint/guides/memory/) &middot; [Skills](https://footprintjs.github.io/agentfootprint/guides/skills-explained/) &middot; [Instructions](https://footprintjs.github.io/agentfootprint/guides/instructions/) &middot; [Streaming](https://footprintjs.github.io/agentfootprint/guides/streaming/) |
| **Examples** | [33 runnable examples](https://github.com/footprintjs/agentfootprint/tree/main/examples) &mdash; primitives, compositions, patterns, context engineering, memory, runtime features |
| **Integrations** | [Anthropic](https://footprintjs.github.io/agentfootprint/integrations/anthropic/) &middot; [OpenAI](https://footprintjs.github.io/agentfootprint/integrations/openai/) &middot; [AWS Bedrock](https://footprintjs.github.io/agentfootprint/integrations/aws-bedrock/) &middot; [Ollama](https://footprintjs.github.io/agentfootprint/integrations/ollama/) |
| **Built on** | [footprintjs](https://github.com/footprintjs/footPrint) &mdash; the flowchart pattern for backend code |

---

## Roadmap

| Release | Focus |
|---|---|
| **v2.0 (this)** | Foundation + InjectionEngine + Memory (4 types &times; 7 strategies + Causal) |
| v2.1 | Reliability subsystem (3-tier fallback, CircuitBreaker, auto-retry, fault-tolerant resume) + Redis store adapter |
| v2.2 | Governance subsystem (Policy, BudgetTracker, access levels) + DynamoDB adapter |
| v2.3 | Causal training-data exports (`exportForTraining({ format: 'sft' \| 'dpo' \| 'process' })`) |
| v2.4+ | MCP integration, Deep Agents, A2A protocol |

---

[MIT](./LICENSE) &copy; [Sanjay Krishna Anbalagan](https://github.com/sanjay1909)

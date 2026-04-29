<p align="center">
  <h1 align="center">AgentFootPrint</h1>
  <p align="center">
    <strong>The agent framework where every decision, tool call, and memory write is captured as a typed event &mdash; built on the flowchart pattern.</strong>
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

**Other agent frameworks invent new classes for every paper. agentfootprint is a different pattern** &mdash; one `Injection` primitive shapes context, one `defineMemory` factory captures persistence, and **causal memory** lets agents answer follow-up questions from exact past decision evidence. Built on [footprintjs](https://github.com/footprintjs/footPrint), so the trace is already there &mdash; no instrumentation, no post-processing, no hallucination.

```bash
npm install agentfootprint footprintjs
```

---

## The Problem

Your agent decided to reject a loan. Days later, the user asks: **"Why was I rejected?"**

| | LangGraph / Strands / CrewAI | agentfootprint |
|---|---|---|
| **Cross-run "why?" follow-up** | LLM reconstructs reasoning from messages | Replay the EXACT decision evidence from a stored snapshot &mdash; zero hallucination |
| **Memory model** | One conversation history per session | 4 types &times; 7 strategies, single `defineMemory({ type, strategy, store })` factory |
| **Context engineering** | N classes (RAG, Memory, Skills, Instructions) | One `Injection` primitive, four typed sugar factories |
| **Decision evidence** | Lost &mdash; only the final answer survives | First-class events captured by `decide()` / `select()` during traversal |
| **Training-data export** | Manual, lossy, optional | Same snapshot data shape &rarr; SFT / DPO / process-RL ready (v2.1+) |

---

## How It Works

A loan agent rejects Bob on Monday. On Friday &mdash; in a **new conversation** &mdash; Bob asks:

> "Why was my application rejected last week?"

Most agent libraries lose this signal. agentfootprint captures it.

**Monday's run** (snapshot persisted automatically):

```
[Seed]            user: Approve loan #42? creditScore=580 dti=0.45
[CallLLM]         decide → 'rejected'
                    rule "tier-A" failed (creditScore < 600)
                    rule "manual-review" failed (dti > 0.43)
                    defaulted to "rejected"
[Final]           Rejected. creditScore=580 below threshold of 600.
[MemoryWrite]     causal snapshot stored, embedded by query
```

**Friday's run** (different conversation, same `identity.principal`):

```
[Seed]            user: Why was my application rejected last week?
[MemoryRead]      causal: cosine-match to Monday's snapshot (score=0.89)
                  → inject DECISIONS projection into system context
[CallLLM]         answers from EXACT past facts, not from imagination:
[Final]           "Rejected because creditScore=580 was below the
                   threshold of 600. The 'manual-review' rule didn't
                   trigger because dti=0.45 exceeded the 0.43 cap."
```

That answer came from the trace &mdash; not from the LLM's imagination.

---

## Quick Start

```typescript
import {
  Agent, defineTool, defineMemory,
  MEMORY_TYPES, MEMORY_STRATEGIES,
  InMemoryStore, mock,
} from 'agentfootprint';

// 1. Define a tool
const weather = defineTool({
  schema: {
    name: 'weather',
    description: 'Current weather for a city.',
    inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
  },
  execute: async (args) => `${(args as { city: string }).city}: 72°F, sunny`,
});

// 2. Add memory
const memory = defineMemory({
  id: 'short-term',
  type: MEMORY_TYPES.EPISODIC,
  strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },
  store: new InMemoryStore(),
});

// 3. Build the agent (mock provider for $0 testing)
const agent = Agent.create({ provider: mock({ reply: 'Sunny, 72°F.' }), model: 'mock' })
  .system('You answer weather questions using the `weather` tool.')
  .tool(weather)
  .memory(memory)
  .build();

// 4. Run — multi-tenant via identity
const result = await agent.run({
  message: 'Weather in SF?',
  identity: { conversationId: 'demo' },
});

// 5. Inspect what happened
console.log(agent.getNarrative());
agent.on('agentfootprint.context.injected', (e) =>
  console.log(`[${e.payload.source}] landed in ${e.payload.slot} slot`));
```

> **[Browse 33+ runnable examples](https://github.com/footprintjs/agentfootprint/tree/main/examples)** &mdash; primitives, compositions, patterns, context engineering, all 7 memory strategies, runtime features. Run any one with `npm run example examples/<path>.ts`.

---

## The Six Layers

Every layer is pure composition over the layers below &mdash; no hidden primitives.

```
PRIMITIVES (2)         LLMCall · Agent (= ReAct)
COMPOSITIONS (3)       Sequence · Parallel · Conditional + Loop
PATTERNS (N)           ReAct · Reflexion · ToT · Debate · MapReduce ·
                       SelfConsistency · Swarm · …
CONTEXT ENGINEERING    defineSkill · defineSteering · defineInstruction
                       · defineFact (one Injection primitive, N factories)
MEMORY                 defineMemory({ type, strategy, store })
                       4 types · 7 strategies · Causal differentiator ⭐
FEATURES               Pause/Resume · Cost · Permissions · Observability
                       · Events (47 typed events × 13 domains)
```

> **Two theses:**
> 1. **Agent = ReAct.** If it doesn't loop-with-tools, it isn't an Agent.
> 2. **Every named paper is a recipe of primitives + compositions + injections.** Reflexion = `Sequence(Agent, critique-LLM, Agent)`. Tree-of-Thoughts = `Parallel(Agent × N) + rank`. Swarm = Agent whose tools are Agents. RAG / Memory / Skills aren't primitives &mdash; they're context engineering, *what you inject* into one of three slots.

---

## Memory &mdash; the differentiator

`defineMemory({ type, strategy, store })` &mdash; one factory dispatches `type × strategy.kind` onto the right pipeline. Type = *what shape you keep*, strategy = *how you fit it into the next LLM call*, store = *where the bytes live*.

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
| `SUMMARIZE` | LLM compresses older turns ("context janitor") |
| `TOP_K` | Score-threshold semantic retrieval |
| `EXTRACT` | LLM distills facts/beats on write |
| `DECAY` | Recency-weighted (planned) |
| `HYBRID` | Compose multiple |

**Causal memory** persists footprintjs `decide()` / `select()` evidence so the agent can answer follow-up questions from exact past facts. The same snapshot data shape becomes RL/SFT/DPO training data in v2.1+ &mdash; every successful production run becomes a labeled trajectory.

---

## Context Engineering &mdash; one primitive, four flavors

Every "skill" / "steering doc" / "instruction" / "fact" is the same `Injection` primitive with a different trigger. One engine subflow evaluates them; one event (`agentfootprint.context.injected`) reports where each landed.

```typescript
import { defineSkill, defineSteering, defineInstruction, defineFact } from 'agentfootprint';

agent
  .steering(defineSteering({ id: 'tone', prompt: 'Be friendly and concise.' }))
  .instruction(defineInstruction({
    id: 'urgent',
    activeWhen: (ctx) => /urgent|asap/i.test(ctx.userMessage),
    prompt: 'Prioritize the fastest path to resolution.',
  }))
  .skill(defineSkill({
    id: 'account', description: 'Use for password resets.',
    body: 'Confirm identity (last 4 digits) before resetting.',
    tools: [resetPasswordTool],
  }))
  .fact(defineFact({ id: 'user', data: 'User: Alice (alice@example.com), Plan: Pro.' }));
```

| Factory | Slot | Trigger |
|---|---|---|
| `defineSteering` | system-prompt | always-on |
| `defineInstruction` | system-prompt OR messages | predicate (`activeWhen`) &mdash; including `on-tool-return` for Dynamic ReAct |
| `defineSkill` | system-prompt + tools | LLM-activated (`read_skill`) |
| `defineFact` | system-prompt OR messages | always-on (data, not behavior) |

---

## Features

| Feature | Description |
|---|---|
| **Causal memory** | footprintjs `decide()` evidence persisted &mdash; cross-run "why?" follow-ups answer from exact past facts |
| **`defineMemory` factory** | One factory, 4 types &times; 7 strategies &mdash; from sliding window to LLM summarization to vector retrieval |
| **InjectionEngine** | One `Injection` primitive, four typed factories &mdash; same engine subflow handles Skill, Steering, Instruction, Fact |
| **Multi-tenant identity** | `agent.run({ identity: { tenant, principal, conversationId } })` &mdash; full namespace isolation in stores |
| **Adapter-swap testing** | `mock(...)` for tests, `anthropic(...)` / `openai(...)` / `bedrock(...)` for prod &mdash; same agent, $0 CI |
| **Human-in-the-loop** | `pauseHere()` / `askHuman()` &mdash; agent pauses, serializes to JSON, resumes hours later on a different server |
| **47 typed events** | Across 13 domains (context, agent, stream, tools, skill, permission, eval, cost, memory, …) |
| **Built on flowchart pattern** | Inherits causal traces, decision evidence, single-DFS observability from footprintjs |

---

## AI Coding Tool Support

agentfootprint ships with built-in instructions for AI coding assistants. Your AI tool understands the API, patterns, and anti-patterns out of the box (the project's `CLAUDE.md` is the reference; other tools follow).

| Tool | Source |
|---|---|
| **Claude Code** | `CLAUDE.md` at the repo root |
| **Cursor / Windsurf / Cline / Copilot** | Mirror `CLAUDE.md` into the tool's rules file |

---

## Documentation

| Resource | Link |
|---|---|
| **Getting Started** | [Quick Start](https://footprintjs.github.io/agentfootprint/getting-started/quick-start/) &middot; [Key Concepts](https://footprintjs.github.io/agentfootprint/getting-started/key-concepts/) &middot; [Why agentfootprint?](https://footprintjs.github.io/agentfootprint/getting-started/why/) |
| **Guides** | [Agent](https://footprintjs.github.io/agentfootprint/guides/agent/) &middot; [Memory](https://footprintjs.github.io/agentfootprint/guides/memory/) &middot; [Skills](https://footprintjs.github.io/agentfootprint/guides/skills-explained/) &middot; [Instructions](https://footprintjs.github.io/agentfootprint/guides/instructions/) &middot; [Streaming](https://footprintjs.github.io/agentfootprint/guides/streaming/) |
| **Examples** | [33 runnable examples](https://github.com/footprintjs/agentfootprint/tree/main/examples) &mdash; primitives, patterns, context engineering, memory, features |
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

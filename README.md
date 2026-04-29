<p align="center">
  <h1 align="center">AGENT FOOTPRINT</h1>
  <p align="center">
    <strong>Context engineering, visible.</strong>
  </p>
</p>

<p align="center">
  <a href="https://github.com/footprintjs/agentfootprint/actions"><img src="https://github.com/footprintjs/agentfootprint/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/agentfootprint"><img src="https://img.shields.io/npm/v/agentfootprint.svg?style=flat" alt="npm version"></a>
  <a href="https://img.shields.io/npm/dm/agentfootprint.svg"><img src="https://img.shields.io/npm/dm/agentfootprint.svg" alt="Downloads"></a>
  <a href="https://github.com/footprintjs/agentfootprint/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
  <br>
  <a href="https://footprintjs.github.io/agentfootprint/"><img src="https://img.shields.io/badge/Docs-agentfootprint-facc15?style=flat&logo=typescript&logoColor=white" alt="Docs"></a>
  <a href="https://footprintjs.github.io/footPrint/"><img src="https://img.shields.io/badge/Built_on-footprintjs-ca8a04?style=flat" alt="Built on footprintjs"></a>
</p>

> Most agent frameworks invent new class names for every paper. agentfootprint
> gives you **2 primitives, 3 compositions, 1 unified injection primitive, and
> 1 memory factory** — and makes every "feature" explicit about *what content
> it injects into which slot, when, and why*. Students and engineers can read
> any agent paper and see it in agentfootprint terms.

```bash
npm install agentfootprint
```

## Hello, agent

```typescript
import { Agent, defineTool, mock } from 'agentfootprint';

const agent = Agent.create({ provider: mock({ reply: 'Sunny, 72°F.' }) })
  .system('You answer weather questions using the `weather` tool.')
  .tool(defineTool({
    schema: { name: 'weather', description: 'Current weather', inputSchema: { ... } },
    execute: async (args) => `${args.city}: sunny, 72°F`,
  }))
  .build();

const answer = await agent.run({ message: 'Weather in SF?' });
```

## Memory in 5 lines

```typescript
import {
  Agent, defineMemory, MEMORY_TYPES, MEMORY_STRATEGIES, InMemoryStore, mock,
} from 'agentfootprint';

const memory = defineMemory({
  id: 'short-term',
  type: MEMORY_TYPES.EPISODIC,
  strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },
  store: new InMemoryStore(),
});

const agent = Agent.create({ provider: mock({ reply: 'Hi Alice!' }) })
  .memory(memory)
  .build();

await agent.run({ message: 'My name is Alice', identity: { conversationId: 'c1' } });
const result = await agent.run({ message: 'What did I just say?', identity: { conversationId: 'c1' } });
// → memory subflow loaded the prior turn, agent answers from context
```

## The mental model

Six layers, each pure composition over the layers below — no hidden primitives.

```
┌─ 2 primitives ──────────────────────┐
│  LLMCall · Agent (= ReAct)          │
├─ 3 compositions ────────────────────┤
│  Sequence · Parallel · Conditional  │
│  + Loop                             │
├─ N patterns (pure composition) ─────┤
│  ReAct · Reflexion · ToT · Debate · │
│  MapReduce · SelfConsistency · Swarm│
├─ Context engineering (1 primitive) ─┤
│  Injection × N typed sugar:         │
│    defineSkill · defineSteering ·   │
│    defineInstruction · defineFact   │
├─ Memory (TYPE × STRATEGY × STORE) ──┤
│  4 types × 7 strategies, single     │
│  defineMemory({...}) factory        │
├─ Production features ───────────────┤
│  Pause/resume · Cost · Permissions ·│
│  Observability · Events             │
└─────────────────────────────────────┘
```

## Context engineering — one primitive, four flavors

Every "skill" / "steering doc" / "instruction" / "fact" is the same
`Injection` primitive with a different trigger. One engine subflow
evaluates them; one event (`agentfootprint.context.injected`) reports
where each landed.

```typescript
import { Agent, defineSkill, defineSteering, defineInstruction, defineFact } from 'agentfootprint';

const agent = Agent.create({ provider })
  // Always-on policies
  .steering(defineSteering({ id: 'tone', prompt: 'Be friendly and concise.' }))
  // Predicate-gated rules
  .instruction(defineInstruction({
    id: 'urgent',
    activeWhen: (ctx) => /urgent|asap/i.test(ctx.userMessage),
    prompt: 'Prioritize the fastest path to resolution.',
  }))
  // LLM-activated body + tools
  .skill(defineSkill({
    id: 'account',
    description: 'Use for password resets, profile updates.',
    body: 'Confirm identity (last 4 digits) before resetting.',
    tools: [resetPasswordTool],
  }))
  // Developer-supplied data
  .fact(defineFact({ id: 'user', data: 'User: Alice (alice@example.com), Plan: Pro.' }))
  .build();
```

| Factory | Slot | Trigger |
|---|---|---|
| `defineSteering` | system-prompt | always-on |
| `defineInstruction` | system-prompt OR messages | predicate (`activeWhen`) — including `on-tool-return` for Dynamic ReAct |
| `defineSkill` | system-prompt + tools | LLM-activated (`read_skill`) |
| `defineFact` | system-prompt OR messages | always-on (data, not behavior) |

## Memory — TYPE × STRATEGY × STORE

A single `defineMemory({ type, strategy, store })` factory dispatches
to the right pipeline. Type = *what shape you keep*, strategy = *how
you fit it into the next LLM call*, store = *where the bytes live*.

| `MEMORY_TYPES.X` | What's stored |
|---|---|
| `EPISODIC` | Raw conversation messages |
| `SEMANTIC` | Extracted structured facts |
| `NARRATIVE` | Beats / summaries of prior runs |
| **`CAUSAL`** ⭐ | **footprintjs decision-evidence snapshots** — replay "why" cross-run |

| `MEMORY_STRATEGIES.X` | How content is selected |
|---|---|
| `WINDOW` | Last N entries (rule, no LLM, no embeddings) |
| `BUDGET` | Fit-to-tokens (decider) |
| `SUMMARIZE` | LLM compresses older turns ("context janitor") |
| `TOP_K` | Score-threshold semantic retrieval |
| `EXTRACT` | LLM distills facts/beats on write |
| `DECAY` | Recency-weighted (planned) |
| `HYBRID` | Compose multiple |

### Causal memory — the differentiator

footprintjs's `decide()` / `select()` capture decision evidence as
first-class events during traversal. Causal memory persists those
snapshots tagged with the original user query. New questions match
against past queries via cosine similarity → inject the prior
decision evidence → LLM answers from EXACT past facts.

**Zero hallucination on follow-up questions.** No other library has this
because no other library captures WHY (decision evidence) alongside
WHAT (state) in the first place.

```typescript
const causal = defineMemory({
  id: 'causal',
  type: MEMORY_TYPES.CAUSAL,
  strategy: {
    kind: MEMORY_STRATEGIES.TOP_K,
    topK: 1,
    threshold: 0.7,                  // strict: no fallback if nothing matches
    embedder: yourEmbedder,
  },
  store,
  projection: SNAPSHOT_PROJECTIONS.DECISIONS,
});

// Turn 1 (Monday):
await agent.run({ message: 'Approve loan #42? score=580', identity });
// Turn 2 (Friday, NEW conversation):
await agent.run({ message: 'Why was that rejected?', identity });
// → causal subflow finds the Monday snapshot, injects decision evidence
// → "Rejected because creditScore=580 was below threshold of 600."
```

The same snapshot data shape becomes RL/SFT training data in v2.1+
via `causalMemory.exportForTraining({ format: 'sft' | 'dpo' | 'process' })`.

## Examples — pick one and run it

```bash
npm run example examples/memory/06-causal-snapshot.ts
```

Folder map:
- [`examples/core/`](examples/core/) — primitives (LLMCall, Agent + tools)
- [`examples/core-flow/`](examples/core-flow/) — Sequence / Parallel / Conditional / Loop
- [`examples/patterns/`](examples/patterns/) — 6 canonical patterns
- [`examples/context-engineering/`](examples/context-engineering/) — 6 InjectionEngine flavors
- [`examples/memory/`](examples/memory/) — 7 memory strategies (window / budget / summarize / topK / extract / **causal** / hybrid)
- [`examples/features/`](examples/features/) — pause-resume, cost, permissions, observability, events

Every example is a runnable end-to-end test (CI uses `npm run test:examples`).
Each example has a `.md` companion explaining when to use it.

## Architecture

```
Layer 1: BUILD          → core/         LLMCall · Agent · defineTool
                          core-flow/    Sequence · Parallel · Conditional · Loop
                          patterns/     ReAct, Reflexion, ToT, MapReduce, ...

Layer 2: ENGINEER       → lib/          InjectionEngine — one primitive,
                                         N typed sugar factories, one engine
                                         subflow + 3 slot subflows
                          memory/       defineMemory factory + 4 types ×
                                         7 strategies + reference InMemoryStore

Layer 3: OBSERVE        → recorders/    Context · Stream · Agent · Cost ·
                                         Skill · Permission · Eval · Memory
                                         (all 5 monitoring dimensions covered)

Layer 4: PROVIDERS      → adapters/     Anthropic · OpenAI · Bedrock · Ollama
                                         · Browser variants · Mock · resilient

Layer 5: STORAGE        → memory/store/ MemoryStore interface +
                                         InMemoryStore reference. Redis,
                                         DynamoDB, AgentCore, Postgres,
                                         Pinecone adapters land via subpath
                                         exports as peer-deps.
```

Built on [footprintjs](https://github.com/footprintjs/footPrint) — the
flowchart pattern for backend code. **One DFS traversal, three observer
channels** (scope / flow / emit), connected data out. The single-pass
guarantee is what makes Causal memory possible.

## Roadmap

| Release | Focus |
|---|---|
| v2.0 (this) | Foundation + InjectionEngine + Memory (4 types × 7 strategies + Causal) |
| v2.1 | Reliability subsystem (3-tier fallback, CircuitBreaker, auto-retry, fault-tolerant resume) + Redis store adapter |
| v2.2 | Governance subsystem (Policy, BudgetTracker, access levels) + DynamoDB adapter |
| v2.3 | Causal training-data exports (SFT / DPO / process-RL) + RLPolicyRecorder |
| v2.4+ | MCP integration, Deep Agents, A2A |

## Adapter-swap testing

Write tests with `mock()`, deploy with the real provider. **$0 test runs,
identical code path.**

```typescript
import { mock, anthropic } from 'agentfootprint';

const provider = process.env.NODE_ENV === 'test'
  ? mock({ reply: 'Paris.' })
  : anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, model: 'claude-sonnet-4-5' });
```

Works with Anthropic, OpenAI, Bedrock, Ollama. No lock-in.

---

[MIT](./LICENSE) &copy; [Sanjay Krishna Anbalagan](https://github.com/sanjay1909)

---
name: agentfootprint
description: Use when building AI agents with agentfootprint — LLMCall, Agent, skills, RAG, memory, control flow, Swarm concepts, mock/anthropic/openai/ollama providers, tools, recorders, resilience, and streaming. Also use when someone asks how agentfootprint works or wants to understand the framework.
---

# agentfootprint — The Explainable Agent Framework

agentfootprint structures AI agents as composable flowcharts, so every injection, read, write, decision and tool call becomes connected evidence as the run happens. Every concept takes an `LLMProvider` — swap `mock({...})` for `anthropic({...})` with zero code changes.

**Core principles:**
- Adapter-swap testing ($0 test runs, deterministic assertions)
- The ladder: `mock` → `ollama` (free, local, real model) → a paid provider
- Declare context (facts, steering, skills); the framework decides WHEN it fires and WHICH slot it lands in
- Collect during traversal, never post-process (inherited from footprintjs)

```bash
npm install agentfootprint footprintjs
```

## Subpath map — 10 doors

`agentfootprint` (main barrel: `Agent`, `LLMCall`, `defineTool`, control flow, patterns, `defineRAG`, pause/resume) · `/providers` (`mock`, `anthropic`, `openai`, `bedrock`, `ollama` — every provider, so bundlers never walk the vendor SDKs from the main barrel) · `/context` (`defineSkill`, `defineFact`, `defineSteering`, `skillGraph`) · `/memory` (`InMemoryStore`, `mockEmbedder`) · `/rag` (stores + loaders) · `/observe` (recorders, tracing) · `/resilience` · `/security` · `/hosting` · `/events`.

## Core Concepts

### LLMCall — a single LLM call, no tools

```typescript
import { LLMCall } from 'agentfootprint';
import { mock } from 'agentfootprint/providers';

const caller = LLMCall.create({ provider: mock({ reply: 'Hello!' }), model: 'mock' }).system('You are helpful.').build();
const result = await caller.run({ message: 'Hi' });
```

### Agent — a ReAct agent with tools

```typescript
import { Agent, defineTool } from 'agentfootprint';
import { mock } from 'agentfootprint/providers';

const weather = defineTool({
  name: 'weather',
  description: 'Get current weather for a city.',
  inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
  execute: async ({ city }: { city: string }) => `${city}: 72°F, sunny`,
});

const agent = Agent.create({ provider: mock({ reply: 'It is 72°F.' }), model: 'mock' })
  .system('You answer weather questions using the weather tool.')
  .tool(weather)
  .maxIterations(5)
  .build();

const result = await agent.run({ message: 'Weather in Paris?' });
```

### Context — facts, steering, skills, and declared routing

```typescript
import { defineFact, defineSteering, defineSkill, skillGraph } from 'agentfootprint/context';

Agent.create({ provider, model })
  .fact(defineFact({ id: 'user-profile', data: 'Plan: Pro · Customer since 2022' }))
  .steering(defineSteering({ id: 'policy', prompt: 'Never promise a refund before checking.' }))
  .skill(defineSkill({ id: 'refunds', description: 'Refund procedure.', body: '…', tools: [issueRefund] }))
  .build();
```

`defineSkill` bodies load on demand — the model opens one with `read_skill`, or a `skillGraph()` routes to it:

```typescript
const graph = skillGraph()
  .entry(triage, { when: (c) => /order/.test(c.userMessage) })   // where the turn STARTS
  .route(triage, refunds, { onToolReturn: 'lookup_order' })      // a declared handoff
  .build();

Agent.create({ provider, model }).skillGraph(graph).build();
graph.toMermaid();   // declared === drawn
```

A skill is active exactly while the cursor is on it — one skill's turn at a time. An `.entry(x)` with **no** `when` is the persistent base (`always`), on beside whatever the cursor is on.

### RAG — retrieve, augment, generate

```typescript
import { defineRAG } from 'agentfootprint';                    // wiring lives on the main barrel
import { InMemoryStore, mockEmbedder } from 'agentfootprint/memory';

Agent.create({ provider, model })
  .rag(defineRAG({ id: 'docs', store: new InMemoryStore(), embedder: mockEmbedder(), topK: 5 }))
  .build();
```

### Control flow + patterns — compose runners

```typescript
import { Sequence, Parallel, Loop, Conditional, workflow, graph } from 'agentfootprint';
import { swarm, debate, reflection, selfConsistency, mapReduce, tot } from 'agentfootprint';  // patterns

const pipeline = Sequence.create().step('research', researchAgent).step('write', writerAgent).build();

const desk = swarm({
  agents: [{ id: 'research', runner: researchAgent }, { id: 'write', runner: writerAgent }],
  route: ({ message }) => (/write/.test(message) ? 'write' : 'research'),
});
```

## Providers

```typescript
import { mock, anthropic, openai, bedrock, ollama } from 'agentfootprint/providers';

const provider = process.env.NODE_ENV === 'production'
  ? anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  : ollama('llama3.2');            // free local model; or mock({...}) for determinism
```

`mock` takes `{ reply }` (one fixed answer), `{ replies: [...] }` (consumed in order — exhaustion throws loud), or `{ respond: (req) => … }` (build the answer from the request, including `toolCalls`).

## Tools

```typescript
import { defineTool } from 'agentfootprint';

const calculator = defineTool({
  name: 'calculator',                                  // `name`, not `id`
  description: 'Perform arithmetic',
  inputSchema: { type: 'object', properties: { expression: { type: 'string' } } },
  execute: async ({ expression }: { expression: string }) => String(evaluate(expression)),
});
```

## Observing a run

```typescript
import { costRecorder, routeRecorder } from 'agentfootprint/observe';

const agent = Agent.create({ provider, model })
  .watch(routeRecorder({ id: 'routes' }))              // recorders are factories, not classes
  .build();

agent.on('agentfootprint.context.evaluated', (e) => console.log(e.payload.activeIds));
```

## Human in the loop

```typescript
import { askHuman, isPaused, checkInApproved } from 'agentfootprint';

const result = await agent.run({ message: 'Refund $500?' });
if (isPaused(result)) {
  const final = await agent.resume(result.checkpoint, checkInApproved({ by: 'maya' }));
}
```

## Resilience

```typescript
import { withRetry, withFallback, withCircuitBreaker } from 'agentfootprint/resilience';

const reliable = withRetry(provider, { maxAttempts: 3 });
const resilient = withFallback(primary, backup);
```

## Anti-Patterns

- Don't use `id`/`handler` on `defineTool` — it's `name`/`execute`
- Don't call `mock([...])` with an array — it's `mock({ replies: [...] })`
- Don't import any provider (`mock` included) from the main barrel — they live on `agentfootprint/providers`
- Don't `new` a recorder — they're lowercase factories attached via `.watch()`
- Don't write `.entry(x, { when: () => true })` for an always-on skill — omit `when`, or use `.steering()`
- Don't post-process execution — use recorders

## Build & Test

```bash
npm run build    # tsc (CJS) + tsc -p tsconfig.esm.json + postbuild
npm test         # vitest — 5300+ tests
```

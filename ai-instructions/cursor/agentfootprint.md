# agentfootprint — Cursor Rules

Building Generative AI applications is mostly **context engineering** — deciding what content lands in which slot of the LLM call, when, and why. agentfootprint exposes this discipline through 2 primitives + 3 compositions + 1 unifying injection primitive + 1 memory factory.

## Core API (use these, not v1 names)

```typescript
import {
  Agent, LLMCall, defineTool,
  Sequence, Parallel, Conditional, Loop,
  defineSkill, defineSteering, defineInstruction, defineFact,
  defineMemory, MEMORY_TYPES, MEMORY_STRATEGIES, SNAPSHOT_PROJECTIONS,
  InMemoryStore, mockEmbedder,
  anthropic, openai, bedrock, ollama, mock,
  askHuman, pauseHere, isPaused,
  withRetry, withFallback, resilientProvider,
} from 'agentfootprint';
```

**Top-level barrel only.** Don't import from stale subpaths like
`agentfootprint/instructions`, `agentfootprint/observe`,
`agentfootprint/security`, `agentfootprint/explain`.

## The 6-layer mental model

```
2 primitives        : LLMCall · Agent (= ReAct)
3 compositions+Loop : Sequence · Parallel · Conditional · Loop
N patterns          : ReAct · Reflexion · ToT · MapReduce · Debate · Swarm
                      (RECIPES, not classes)
Context engineering : defineSkill · defineSteering · defineInstruction · defineFact
Memory              : defineMemory({type, strategy, store}) — 4 types × 7 strategies
Production features : pause/resume · cost · permissions · observability · events
```

## Three slots of the LLM API call

Every "agent feature" is content flowing into one of:

- `system` prompt — Steering / Instruction / Skill body / Fact / formatted memory
- `messages` array — history / RAG / memory replay / injected instructions
- `tools` array — Tool schemas (registered + Skill-attached)

## Canonical examples

### Hello agent

```typescript
const agent = Agent.create({
  provider: anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! }),
  model: 'claude-sonnet-4-5-20250929',
})
  .system('You are a helpful assistant.')
  .tool(weatherTool)
  .build();

const result = await agent.run({ message: 'Weather in SF?' });
```

### Tools

```typescript
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
  execute: async (args) => `${(args as { city: string }).city}: 72°F`,
});
```

### Context engineering

```typescript
const tone = defineSteering({ id: 'tone', prompt: 'Be friendly.' });
const urgent = defineInstruction({
  id: 'urgent',
  activeWhen: (ctx) => /urgent/i.test(ctx.userMessage),
  prompt: 'Prioritize the fastest path.',
});
const billing = defineSkill({
  id: 'billing',
  description: 'Use for refunds.',
  body: 'Confirm identity first.',
  tools: [refundTool],
});
const userProfile = defineFact({ id: 'user', data: 'Alice, Pro plan.' });

agent.steering(tone).instruction(urgent).skill(billing).fact(userProfile);
```

### Memory

```typescript
const memory = defineMemory({
  id: 'short-term',
  type: MEMORY_TYPES.EPISODIC,
  strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },
  store: new InMemoryStore(),
});

agent.memory(memory);

await agent.run({
  message: '...',
  identity: { tenant: 'acme', principal: 'alice', conversationId: 'thread-42' },
});
```

Types: `EPISODIC` · `SEMANTIC` · `NARRATIVE` · `CAUSAL` (snapshot replay ⭐).
Strategies: `WINDOW` · `BUDGET` · `SUMMARIZE` · `TOP_K` · `EXTRACT` · `DECAY` · `HYBRID`.

### Multi-agent via control flow (no `MultiAgentSystem` class)

```typescript
const pipeline = Sequence.create()
  .step(researcher).step(writer).step(editor)
  .build();

const tot = Parallel.create()
  .branch(thoughtAgent).branch(thoughtAgent).branch(thoughtAgent)
  .merge(rankerLLM)
  .build();
```

## Anti-patterns — Don't

- ❌ `agent.run('string')` → use `agent.run({ message: '...', identity? })`
- ❌ Stale subpaths: `agentfootprint/instructions`, `agentfootprint/observe`, `agentfootprint/security`
- ❌ `.memoryPipeline(pipeline)` (v1) → use `.memory(defineMemory({...}))`
- ❌ Shipping a `ReflexionAgent` class → compose `Sequence(Agent, critique-LLM, Agent)`
- ❌ Closures or class instances in scope (can't be cloned)
- ❌ Falling back when TopK threshold returns nothing (strict semantics)

## Decision tree

| Goal | Use |
|---|---|
| One-shot LLM call | `LLMCall` |
| Loop with tools | `Agent` |
| Two LLM calls in series | `Sequence` |
| Multiple critics → merge | `Parallel` |
| Route by intent | `Conditional` |
| Iterate until quality bar | `Loop` |
| Output format / persona / safety | `defineSteering` |
| Rule-gated context | `defineInstruction` |
| LLM-activated body + tools | `defineSkill` |
| User profile / env data | `defineFact` |
| Last N turns | `defineMemory({ type: EPISODIC, strategy: WINDOW })` |
| Vector retrieval | `defineMemory({ type: SEMANTIC, strategy: TOP_K })` |
| Cross-run "why?" replay | `defineMemory({ type: CAUSAL, strategy: TOP_K })` |
| Long convo overflow | `defineMemory({ type: EPISODIC, strategy: SUMMARIZE })` |

When in doubt — read [`examples/`](examples/) (33 runnable specs).

<p align="center">
  <h1 align="center">AGENT FOOTPRINT</h1>
  <p align="center">
    <strong>The explainable agent framework</strong>
  </p>
</p>

<p align="center">
  <a href="https://github.com/footprintjs/agentfootprint/actions"><img src="https://github.com/footprintjs/agentfootprint/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/agentfootprint"><img src="https://img.shields.io/npm/v/agentfootprint.svg?style=flat" alt="npm version"></a>
  <a href="https://img.shields.io/npm/dm/agentfootprint.svg"><img src="https://img.shields.io/npm/dm/agentfootprint.svg" alt="Downloads"></a>
  <a href="https://github.com/footprintjs/agentfootprint/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
  <br>
  <a href="https://footprintjs.github.io/agentfootprint/"><img src="https://img.shields.io/badge/Docs-agentfootprint-facc15?style=flat&logo=typescript&logoColor=white" alt="Docs"></a>
  <a href="https://footprintjs.github.io/agent-playground/"><img src="https://img.shields.io/badge/Playground-Live_Demo-facc15?style=flat" alt="Playground"></a>
  <a href="https://footprintjs.github.io/footPrint/"><img src="https://img.shields.io/badge/Built_on-footprintjs-ca8a04?style=flat" alt="Built on footprintjs"></a>
</p>

> **Most agent frameworks give you execution. agentfootprint gives you connected evidence** — grounded, auditable, LLM-readable. The LLM can explain its own decisions. You can verify it wasn't hallucinating.

```bash
npm install agentfootprint
```

```typescript
import { Agent, defineTool } from 'agentfootprint';              // Build agents
import { mock, anthropic } from 'agentfootprint/providers';      // Connect providers
import { defineInstruction } from 'agentfootprint/instructions'; // Conditional behavior
import { agentObservability } from 'agentfootprint/observe';     // Observability
import { withRetry } from 'agentfootprint/resilience';           // Reliability
import { gatedTools } from 'agentfootprint/security';            // Tool safety
import { ExplainRecorder } from 'agentfootprint/explain';        // Grounding analysis
import { SSEFormatter } from 'agentfootprint/stream';            // Real-time events
```

---

## Start Simple, Compose Up

Six concepts. Start with a single LLM call, compose up to multi-agent. No upfront graph DSL.

```typescript
import { Agent, defineTool } from 'agentfootprint';
import { mock } from 'agentfootprint/providers';
import { agentObservability } from 'agentfootprint/observe';

const obs = agentObservability();
const agent = Agent.create({ provider: mock([...]) })
  .system('You are a research assistant.')
  .tool(searchTool)
  .recorder(obs)
  .build();

const result = await agent.run('Find AI trends');
console.log(result.content);              // LLM response
console.log(obs.explain().iterations);    // per-iteration evaluation data ← the differentiator
```

**Single LLM** (one agent, one task):

| Concept | What it adds | Use case |
|---------|-------------|----------|
| **LLMCall** | Single LLM invocation | Summarization, classification |
| **Agent** | + Tool use loop (ReAct) | Research, code generation |
| **RAG** | + Retrieval | Q&A over documents |

**Multi-Agent** (compose agents):

| Concept | What it adds | Use case |
|---------|-------------|----------|
| **FlowChart** | Sequential pipeline | Approval flows, ETL — output of one feeds the next |
| **Parallel** | Concurrent execution | Analysis from multiple perspectives — merged by LLM |
| **Swarm** | LLM-driven routing | Customer support — orchestrator delegates to specialists |

All six share one interface: `.build()` → `.run()`, `.getNarrative()`, `.getSnapshot()`.

---

## Architecture — 5 Layers

```
Layer 1: BUILD          → concepts/     Single LLM (LLMCall, Agent, RAG)
                                         Multi-Agent (FlowChart, Parallel, Swarm)
                          tools/         defineTool, ToolRegistry, askHuman

Layer 2: COMPOSE        → lib/loop/     buildAgentLoop — the ReAct engine
                          lib/slots/    SystemPrompt, Messages, Tools subflows

Layer 3: EVALUATE       → recorders/    ExplainRecorder — per-iteration evaluation
                          explain       obs.explain() → { iterations, sources, claims, context }

Layer 4: MONITOR        → recorders/    TokenRecorder, CostRecorder, ToolUsageRecorder
                          streaming/    AgentStreamEvent, SSEFormatter
                          narrative     Human-readable execution story (footprintjs)

Layer 5: INFRASTRUCTURE → adapters/     Anthropic, OpenAI, Bedrock, Mock, MCP, A2A
                          providers/    Prompt, Message, Tool strategies
                          memory/       Conversation stores (Redis, Postgres, DynamoDB)
```

Each folder has a README. Start at Layer 1, add layers as you need them.

Built on [footprintjs](https://github.com/footprintjs/footPrint) — the flowchart pattern for backend code. One DFS traversal, three observer systems (scope/flow/agent), connected data out.

---

## What's Different

Features no other agent framework provides — and why they matter.

**Quality:**

| Feature | What |
|---------|------|
| **Dynamic ReAct** | All 3 slots (prompt, tools, messages) re-evaluate EACH loop iteration. Agent adapts mid-conversation. |
| **Conditional Behavior** | `defineInstruction({ activeWhen })` — rules activate based on accumulated decision state. |
| **Tool Result Recency** | Instructions inject into the recency window AFTER tool calls — guidance at the right moment. |
| **Per-Iteration Evaluation** | `obs.explain().iterations` — context + decisions + sources + claims connected per loop. |

**Safety & Cost:**

| Feature | What |
|---------|------|
| **Permission-Gated Tools** | LLM never SEES blocked tools — filtered at resolve time. Can't hallucinate a tool it never saw. |
| **$0 Testing** | `mock()` adapter — same interface as Anthropic/OpenAI. Full test suite, zero API spend. |

**UX & Debugging:**

| Feature | What |
|---------|------|
| **Human-in-the-Loop** | Agent pauses, serializes to JSON, resumes hours later on a different server. `askHuman()`. |
| **Streaming Events** | 9-event discriminated union. Build React/Next.js real-time UI. SSEFormatter for SSE. |
| **Narrative Traces** | Human-readable execution story a follow-up LLM can reason about. |
| **Single Traversal** | 3 observer systems fire during ONE DFS pass → all data connected. No post-processing. |

---

## Adapter-Swap Testing

Write tests with `mock()`. Deploy with `anthropic()`. Same code. $0 test runs.

```typescript
import { mock, createProvider, anthropic } from 'agentfootprint/providers';

// test — deterministic, free, instant
const provider = mock([{ content: 'Paris.' }]);

// production — swap one line
const provider = createProvider(anthropic('claude-sonnet-4-20250514'));

// Same agent. Same tools. Same flowchart.
const agent = Agent.create({ provider }).system('Geography expert.').tool(searchTool).build();
```

Works with Anthropic, OpenAI, Bedrock, Ollama. No lock-in.

---

## Features

### Conditional Behavior

Define rules that inject into system prompt, tools, AND tool-result recency window. Driven by accumulated state. All 3 slots re-evaluate each iteration in Dynamic mode — progressive tool authorization, context-aware prompts, state-driven behavior.

```typescript
import { defineInstruction } from 'agentfootprint/instructions';
import { Agent, AgentPattern } from 'agentfootprint';

const refund = defineInstruction({
  id: 'refund-handling',
  activeWhen: (d) => d.orderStatus === 'denied',
  prompt: 'Handle denied orders with empathy. Follow refund policy.',
  tools: [processRefund],
  onToolResult: [{ id: 'empathy', text: 'Do NOT promise reversal.' }],
  safety: true,   // fail-closed: fires even when predicate throws
});

const agent = Agent.create({ provider })
  .tool(lookupOrder)
  .instruction(refund)
  .decision({ orderStatus: null })
  .pattern(AgentPattern.Dynamic)
  .build();
```

### Narrative Traces

Connected entries with key, value, stageId — collected during traversal. Feed to a follow-up LLM for debugging.

```typescript
agent.getNarrative();
// [
//   "[Seed] Initialized agent state",
//   "[CallLLM] claude-sonnet-4 (127in / 45out)",
//   "[ExecuteToolCalls] lookup_order({orderId: 'ORD-1003'})",
//   "[Finalize] Your order was denied..."
// ]
```

### Human-in-the-Loop

Agent pauses, serializes state to JSON, resumes hours later on a different server.

```typescript
import { Agent, askHuman } from 'agentfootprint';

const agent = Agent.create({ provider })
  .tool(askHuman())
  .build();

const result = await agent.run('Process my refund');
if (result.paused) {
  const checkpoint = result.pauseData;   // store in Redis/Postgres/anywhere
  const final = await agent.resume(humanResponse);  // hours later, different server
}
```

### Streaming Events

9-event discriminated union. Build any UX — CLI, web, mobile.

```typescript
await agent.run('Check order', {
  onEvent: (event) => {
    switch (event.type) {
      case 'token':      process.stdout.write(event.content); break;
      case 'tool_start': console.log(`Running ${event.toolName}...`); break;
      case 'tool_end':   console.log(`Done (${event.latencyMs}ms)`); break;
    }
  },
});
```

Events: `turn_start` · `llm_start` · `thinking` · `token` · `llm_end` · `tool_start` · `tool_end` · `turn_end` · `error`

### Observability

One call for everything. Collect during traversal, never post-process.

```typescript
import { agentObservability } from 'agentfootprint/observe';

const obs = agentObservability();
agent.recorder(obs).build();
await agent.run('Hello');

obs.tokens();   // metrics: { totalCalls, totalInputTokens, totalOutputTokens, calls[] }
obs.tools();    // metrics: { totalCalls, byTool: { search: { calls, errors, latency } } }
obs.cost();     // metrics: USD amount
obs.explain();  // evaluation: { iterations, sources, claims, decisions, context }
```

| Category | Recorders | Audience |
|----------|-----------|----------|
| **Evaluation** | `ExplainRecorder` | LLM evaluator — faithfulness, hallucination, grounding |
| **Metrics** | `TokenRecorder`, `CostRecorder`, `ToolUsageRecorder`, `TurnRecorder` | Ops dashboard, billing |
| **Safety** | `GuardrailRecorder`, `PermissionRecorder`, `QualityRecorder` | Security, compliance |
| **Export** | `OTelRecorder` | Datadog, Grafana, any OTel backend |

### Tool Gating — Defense-in-Depth

The LLM never sees tools it can't use. Two layers: resolve-time filtering + execute-time rejection.

```typescript
import { gatedTools, PermissionPolicy } from 'agentfootprint/security';

const policy = PermissionPolicy.fromRoles({
  user: ['search', 'calc'],
  admin: ['search', 'calc', 'delete-user'],
}, 'user');

const agent = Agent.create({ provider })
  .toolProvider(gatedTools(allTools, policy.checker()))
  .build();

policy.setRole('admin');  // upgrade mid-conversation
```

### Resilience

```typescript
import { withRetry, withFallback, resilientProvider } from 'agentfootprint/resilience';

const reliable = withRetry(agent, { maxRetries: 3 });
const resilient = withFallback(primaryAgent, cheapAgent);
const provider = resilientProvider([anthropicAdapter, openaiAdapter, ollamaAdapter]);
```

---

## Samples

`test/samples/` — runnable with `vitest`:

| # | Sample | What it demonstrates |
|---|--------|---------------------|
| 01-16 | Core patterns | LLMCall, Agent, RAG, FlowChart, Swarm, recorders, tools, security, errors, multi-modal |
| 17 | **Conditional Behavior** | defineInstruction, decide(), conditional activation, Decision Scope |
| 18 | **Streaming Events** | AgentStreamEvent lifecycle, tool events, SSE |
| 19 | **Tool Gating** | gatedTools, PermissionPolicy, role-based tool access |
| 21 | **SSE Server** | Express SSE endpoint with SSEFormatter |
| 22 | **Resilience** | withRetry, withFallback, provider failover |
| 23 | **Memory Stores** | redisStore, postgresStore, dynamoStore adapters |
| 24 | **Structured Output** | outputSchema, Zod auto-convert, zodToJsonSchema |
| 25 | **OTel** | OpenTelemetry spans with mock tracer |
| 26 | **Explain Recorder** | ExplainRecorder: sources, claims, decisions, per-iteration eval |

---

[MIT](./LICENSE) &copy; [Sanjay Krishna Anbalagan](https://github.com/sanjay1909)

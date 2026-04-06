<p align="center">
  <h1 align="center">agentfootprint</h1>
  <p align="center">
    <strong>The explainable agent framework</strong>
  </p>
</p>

<p align="center">
  <a href="https://github.com/footprintjs/agentfootprint/actions"><img src="https://github.com/footprintjs/agentfootprint/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/agentfootprint"><img src="https://img.shields.io/npm/v/agentfootprint.svg?style=flat" alt="npm version"></a>
  <a href="https://github.com/footprintjs/agentfootprint/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
</p>

<br>

Most agent frameworks give you execution. agentfootprint gives you **connected evidence** — grounded, auditable, LLM-readable. The LLM can explain its own decisions. You can verify it wasn't hallucinating.

```bash
npm install agentfootprint
```

Import what you need — each capability is a subpath:

```typescript
import { Agent, defineTool } from 'agentfootprint';              // Build agents
import { mock, anthropic } from 'agentfootprint/providers';      // Connect providers
import { defineInstruction } from 'agentfootprint/instructions'; // Smart behavior
import { agentObservability } from 'agentfootprint/observe';     // Monitor execution
import { withRetry } from 'agentfootprint/resilience';           // Reliability
import { gatedTools } from 'agentfootprint/security';            // Tool safety
import { getGroundingSources } from 'agentfootprint/explain';    // Grounding analysis
import { SSEFormatter } from 'agentfootprint/stream';            // Real-time events
```

---

## Start Simple, Compose Up

Five concepts. Each adds one capability. No upfront graph DSL — start with a function call and grow.

```typescript
import { Agent, defineTool, mock } from 'agentfootprint';

const agent = Agent.create({ provider: mock([...]) })
  .system('You are a research assistant.')
  .tool(searchTool)
  .build();

const result = await agent.run('Find AI trends');
console.log(result.content);
console.log(agent.getNarrative());  // connected execution trace
```

| Concept | What it adds | Use case |
|---------|-------------|----------|
| **LLMCall** | Single LLM invocation | Summarization, classification |
| **Agent** | + Tool use loop (ReAct) | Research, code generation |
| **RAG** | + Retrieval | Q&A over documents |
| **FlowChart** | + Sequential pipeline | Approval flows, ETL |
| **Swarm** | + LLM-driven routing | Customer support, triage |

All five share one interface: `.build()` → `.run()`, `.getNarrative()`, `.getSnapshot()`.

---

## Adapter-Swap Testing

Write tests with `mock()`. Deploy with `anthropic()`. Same code. $0 test runs.

```typescript
// test — deterministic, free, instant
const provider = mock([{ content: 'Paris.' }]);

// production — swap one line
const provider = createProvider(anthropic('claude-sonnet-4-20250514'));

// Same agent. Same tools. Same flowchart.
const agent = Agent.create({ provider }).system('Geography expert.').tool(searchTool).build();
```

Works with Anthropic, OpenAI, Bedrock, Ollama. No lock-in.

---

## Instructions — Conditional Context Injection

One concept. Three LLM API positions. Define a rule once — it injects into system prompt, tools, AND tool-result recency window. Driven by accumulated state.

```typescript
import { defineInstruction, Agent, AgentPattern } from 'agentfootprint';

const refund = defineInstruction({
  id: 'refund-handling',
  activeWhen: (d) => d.orderStatus === 'denied',
  prompt: 'Handle denied orders with empathy. Follow refund policy.',
  tools: [processRefund],
  onToolResult: [{ id: 'empathy', text: 'Do NOT promise reversal.' }],
});

const agent = Agent.create({ provider })
  .tool(lookupOrder)
  .instruction(refund)
  .decision({ orderStatus: null })
  .pattern(AgentPattern.Dynamic)   // re-evaluate each iteration
  .build();
```

Tool results update the decision scope via `decide()`. Next iteration, different instructions activate. Progressive tool authorization, context-aware prompts, state-driven behavior — all declarative.

See [Instructions Guide](docs/guides/instructions.md).

---

## LLM Narrative — Connected Evidence

Not disconnected spans. Not logs. **Connected entries** with key, value, stageId — collected during the single traversal pass. The LLM can read its own trace and answer follow-up questions.

```typescript
const result = await agent.run('Check order ORD-1003');

// Human-readable narrative
agent.getNarrative();
// [
//   "[Seed] Initialized agent state",
//   "[CallLLM] claude-sonnet-4 (127in / 45out)",
//   "[ExecuteToolCalls] lookup_order({orderId: 'ORD-1003'})",
//   "  Tool results: {status: 'denied', amount: 5000}",
//   "[CallLLM] claude-sonnet-4 (312in / 89out)",
//   "[Finalize] Your order was denied..."
// ]

// Structured entries for programmatic access
agent.getNarrativeEntries();
// Each entry: { type, text, key, rawValue, stageId, subflowId }
```

### Grounding Analysis

Compare what tools returned vs what the LLM said. Hallucination detection without a separate eval pipeline.

```typescript
import { getGroundingSources, getLLMClaims } from 'agentfootprint';

const entries = agent.getNarrativeEntries();
const sources = getGroundingSources(entries);  // tool results (sources of truth)
const claims = getLLMClaims(entries);           // LLM output (to verify)
// Compare sources against claims — was the LLM grounded?
```

---

## Dynamic ReAct

All three slots (system prompt, tools, messages) re-evaluate each iteration. Instructions re-evaluate against updated decision scope. Progressive tool authorization:

```
Turn 1: basic tools → LLM calls verify_identity → decision.verified = true
Turn 2: InstructionsToLLM re-evaluates → admin tools unlocked → refund tools available
Turn 3: LLM sees admin tools → can process refund
```

The LLM's capabilities change based on what happened — not what you hardcoded.

---

## Pausable — Human-in-the-Loop

Long-running agent pauses, serializes state to JSON, resumes hours later on a different server.

```typescript
import { Agent, askHuman } from 'agentfootprint';

const agent = Agent.create({ provider })
  .tool(askHuman())   // special tool that pauses execution
  .build();

const result = await agent.run('Process my refund');
if (result.paused) {
  // Store checkpoint in Redis/Postgres/anywhere
  const checkpoint = result.pauseData;
  // ... hours later, different server ...
  const final = await agent.resume(humanResponse);
}
```

---

## Streaming Lifecycle Events

9-event discriminated union. Build any UX — CLI, web, mobile. Tool lifecycle fires even without streaming mode.

```typescript
await agent.run('Check order', {
  onEvent: (event) => {
    switch (event.type) {
      case 'token':      process.stdout.write(event.content); break;
      case 'tool_start': console.log(`Running ${event.toolName}...`); break;
      case 'tool_end':   console.log(`Done (${event.latencyMs}ms)`); break;
      case 'llm_end':    console.log(`[${event.model}, ${event.latencyMs}ms]`); break;
    }
  },
});
```

Events: `turn_start` · `llm_start` · `thinking` · `token` · `llm_end` · `tool_start` · `tool_end` · `turn_end` · `error`

SSE for web backends: `res.write(SSEFormatter.format(event))`

---

## Recorders — Passive Observation

Observe without shaping behavior. Collect during traversal.

```typescript
import { TokenRecorder, CostRecorder, QualityRecorder, GuardrailRecorder } from 'agentfootprint';

const tokens = new TokenRecorder();
const cost = new CostRecorder({ pricingTable: { 'claude-sonnet': { input: 3, output: 15 } } });

const agent = Agent.create({ provider })
  .recorder(tokens)
  .recorder(cost)
  .build();

await agent.run('Hello');
tokens.getStats();       // { totalCalls, totalInputTokens, totalOutputTokens, ... }
cost.getTotalCost();     // USD amount
```

| Recorder | What it tracks |
|----------|---------------|
| `TokenRecorder` | Input/output tokens per LLM call |
| `CostRecorder` | USD cost per model |
| `ToolUsageRecorder` | Tool call counts, latency, errors |
| `QualityRecorder` | Score each response via custom judge |
| `GuardrailRecorder` | Flag policy violations via custom check |
| `PermissionRecorder` | Blocked/denied/allowed tool events |

---

## Tool Gating — Defense-in-Depth

The LLM never sees tools it can't use. Can't hallucinate a tool it never saw.

```typescript
import { gatedTools, PermissionPolicy } from 'agentfootprint';

const policy = PermissionPolicy.fromRoles({
  user: ['search', 'calc'],
  admin: ['search', 'calc', 'delete-user'],
}, 'user');

const agent = Agent.create({ provider })
  .toolProvider(gatedTools(allTools, policy.checker()))
  .build();

// Upgrade mid-conversation
policy.setRole('admin');
```

Two layers: resolve-time filtering (hidden from LLM) + execute-time rejection (hallucinated names caught).

---

## Safety Instructions

```typescript
defineInstruction({
  id: 'compliance',
  safety: true,   // fail-closed: fires even when predicate throws
  prompt: 'GDPR compliance required.',
});
```

Safety instructions: unsuppressable, fail-closed, sorted last (highest LLM attention position).

---

## Orchestration

```typescript
import { withRetry, withFallback, withCircuitBreaker, resilientProvider } from 'agentfootprint';

const reliable = withRetry(agent, { maxRetries: 3 });
const resilient = withFallback(primaryAgent, cheapAgent);
const guarded = withCircuitBreaker(agent, { failureThreshold: 5 });

// Cross-family provider failover: Claude → GPT-4o → local Ollama
const provider = resilientProvider([anthropicAdapter, openaiAdapter, ollamaAdapter]);
```

---

## 18 Samples

`test/samples/` — runnable with `vitest`:

| # | Sample | What it demonstrates |
|---|--------|---------------------|
| 01-16 | Core patterns | LLMCall, Agent, RAG, FlowChart, Swarm, recorders, tools, security, errors, multi-modal |
| 17 | **Instructions** | defineInstruction, decide(), conditional activation, Decision Scope |
| 18 | **Streaming Events** | AgentStreamEvent lifecycle, tool events, SSE |

---

## Architecture

```
src/
├── concepts/     → LLMCall, Agent, RAG, FlowChart, Swarm (builders + runners)
├── lib/          → Instructions, narrative (grounding helpers), loop (buildAgentLoop), slots, call stages
├── adapters/     → LLM adapters (Anthropic, OpenAI, Bedrock, Mock) + protocol (MCP, A2A)
├── providers/    → Prompt/tool/message strategies
├── recorders/    → AgentRecorders (Token, Cost, Quality, Guardrail, Permission)
├── streaming/    → AgentStreamEvent, StreamEmitter, SSEFormatter
├── tools/        → ToolRegistry, defineTool
├── compositions/ → withRetry, withFallback, withCircuitBreaker
└── types/        → All type definitions
```

Built on [footprintjs](https://github.com/footprintjs/footPrint) — the flowchart pattern for backend code.

---

[MIT](./LICENSE) &copy; [Sanjay Krishna Anbalagan](https://github.com/sanjay1909)

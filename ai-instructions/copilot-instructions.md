# agentfootprint — Copilot Instructions

The explainable agent framework — build AI agents you can explain, audit, and trust. Built on footprintjs.

## What It Does

Every agent is a footprintjs flowchart. Every LLM call, tool use, and decision auto-generates a causal trace. LLMs read the trace for grounded explanations.

## Core Principle

**Every concept is a flowchart. Collect during traversal, never post-process.**

## 5 Concepts (Builder → Runner)

```typescript
// 1. LLMCall — single LLM call, no tools, no loop
LLMCall.create({ provider }).system('...').recorder(rec).build()
// Flowchart: SeedScope → CallLLM → ParseResponse → Finalize

// 2. Agent — ReAct agent with tools + loop
Agent.create({ provider, name? }).system('...').tool(t).maxIterations(n).recorder(rec).build()
// Flowchart: SeedScope → PromptAssembly → CallLLM → ParseResponse → HandleResponse → loopTo

// 3. RAG — retrieve-augment-generate
RAG.create({ provider, retriever }).system('...').topK(5).recorder(rec).build()
// Flowchart: SeedScope → Retrieve → AugmentPrompt → CallLLM → ParseResponse → Finalize

// 4. FlowChart — sequential multi-agent pipeline
FlowChart.create().agent('id', 'name', runner).recorder(rec).build()

// 5. Swarm — LLM-routed multi-agent handoff
Swarm.create({ provider }).specialist('id', 'desc', runner).recorder(rec).build()
```

## Tools

```typescript
import { defineTool } from 'agentfootprint';
const tool = defineTool({
  id: 'search',
  description: 'Search the web',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  handler: async (args) => `Results for: ${args.query}`,
});
```

## Recorders

```typescript
import { TokenRecorder, CostRecorder, TurnRecorder, ToolUsageRecorder,
         QualityRecorder, GuardrailRecorder, CompositeRecorder } from 'agentfootprint';

const tokens = new TokenRecorder();
const cost = new CostRecorder();
const composite = new CompositeRecorder([tokens, cost]);

// Attach via .recorder(rec) on any concept builder
// Read after execution: tokens.getStats(), cost.getTotalCost()
```

## Providers

```typescript
import { mock, mockRetriever, createProvider, anthropic, openai } from 'agentfootprint';

// Testing
const provider = mock([{ content: 'Hello' }]);
const retriever = mockRetriever([{ chunks: [{ content: '...', score: 0.9, metadata: {} }] }]);

// Production
const claude = createProvider(anthropic({ modelId: 'claude-sonnet-4-20250514', apiKey: '...' }));
```

## Prompt Providers

```typescript
import { staticPrompt, templatePrompt, skillBasedPrompt, compositePrompt } from 'agentfootprint';
```

## Tool Providers & Protocol Adapters

```typescript
import { agentAsTool, compositeTools, mcpToolProvider, a2aRunner } from 'agentfootprint';
```

## Compositions (Resilience)

```typescript
import { withRetry, withFallback, withCircuitBreaker } from 'agentfootprint';
```

## Runner API (all concepts)

```typescript
runner.run(message, { signal?, timeoutMs? })
runner.getNarrative()           // causal trace
runner.getSnapshot()            // memory state
runner.getSpec()                // flowchart spec
runner.toFlowChart()            // for subflow composition
```

## Rules

- Never post-process — use recorders to collect data during traversal
- Always use `mock([...])` in tests — no API keys in test suites
- Use concept builders (`Agent.create()`, etc.) not raw stages
- Use `FlowChart`/`Swarm` for multi-agent, not flat stages
- Attach recorders via `.recorder(rec)` on builders

# agentfootprint — Kiro Rules

The explainable agent framework. Every agent is a footprintjs flowchart with auto-generated causal traces.

## Core Principle

**Every concept is a flowchart. Collect during traversal, never post-process.**

## 5 Concepts

```typescript
// 1. LLMCall — single LLM call, no tools, no loop
LLMCall.create({ provider }).system('...').recorder(rec).build()

// 2. Agent — ReAct agent with tools + loop
Agent.create({ provider, name? }).system('...').tool(t).maxIterations(n).recorder(rec).build()

// 3. RAG — retrieve-augment-generate
RAG.create({ provider, retriever }).system('...').topK(5).recorder(rec).build()

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

## Recorders (AgentRecorder interface)

```typescript
import { TokenRecorder, CostRecorder, TurnRecorder, ToolUsageRecorder,
         QualityRecorder, GuardrailRecorder, CompositeRecorder } from 'agentfootprint';

const tokens = new TokenRecorder();
const cost = new CostRecorder();
const composite = new CompositeRecorder([tokens, cost]);

// Attach via .recorder(rec) on any builder
```

## Providers & Testing

```typescript
import { mock, mockRetriever, createProvider, anthropic } from 'agentfootprint';

// Testing — no API keys needed
const provider = mock([{ content: 'Hello' }]);
const retriever = mockRetriever([{ chunks: [{ content: '...', score: 0.9, metadata: {} }] }]);

// Production
const claude = createProvider(anthropic({ modelId: 'claude-sonnet-4-20250514', apiKey: '...' }));
```

## Prompt Providers

```typescript
import { staticPrompt, templatePrompt, skillBasedPrompt, compositePrompt } from 'agentfootprint';
```

## Tool Providers

```typescript
import { agentAsTool, compositeTools, mcpToolProvider } from 'agentfootprint';
```

## Compositions (Resilience)

```typescript
import { withRetry, withFallback, withCircuitBreaker } from 'agentfootprint';
```

## Runner API (all concepts)

```typescript
runner.run(message, { signal?, timeoutMs? })
runner.getNarrative()           // causal trace
runner.getSnapshot()            // full memory state
runner.getSpec()                // flowchart spec for visualization
runner.toFlowChart()            // expose for subflow composition
```

## Rules

- Never post-process — use recorders
- Always use `mock([...])` in tests — no API keys
- Use concept builders, not raw stages
- Use `FlowChart`/`Swarm` for multi-agent, not flat stages
- Attach recorders via `.recorder(rec)` on builders

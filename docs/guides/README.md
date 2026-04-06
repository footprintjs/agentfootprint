# Guides

Comprehensive guides for using agentfootprint — the explainable agent framework.

| Guide | What it covers |
|-------|---------------|
| **[Quick Start](quick-start.md)** | Install, first LLMCall, first Agent with tools, adapter-swap testing |
| **[Concepts](concepts.md)** | The concept ladder: LLMCall, Agent, RAG, FlowChart, Swarm |
| **[Providers](providers.md)** | PromptProvider, MessageStrategy, ToolProvider — swap strategies without changing agent code |
| **[Recorders](recorders.md)** | All 7 recorders (Token, Cost, Turn, ToolUsage, Quality, Guardrail, Composite) + `.recorder()` API |
| **[Adapters](adapters.md)** | LLM adapters (Anthropic, OpenAI, Bedrock, Ollama, Mock) + protocol adapters (MCP, A2A) |
| **[Orchestration](orchestration.md)** | `withRetry`, `withFallback`, `withCircuitBreaker` — reliability wrappers |
| **[Security](security.md)** | Tool gating, permission policy, provider fallback, resilient providers, audit trail |
| **[Instructions](instructions.md)** | Conditional context injection — 3-position injection, Decision Scope, `decide()` field |
| **[Streaming](streaming.md)** | Real-time lifecycle events (AgentStreamEvent), SSE, onEvent callback |

---

## Key Differentiators

### Adapter-Swap Testing — [quick-start.md#testing](quick-start.md#adapter-swap-testing)

Write tests with `mock()`, deploy with `anthropic()`. Same code. Zero changes. Full coverage at $0.

```typescript
// test — deterministic, free
const provider = mock([{ content: 'Paris.' }]);

// production — swap one line
const provider = createProvider(anthropic('claude-sonnet-4-20250514'));
```

### Concept Ladder — [concepts.md](concepts.md)

Start simple, compose up. No upfront graph DSL required.

| Concept | What it adds |
|---------|-------------|
| **LLMCall** | Single invocation |
| **Agent** | + Tool use loop (ReAct) |
| **RAG** | + Retrieval |
| **FlowChart** | + Sequential/branching pipeline |
| **Swarm** | + Dynamic LLM-driven routing |

### Built-in Observability — [recorders.md](recorders.md)

Plug recorders into any concept via `.recorder()`. Tokens, cost, quality, guardrails — all collected during traversal.

---

For architecture deep-dives, see [docs/internals/](../internals/).

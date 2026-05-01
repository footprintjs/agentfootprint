# Guides

Comprehensive guides for using agentfootprint — the explainable agent framework. Organized by the five-layer taxonomy (primitives → compositions → patterns → context engineering → features).

## Taxonomy

```
PRIMITIVES       LLM · Agent
COMPOSITIONS     Sequence · Parallel · Conditional
PATTERNS         ReAct · Dynamic ReAct · Hierarchy (Swarm) · Reflexion · Tree-of-Thoughts · Plan-Execute · Map-Reduce
CONTEXT ENG      RAG · Memory · Skills · Instructions · Tools · Grounding
FEATURES         Providers · Recorders · Adapters · Orchestration · Security · Streaming
```

Two theses:
1. **Agent = ReAct.** If it doesn't loop-with-tools, it isn't an Agent.
2. **Every named pattern = a composition of primitives.** Reflexion, Tree-of-Thoughts, Hierarchy — all recipes, not new classes.

## Pages

| Layer | Guide | What it covers |
|-------|-------|---------------|
| Start here | **[Quick Start](quick-start.md)** | Install, first LLMCall, first Agent with tools, adapter-swap testing |
| All layers | **[Concepts](concepts.md)** | The 5-layer taxonomy: 2 primitives, 3 compositions, patterns, context engineering, features |
| Patterns | **[Patterns](patterns.md)** | Loop patterns (Regular/Dynamic ReAct) + composition patterns (planExecute, reflexion, treeOfThoughts, mapReduce). Each with "Built from" recipe + source paper |
| Context Eng | **[Instructions](instructions.md)** | Conditional context injection — 3-position injection, Decision Scope, `decide()` field |
| Features | **[Providers](providers.md)** | PromptProvider, MessageStrategy, ToolProvider — swap strategies without changing agent code |
| Features | **[Recorders](recorders.md)** | All 7 recorders (Token, Cost, Turn, ToolUsage, Quality, Guardrail, Composite) + `.recorder()` API |
| Features | **[Adapters](adapters.md)** | LLM adapters (Anthropic, OpenAI, Bedrock, Ollama, Mock) + protocol adapters (MCP, A2A) |
| Features | **[Orchestration](orchestration.md)** | `withRetry`, `withFallback`, `withCircuitBreaker` — reliability wrappers |
| Features | **[Security](security.md)** | Tool gating, permission policy, provider fallback, resilient providers, audit trail |
| Features | **[Streaming](streaming.md)** | Real-time lifecycle events (AgentStreamEvent), SSE, onEvent callback |
| Features | **[Caching](caching.md)** | v2.6+ — provider-agnostic cache layer with per-injection policies; 77% token reduction on Dynamic ReAct |

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

### The taxonomy — [concepts.md](concepts.md)

Start with a primitive. Compose up. Don't invent new classes for every pattern — every named paper is a recipe built from the same 2 + 3 building blocks.

| Layer | What you get |
|---------|-------------|
| **LLM** (primitive) | Single invocation |
| **Agent** (primitive) | Tool-use loop (= ReAct) |
| **Sequence / Parallel / Conditional** (compositions) | Arrange runners |
| **Patterns** | Named recipes: Reflexion, ToT, Plan-Execute, Map-Reduce, Hierarchy |
| **Context engineering** | RAG / Memory / Skills / Instructions injected into Agent slots |

### Built-in Observability — [recorders.md](recorders.md)

Plug recorders into any primitive, composition, or pattern via `.recorder()`. Tokens, cost, quality, guardrails — all collected during traversal.

---

For architecture deep-dives, see [docs/internals/](../internals/).

# Guides

Comprehensive guides for using agentfootprint — the explainable agent framework. Organized by the five-layer taxonomy (primitives → compositions → patterns → context engineering → features).

## Taxonomy

```
PRIMITIVES       LLM · Agent
COMPOSITIONS     Sequence · Parallel · Conditional
PATTERNS         ReAct · Dynamic ReAct · Swarm (hand-off) · Reflection · Tree-of-Thoughts · Self-Consistency · Debate · Map-Reduce
CONTEXT ENG      RAG · Memory · Skills · Instructions · Tools · Grounding
FEATURES         Providers · Recorders · Adapters · Orchestration · Security · Streaming
```

Two theses:
1. **Agent = ReAct.** If it doesn't loop-with-tools, it isn't an Agent.
2. **Every named pattern = a composition of primitives.** Reflection, Tree-of-Thoughts, Swarm — all recipes, not new classes.

## Pages

| Layer | Guide | What it covers |
|-------|-------|---------------|
| Start here | **[Quick Start](quick-start.md)** | Install, first LLMCall, first Agent with tools, adapter-swap testing |
| All layers | **[Concepts](concepts.md)** | The 5-layer taxonomy: 2 primitives, 3 compositions, patterns, context engineering, features |
| Patterns | **[Patterns](patterns.md)** | Loop patterns (Classic/Dynamic ReAct via `reactMode`) + composition patterns (`selfConsistency`, `reflection`, `debate`, `mapReduce`, `tot`, `swarm`). Each with "Built from" recipe + source paper |
| Context Eng | **[Instructions](instructions.md)** | Conditional context injection — `defineInstruction`, attaching to an agent, the four trigger kinds, Steering for always-on rules |
| Features | **[Providers](providers.md)** | The 3 agent slots — system prompt + messages via injections, tools via `ToolProvider` (`staticTools` / `gatedTools` / `skillScopedTools`) — swap strategies without changing agent code |
| Features | **[Recorders](recorders.md)** | Built-in recorders (agent, stream, cost, eval, memory, skill, tools, permission, composition, context) + `.attach()` / `.recorder()` API |
| Features | **[Adapters](adapters.md)** | LLM adapters (Anthropic, OpenAI, Bedrock, Ollama, Mock) + protocol adapters (MCP) |
| Features | **[Orchestration](orchestration.md)** | `withRetry`, `withFallback`, `withCircuitBreaker` — reliability wrappers |
| Features | **[Security](security.md)** | Tool gating, permission policy, provider fallback, resilient providers, audit trail |
| Features | **[Prompt Injection](prompt-injection.md)** | Honest posture: core does NOT detect injection — containment (gating, args validation, halts, credential scoping) + evidence, and what to add yourself |
| Features | **[Trace Debugging](trace-debugging.md)** | The introspection toolpack (RFC-003 Part C): `traceToolpack(artifacts)` — trace evidence as tools a debugging LLM calls; bounded, honest (⚠), redaction-respecting, id-navigable |
| Features | **[Streaming](streaming.md)** | Real-time lifecycle events via the typed event bus (`.on()`), SSE (`toSSE` / `SSEFormatter`), token streaming |
| Features | **[Caching](caching.md)** | v2.6+ — provider-agnostic cache layer with per-injection policies; 77% token reduction on Dynamic ReAct |
| Deploy | **[AgentCore](agentcore.md)** | Run on AWS Bedrock AgentCore: Runtime deploy template + Memory / Observability / Gateway(MCP) / Bedrock / Identity adapters |

---

## Key Differentiators

### Adapter-Swap Testing — [quick-start.md#adapter-swap-testing](quick-start.md#adapter-swap-testing)

Write tests with `mock()`, deploy with `anthropic()`. Same code. Zero changes. Full coverage at $0.

```typescript
import { mock } from 'agentfootprint';
import { anthropic } from 'agentfootprint/llm-providers';

// test — deterministic, free
const provider = mock({ reply: 'Paris.' });

// production — swap one line
const provider = anthropic({ defaultModel: 'claude-sonnet-4-5-20250929' });
```

### The taxonomy — [concepts.md](concepts.md)

Start with a primitive. Compose up. Don't invent new classes for every pattern — every named paper is a recipe built from the same 2 + 3 building blocks.

| Layer | What you get |
|---------|-------------|
| **LLM** (primitive) | Single invocation |
| **Agent** (primitive) | Tool-use loop (= ReAct) |
| **Sequence / Parallel / Conditional** (compositions) | Arrange runners |
| **Patterns** | Named recipes: Reflection, ToT, Self-Consistency, Debate, Map-Reduce, Swarm |
| **Context engineering** | RAG / Memory / Skills / Instructions injected into Agent slots |

### Built-in Observability — [recorders.md](recorders.md)

Plug recorders into any primitive, composition, or pattern via `.recorder()`. Tokens, cost, quality, guardrails — all collected during traversal.

---

For architecture deep-dives, see [docs/internals/](../internals/).

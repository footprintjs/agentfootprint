# Modularity — the Liskov lineage

> **In one line:** Liskov's work on Abstract Data Types (1974) and the Substitution Principle (1987) gives us a *vocabulary and a constraint set* for boundaries that don't leak. agentfootprint's subflows, providers, strategies, and recorders are all instances of that pattern — which is why connected data (the [Palantir win](./connected-data-palantir.md)) doesn't collapse into a monolith.

## Liskov's pillars (the relevant subset)

1. **Abstract Data Types (ADTs)** — *Programming with Abstract Data Types* (1974) and the CLU language. A module is a *cluster* that groups operations + the type they act on, hiding implementation behind a specification.
2. **Liskov Substitution Principle (LSP)** — *Data Abstraction and Hierarchy* (1987). A subtype must preserve the *observable behavior* of its supertype, not just its shape. "If S is a subtype of T, then objects of T may be replaced with objects of S without breaking the program."
3. **Specification ≠ implementation** — clients depend on specifications. The implementation can change without breaking clients.
4. **Locality of reasoning** — the deeper goal of modularity. You should be able to read, test, and modify one module without holding the whole system in your head.

## How agentfootprint maps to each pillar

### 1. Subflows are CLU clusters

A CLU cluster groups operations on a type. A footprintjs **subflow** does exactly this:

| Cluster (CLU) | Subflow (footprintjs) |
|---|---|
| type S | state shape S (`TypedScope<S>`) |
| operations on S | stages mutating S |
| cluster boundary | `inputMapper` / `outputMapper` |
| hidden internals | inner stages + internal subflows |
| exported operations | the entry stage signature |

The parent flowchart sees only `subflow(parentScope) → mappedOutput`. Internal stages, decision branches, intermediate writes are invisible across the boundary. That's textbook Liskov "hide the representation."

### 2. CacheStrategy is the cleanest LSP example we have

The v2.6 cache layer is built on this exactly:

```typescript
interface CacheStrategy {
  capabilities: CacheCapabilities;
  prepareRequest(req, markers, ctx): Promise<{ request }>;
  extractMetrics(response): CacheMetrics;
}

// Subtypes — all behaviorally substitutable:
AnthropicCacheStrategy   // manual cache_control on system blocks
OpenAICacheStrategy      // pass-through (auto-cache)
BedrockCacheStrategy     // model-aware: Anthropic-style for Claude, pass-through else
NoOpCacheStrategy        // wildcard fallback
```

`Agent.ts` calls `strategy.prepareRequest(...)` knowing only the interface. Swap Anthropic for OpenAI for NoOp — agent code unchanged. The contract isn't just "same shape" — it's *behavioral*: every strategy returns a request that's a valid LLM input. That's LSP enforced at runtime, not just at type-check.

The same pattern holds for `LLMProvider`, `ToolProvider`, `MemoryStore`, `Recorder`, `FlowRecorder`, `EmitRecorder`, `CombinedRecorder`. **Every framework boundary is an LSP-substitutable interface.**

### 3. Specification vs implementation separation

Three layers of specification, all separable from implementation:

| Specification surface | What it specifies | Hides |
|---|---|---|
| `chart.toMermaid()` / `toSpec()` | Stages, edges, branches, subflow boundaries | Stage function bodies |
| `SubflowMountOptions` (`inputMapper` / `outputMapper` signatures) | What flows IN and OUT of a subflow | Internal stages, internal state |
| Tool schema (`{name, description, inputSchema}`) | What a tool accepts and roughly returns | Tool implementation |

Recorders observe at the **specification** level — they get `onStageStart(stageId, stageName)`, `onDecision(chosenBranch, evidence)`, `onSubflowEntry(subflowId, payload)`. They never see "the line of code that ran." That's Liskov's separation enforced as an event surface.

### 4. Locality of reasoning — the actual win

This is what Liskov was really after, and it's the win we lean on hardest. You can:

- **Read one stage in isolation.** It takes a TypedScope, reads keys, writes keys, optionally calls `decide()` / `$emit()`. No I/O outside scope. No global state. No knowledge of stages before or after.
- **Read one subflow in isolation.** Look at its inputMapper / outputMapper. Internal stages don't need to be understood until you debug something.
- **Compose subflows by their contracts alone.** `addSubFlowChartNext('sf-payment', paymentChart, ...)` — the parent doesn't need to know paymentChart's internal flow.
- **Test stages with a mock scope.** No agent loop, no LLM, no tools — create a scope, call the stage, assert on what it wrote.
- **Replay from `commitLog`** — every commit is keyed by `runtimeStageId`, so you can reconstruct execution as a sequence of local stage decisions.

This is locality of reasoning operationalized as a runtime invariant. It's why a 25-iteration ReAct agent doesn't become unreadable — every iteration is a sequence of locally-readable subflow boundaries.

## Where we extend beyond classical Liskov

A few places we go beyond what 1987 ADT theory cleanly covers:

- **Dynamic substitution** — Skills runtime: tools and system content recompose every iteration based on `activeInjections`. Liskov's ADTs were static; ours are activation-gated. Substitutability still holds (every active skill must satisfy the Skill interface) but *which* changes per iter.
- **Three observer channels with method-shape detection** — `Recorder` / `FlowRecorder` / `EmitRecorder` route by which methods you implement, not by class hierarchy. That's structural typing rather than nominal — closer to Cardelli/Wegner's later work, but still in the Liskov spirit (clients depend on what's *callable*, not on inheritance).
- **Decision evidence on top of the contract** — `decide()` and `select()` capture *why* a substitutable choice was made. ADT theory says "operations have specifications"; we add "and they record which spec rule fired."

## The deeper takeaway

Liskov's central insight was that modularity is about **what you DON'T have to know** to use a module correctly. agentfootprint operationalizes this at three nested levels:

```
Stage                  ← don't need to know other stages exist
  ↓ composed in
Subflow                ← don't need to know inner stages
  ↓ mounted in
Parent Flowchart       ← don't need to know subflow internals
```

Across all three: recorders observe at boundaries, not internals. Cache / LLM / Tool / Memory strategies are LSP-substitutable. The "library of libraries" architecture is itself a Liskov pattern — each library is a cluster with a stable export surface, and the dependency DAG (`memory <- scope <- reactive <- engine <- runner`) means lower libraries can't possibly depend on internals of higher ones. That's modularity by construction.

The reason agentfootprint can offer "swap providers without changing agent code" or "swap cache strategies on import" or "compose a Skill that recomposes the prompt per iter" is that every boundary is an LSP-substitutable interface, and the agent loop only knows the interface — never the implementation.

That's not coincidence — it's the design philosophy made concrete.

## Pairing with connected data

Liskov gives us **boundaries that don't leak**. [Palantir-style connected data](./connected-data-palantir.md) gives us **connections within those boundaries**. Together: clean modules + connected data = a runtime that's both fast (Palantir multiplier) and reasonable (Liskov locality).

## Further reading

- Liskov & Zilles, *Programming with Abstract Data Types* (1974)
- Liskov & Wing, *A Behavioral Notion of Subtyping* (1994)
- Liskov, Turing Award lecture *The Power of Abstraction* (2008) — https://www.youtube.com/watch?v=8C_kHJg9Mpo
- CLU language documentation (MIT) — historical, but the cluster syntax reads remarkably like a TypeScript module today

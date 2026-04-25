# `src/v2/adapters/` — the Ports-and-Adapters outer ring

## What lives here

Pluggable provider interfaces (the "ports") and the implementations that adapt external services to them (the "adapters"). Everything the library reaches for OUTSIDE itself lives behind an adapter.

```
adapters/
├── types.ts            All port interfaces in one file.
└── llm/
    └── MockProvider.ts Deterministic in-process LLM provider for tests + demos.
```

Phase 5+ additions (planned):

```
adapters/
├── llm/
│   ├── AnthropicProvider.ts
│   ├── OpenAIProvider.ts
│   ├── GoogleProvider.ts
│   └── LocalProvider.ts
├── memory/
│   ├── PineconeStore.ts
│   ├── WeaviateStore.ts
│   ├── QdrantStore.ts
│   └── InMemoryStore.ts
├── context/
│   ├── RAGSource.ts
│   ├── SkillSource.ts
│   ├── MemorySource.ts
│   └── InstructionsSource.ts
├── embedding/
│   ├── OpenAIEmbeddings.ts
│   └── CohereEmbeddings.ts
├── guardrail/
│   ├── LlamaGuardDetector.ts
│   └── NeMoGuardrailsDetector.ts
├── policy/
│   ├── OPAChecker.ts
│   └── CerbosChecker.ts
└── pricing/
    ├── AnthropicPricing.ts
    └── OpenAIPricing.ts
```

## Architectural decisions

### Decision 1: Ports defined in ONE file (`types.ts`)

All seven adapter interfaces live in `types.ts`:

- `LLMProvider` — LLM API calls
- `MemoryStore` — vector store operations
- `ContextSourceAdapter` — produces InjectionRecords for a slot
- `EmbeddingProvider` — text → vector
- `RiskDetector` — guardrail / safety checks
- `PermissionChecker` — access control
- `PricingTable` — token → cost mapping

Centralizing them makes the "surface area that reaches OUTSIDE the library" reviewable in one file. When a new port is needed, it's a diff on `types.ts`.

### Decision 2: Dependency rule — one-way only

`core/` and `core-flow/` (Phase 4) depend on `adapters/types.ts` (the interfaces). They NEVER import from a concrete adapter implementation (`AnthropicProvider`, etc.). Concrete adapters are injected by consumers at `.create({ provider })` time.

```
consumer code    ──►  new AnthropicProvider(apiKey)
                          │
                          ▼
Agent.create({ provider }).build()
                          │
                          ▼ typed as LLMProvider
core/Agent.ts         ──►  provider.complete(...)
```

This keeps the library provider-agnostic — swap `AnthropicProvider` for `OpenAIProvider` with no library change.

### Decision 3: Provider-agnostic event payloads

When core recorders emit events about provider activity (e.g. `stream.llm_start`), the payload is **normalized**:

```typescript
interface LLMStartPayload {
  provider: LLMProviderName;     // 'anthropic' | 'openai' | … | (string & {})
  model: string;
  systemPromptChars: number;
  messagesCount: number;
  toolsCount: number;
  // Optional escape hatch:
  providerRequestRef?: string;
}
```

Core event shapes don't vary by provider. Raw provider-specific request/response payloads (Anthropic's content blocks, OpenAI's function_call shape, etc.) go into optional `providerRequestRef` / `providerResponseRef` sidecar references — consumers who need the raw shape opt-in to that dereferencing.

### Decision 4: `(string & {})` on open-enum types for forward compatibility

`LLMProviderName` is `'anthropic' | 'openai' | ... | (string & {})`. The `(string & {})` is the TypeScript trick that preserves autocomplete for the known names while accepting any custom string. Consumers building a `CustomProvider` get `'custom'` or `'mock'` in autocomplete AND can use any name they like without a cast.

### Decision 5: Each adapter carries its `name` field

Every adapter port requires a `readonly name: string` field. That name surfaces in events (`stream.llm_start.provider`, `memory.attached.retriever`, `embedding.generated.provider`). Consumers can filter / debug by provider name without the library knowing the full set of providers.

### Decision 6: `MockProvider` ships in-core

A deterministic, network-free LLM provider is a required test/demo dependency. It lives in `adapters/llm/` alongside real providers rather than being tucked away in tests. Consumers can use it directly for their own tests without importing from test paths.

## The contract consumers implement

For every port, implementing a new adapter is:

1. Implement the interface from `types.ts`
2. Provide a unique `name`
3. Handle errors gracefully — return `{ error: true }` in results where the port allows; throw for catastrophic failures
4. Be side-effect-free at construction (adapter = pure configuration object; side effects during `.call()` / `.execute()`)

Consumer wires it in:

```typescript
const agent = Agent.create({
  provider: new AnthropicProvider({ apiKey }),   // any LLMProvider impl
  model: 'claude-opus-4-7',
}).build();
```

## When to add a new port

Ports are the MOST expensive thing to add (every consumer using the library sees them). Criteria:

1. Is this a genuine external capability category? (not just a variant of an existing one)
2. Will there be 3+ real implementations over the lifetime of the library?
3. Is the interface stable — can you name the 3–5 operations that all impls need?

If yes to all three, add to `types.ts` + create the subfolder. If no, it's probably a configuration option on an existing port, not a new one.

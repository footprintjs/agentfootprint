# Strategy Pattern Everywhere — port / adapter for vendor integrations

> **In one line:** the v2.6 cache layer (one DSL, N vendor strategies, side-effect-import auto-registration, wildcard fallback) is the right shape for every observability / cost / status / lens vendor integration. v2.8+ generalizes the principle as a unified `agent.enable.<group>(opts)` + strategy-slot architecture. **One contract, many adapters, swap by config.**

## The lineage

This is the same pattern in 5 different formal traditions:

| Tradition | Name | What it is |
|---|---|---|
| GoF (1994) | **Strategy Pattern** | Pluggable algorithm; client picks at runtime |
| GoF (1994) | **Bridge Pattern** | Decouple abstraction from implementation across N vendor boundaries |
| Cockburn (2005) | **Hexagonal / Ports & Adapters** | The DSL is the *port*; each vendor integration is an *adapter* |
| Microsoft (.NET) | **Provider model** | Exact same shape: pluggable runtime providers selected by config, default + override |
| Plotkin & Pretnar | **Algebraic effects** | Strategies are *effect handlers*; the DSL is the *effect signature*; composition is *handler stacking* |

The cache layer in v2.6 is an instance. v2.8 makes it the universal architectural pattern across the library.

## Why we know it works — v2.6 cache as proof of concept

```
DSL on the consumer side:
  cache: 'always' | 'while-active' | 'never' | { until: predicate }

Pipeline:
  CacheDecisionSubflow → CacheGate → strategy.prepareRequest → wire format

Strategies (auto-registered via side-effect import):
  AnthropicCacheStrategy   (manual cache_control)
  OpenAICacheStrategy      (auto-cache pass-through)
  BedrockCacheStrategy     (model-aware: Claude → Anthropic-style; else pass-through)
  NoOpCacheStrategy        (wildcard fallback)
  Future: GeminiCacheStrategy

Validated outcome:
  Sonnet Dynamic ReAct: 36,322 → 6,535 input tokens (−82%) end-to-end
```

Properties the cache layer demonstrated and v2.8 generalizes:

1. **One DSL** — consumers write declarative intent, not provider-specific calls
2. **N strategies** — auto-registered by side-effect import; `agentfootprint/cache-anthropic` etc. as subpaths with peer-dep on vendor SDK
3. **Wildcard fallback** — unknown provider gets a No-Op strategy that's safe by construction
4. **Hot-path zero-allocation** — when the strategy says "no work to do," the runtime skips marker emission entirely
5. **CI-testable with mocks** — every strategy ships a mock variant; production swaps in the real one
6. **Lock-in-free** — vendor swap is a one-line change in config, not an agent rewrite

## AWS adapter map — first ecosystem to support

Library already ships `memory-agentcore` (`@aws-sdk/client-bedrock-agent-runtime` peer dep). The AWS pattern is established. v2.8 lights up AWS-side observability + cost in priority order:

| Subpath | AWS service | Peer dep | What it does | When |
|---|---|---|---|---|
| **`agentfootprint/observability-agentcore`** | AWS Bedrock **AgentCore Observability** | `@aws-sdk/client-bedrock-agent-runtime` (already a peer for `memory-agentcore`) | Pipe events into AgentCore's native observability surface. Consumers already integrated with AgentCore Memory get observability for free — same peer dep, same SDK client, same auth. | **v2.8.1 — AWS-first priority** |
| **`agentfootprint/observability-cloudwatch`** | AWS CloudWatch Logs / Metrics | `@aws-sdk/client-cloudwatch-logs`, `@aws-sdk/client-cloudwatch` | Generic structured logging + custom metrics. Standard AWS observability sink. | **v2.8.2** |
| **`agentfootprint/observability-xray`** | AWS X-Ray | `@aws-sdk/client-xray` | Distributed tracing — spans per LLM call / tool call / iteration. Auto-derives parent-child from `runtimeStageId`. | **v2.8.3** |
| **`agentfootprint/audit-cloudtrail`** *(future)* | AWS CloudTrail | `@aws-sdk/client-cloudtrail` | Tamper-evident audit log for permission decisions, denied tools, capability inventory. | v2.9+ when `enable.audit` ships |
| **`agentfootprint/cost-cloudwatch-billing`** *(future)* | AWS Cost & Billing | `@aws-sdk/client-cost-explorer` | Pipe agentfootprint cost ticks into Cost Explorer for org-level dashboards. | v2.10+ |

Why AWS-first:
1. **Existing precedent** — `memory-agentcore` already ships, same peer-dep auth pattern reused
2. **AgentCore observability is the lowest-effort, highest-value first adapter** — same SDK consumer is already importing
3. **CloudWatch covers the "I don't use AgentCore but I'm on AWS" case** — broader audience
4. **X-Ray adds distributed tracing** — same pattern OTel uses, but AWS-native (no OTel collector needed)

After AWS lands, OTel + Datadog + Pino follow in v2.9.x (vendor-neutral / non-AWS).

## The 4 groups in scope for v2.8

Each group is a port; vendor integrations are adapters. `enable.<group>({ strategy, ...opts })` plumbs events to the chosen strategy.

| Group | DSL options | Strategies (initial set) | Default | Out-of-scope per memo |
|---|---|---|---|---|
| **`enable.observability`** | `tier: 'minimal' \| 'standard' \| 'firehose'` · `sampleRate: 0..1` | `console()` · `otel(tracer)` · `datadog(config)` · `pino(logger)` · `cloudwatch(client)` | `console()` | server log shipping (Splunk, etc.) |
| **`enable.cost`** | `budget?` · `breakers?` | `inMemorySink({onTick})` · `stripeBilling(account)` · `webhook(url)` | `inMemorySink()` | OpenAI dashboard pipe (later) |
| **`enable.liveStatus`** | `templates?: ThinkingTemplates` | `chatBubble(cb)` · `stdout()` · `webhook(url)` | `chatBubble(cb)` | server-sent-events helper (later) |
| **`enable.lens`** | (rendering target) | `browser()` · `cliTUI(stream)` · `jsonExport(writer)` | `browser()` | Lens-as-service (later) |

**Parked for later** (same pattern, different time): `audit`, `governance`, `debug`, `eval`, `reflection`.

## The Strategy interface

Per group, a typed interface (small, focused, no inheritance):

```typescript
// Generic shape — each group has its own concrete version
interface ObservabilityStrategy {
  readonly name: string;                  // registry key
  readonly capabilities: {
    traces?: boolean;
    metrics?: boolean;
    logs?: boolean;
  };
  onEvent(event: AgentfootprintEvent): void;  // hot path; sync, side-effect-only
  flush?(): Promise<void>;                    // batch exporters
  stop?(): void;                              // teardown
}
```

Three properties enforced at the interface level:

1. **Idempotent registration** — registering the same `name` twice replaces, doesn't duplicate
2. **Side-effect-free `onEvent`** — must not throw, must not block. Errors logged + swallowed (otherwise one bad exporter kills the agent loop)
3. **Optional `stop` / `flush`** — strategies that batch can flush on stop; strategies that don't need it don't implement

Same shape for `CostStrategy`, `LiveStatusStrategy`, `LensStrategy`. Symmetry is the point.

## The composite combinator

Multi-vendor fan-out comes free:

```typescript
import { compose } from 'agentfootprint/strategies';

agent.enable.observability({
  strategy: compose([
    datadog({ apiKey }),
    otel(tracer),
    console(), // local dev visibility
  ]),
});
```

`compose` returns a strategy whose `onEvent` fan-outs to every child. Errors per-child isolated; one bad exporter doesn't break others. Same pattern as `withRetry` / `withFallback` in the resilience subsystem.

## Package structure

Mirrors the existing memory-adapter layout (`memory-redis`, `memory-agentcore`):

```
agentfootprint                          ← core, ships default strategies
  /observability-otel                   ← peer: @opentelemetry/api
  /observability-datadog                ← peer: @datadog/browser-rum
  /observability-pino                   ← peer: pino
  /observability-cloudwatch             ← peer: @aws-sdk/client-cloudwatch-logs
  /cost-stripe                          ← peer: stripe
  /lens-cli                             ← peer: blessed | ink
```

Each:
- Lazy-imported (zero bundle weight when unused)
- Peer-dep on vendor SDK (consumer brings their version)
- `peerDependenciesMeta.optional: true` so missing peers don't break install
- Self-registers on import via side-effect

## Why this matters more than "shipping integrations"

Three architectural wins:

### 1. Vendor swap is a one-line change

```typescript
// Before
agent.enable.observability({ strategy: datadog({ apiKey }) });

// After (vendor migration)
agent.enable.observability({ strategy: otel(tracer) });
```

Agent code is untouched. The DSL is the contract; the vendor is the implementation. Same one-line property the cache layer offers (`provider: anthropic()` → `provider: openai()`) and the memory layer (`store: new InMemoryStore()` → `store: new RedisStore()`).

### 2. Multi-vendor fan-out without rewrites

Production observability is rarely single-vendor. Teams pipe to Datadog AND OTel AND a custom audit log AND a console. `compose([...])` handles this without consumers writing fan-out code per call site.

### 3. CI-testable without vendor accounts

Every strategy ships a mock variant:
```typescript
import { mockDatadog } from 'agentfootprint/observability-datadog/test';
agent.enable.observability({ strategy: mockDatadog() });
```

CI runs the full pipeline against the mock; production swaps in `datadog()`. **Mocks first, prod second** — the same architectural rule as `mock()` LLM provider, `InMemoryStore`, `mockMcpClient`.

## What survives the panel review (locked-in design decisions)

From the 7-expert design review (AWS IAM, Datadog, OTel, Stripe, Vercel, React, Anthropic):

| # | Decision | Owner |
|---|---|---|
| 1 | Discriminated-union options (`{ kind, ...rest }`) inside each group, so new sub-features don't break the type | Stripe |
| 2 | Idempotent `stop()` — halts everything that call enabled, nothing else | Stripe |
| 3 | `tier: 'minimal' \| 'standard' \| 'firehose'` knob with cost-of-on docs at the call site | Datadog |
| 4 | `sampleRate: 0..1` on every observability enabler | Datadog |
| 5 | OTel exporter as the first non-default vendor (semconv alignment is free interop) | OTel SIG |
| 6 | `mode: 'observe' \| 'enforce'` on `audit` (when it ships) — dry-run is non-negotiable | AWS IAM |
| 7 | Zero-arg defaults for HelloWorld (`enable.observability()` works without options) | Vercel |
| 8 | Auto-detect `NODE_ENV` for sensible dev/prod defaults | Vercel |
| 9 | `compose([...])` combinator for multi-vendor fan-out + idempotent re-registration | React |
| 10 | Granular methods stay (additive, deprecated-not-removed); flat namespace marked `@deprecated` in JSDoc | Stripe |

## Migration plan — **AWS-first vendor priority**

The library already has `memory-agentcore` (`@aws-sdk/client-bedrock-agent-runtime` peer dep) shipping. Established pattern. Lean into the same ecosystem for observability strategies.

| Version | What ships | Breaking? |
|---|---|---|
| **v2.8.0** | Add the 4 grouped enablers (`observability`, `cost`, `liveStatus`, `lens`) + strategy slot + 3 default strategies (`console`, `inMemorySink`, `chatBubble`) + `compose([...])` combinator. Granular methods kept, marked `@deprecated`. | No |
| **v2.8.1** | **AWS Bedrock AgentCore Observability** — `agentfootprint/observability-agentcore`. Pipes events into AgentCore's native observability. Same peer (`@aws-sdk/client-bedrock-agent-runtime`) as `memory-agentcore`, so consumers already integrated with AgentCore Memory get observability for free. | No |
| **v2.8.2** | **AWS CloudWatch Logs** — `agentfootprint/observability-cloudwatch`. Generic AWS structured logging. Peer: `@aws-sdk/client-cloudwatch-logs`. | No |
| **v2.8.3** | **AWS X-Ray** — `agentfootprint/observability-xray`. Distributed tracing. Peer: `@aws-sdk/client-xray`. | No |
| **v2.9.x** | OTel exporter (`observability-otel`) — non-AWS but vendor-neutral; OTel SIG offered to contribute | No |
| **v2.10.x** | Non-AWS observability: Datadog, Pino | No |
| **v2.11.x** | `cost-stripe`, `cost-webhook` | No |
| **v2.12.x** | Lens strategies (`browser`, `cliTUI`, `jsonExport`) | No |
| **v3.0** | Remove deprecated flat `enable.thinking` / `enable.logging` / `enable.flowchart` | **Breaking** — single-line migration via search-replace |

## Out of scope (parked)

These will get the same treatment but in separate design memos and future minors:

- **`enable.audit`** — append-only, tamper-evident. Strategies: `cloudtrail()`, `splunk()`, `localFile(path)`, `noop()`. Per AWS IAM review: must NOT be lumped with `governance`.
- **`enable.governance`** — soft signals: budget tracking, hit-rate floors, skill-churn detection. Per AWS IAM review: separate from `audit` (different threat models).
- **`enable.debug`** — Vercel-style "everything on, console output." Different defaults from `observability`.
- **`enable.eval`** — trajectory scoring, golden-answer matching.
- **`enable.reflection`** — causal-memory replay, self-improvement loops.

Each of these is well-understood structurally; they're parked because v2.8.0 should be small enough to review and ship cleanly.

## Why this is a "Liskov-substitutable" architecture

Every strategy is a behavioral subtype of its interface:

```
ObservabilityStrategy       (the supertype — the contract)
├── ConsoleStrategy         (substitutable: prints events to stdout)
├── OTelStrategy            (substitutable: forwards to OTel tracer)
├── DatadogStrategy         (substitutable: ships to Datadog API)
├── PinoStrategy            (substitutable: pipes through pino)
└── ComposeStrategy         (substitutable: fan-outs to N children)
```

Agent code calls `strategy.onEvent(event)` knowing only the interface. Swap any in, agent works. **That's LSP enforced at runtime, not just at type-check.** Same property as `LLMProvider`, `MemoryStore`, `CacheStrategy`, `ToolProvider`.

The library has *one architectural pattern*, applied recursively. Strategy + LSP + side-effect-import auto-registration is the spine. Cache was the first instance; v2.8 makes it the universal principle.

## Pairing with other inspiration pages

- [`modularity-liskov.md`](./modularity-liskov.md) — *why* substitutability is sound (the abstraction theory)
- [`connected-data-palantir.md`](./connected-data-palantir.md) — *why* connected data matters (the user value)
- **`strategy-everywhere.md`** (this) — *how* the library scales to N vendor integrations without architectural drift

The three together form the load-bearing architecture: connected data inside clean boundaries, with vendor integrations as substitutable adapters. **Adapter substitutability is what keeps the data-connection guarantees from leaking across vendor boundaries.**

## Approval gates

Before v2.8.0 implementation starts:

1. ✅ Design memo (this document) committed and reviewed
2. 🔲 Strategy interface signatures locked in `src/recorders/strategies/types.ts` (skeleton only)
3. 🔲 1 vendor adapter PROTOTYPED end-to-end (suggest: OTel — SIG offered) before scaling to N
4. 🔲 Mock-strategy contract test — validates that ANY strategy implementing the interface plugs in cleanly
5. 🔲 Performance baseline — `compose([...])` of 5 children must add ≤ 5% overhead vs single strategy

Once gate 5 passes, we know the architecture scales linearly. Then ship the rest in independent minors.

## Further reading

- *Design Patterns* (Gamma et al., 1994) — Strategy + Bridge chapters
- Cockburn, *Hexagonal Architecture* (2005) — port/adapter formalism
- Plotkin & Pretnar, *Handlers of Algebraic Effects* (2009) — handler-stacking semantics
- The v2.6 CHANGELOG entry — strategy pattern in our codebase, retrospective

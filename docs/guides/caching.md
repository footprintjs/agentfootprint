# Caching

> **In 60 seconds:** Anthropic & Bedrock-Claude charge ~10% of normal price for cached input tokens, but only if you tell the API which prompt blocks are stable. v2.6's cache layer attaches those hints automatically based on per-injection policies. On Sonnet Dynamic ReAct: input tokens drop from 28,404 → 6,535 (−77%) with one config flag. Strategies are pluggable; OpenAI and Bedrock-Llama auto-cache (no opt-in needed).

## Why this layer exists

LLM context windows are growing, but per-token pricing isn't. A typical Dynamic ReAct loop sends the same system prompt + tool descriptions on every iteration — paying full price every time even though the bytes are identical. Caching collapses that "stable prefix" into one paid write + N cheap reads.

The complication: every provider has a different protocol.

| Provider | Mechanism | Hint required? | Surfaced via |
|---|---|---|---|
| Anthropic | `cache_control: { type: 'ephemeral' }` on each block | ✅ Yes — manual | `usage.cache_creation_input_tokens` / `cache_read_input_tokens` |
| Bedrock (Claude models) | Same as Anthropic — Bedrock proxies the field | ✅ Yes — manual | Same |
| Bedrock (Llama models) | Implicit on long prompts | ❌ Auto | Not exposed |
| OpenAI | Implicit on cacheable surfaces | ❌ Auto | `prompt_tokens_details.cached_tokens` |
| Gemini (future) | TBD | TBD | TBD |

agentfootprint v2.6 unifies this with a **strategy registry**: one DSL, one CacheDecision subflow, N provider-specific encoders.

## Quick start

Caching is **on by default**. Turn it off explicitly:

```typescript
import { Agent } from 'agentfootprint';
import { anthropic } from 'agentfootprint/llm-providers';

const agent = Agent.create({
  provider: anthropic({ apiKey, defaultModel: 'claude-sonnet-4-5-20250929' }),
  caching: 'off',  // disables the cache layer entirely
}).system('...').build();
```

`caching` accepts only the literal `'off'`. Leaving it unset keeps caching enabled.

That's it. With caching on, the library:
1. Walks every active injection (skill, steering, fact, instruction, memory)
2. Reads each injection's `cache:` policy (per-flavor defaults below)
3. Hands the resulting `CacheMarker[]` to the registered strategy for the active provider
4. The strategy attaches provider-specific hints to the request body

You only override defaults when you want to.

## Per-injection cache policies

Each injection flavor has a sensible default:

| Flavor | Default `cache:` | Rationale |
|---|---|---|
| `defineSteering(...)` | `'always'` | Steering text is the most stable thing in the loop — cache aggressively |
| `defineFact(...)` | `'always'` | Facts are static reference data — same lifetime as steering |
| `defineSkill(...)` | `'while-active'` | Skill body is stable as long as the skill stays activated; flush on deactivation |
| `defineInstruction(...)` | `'never'` | Conditional injections — `activeWhen` flips per-turn, makes caching counterproductive |
| `defineMemory(...)` | `'while-active'` | Memory recall results are stable within a session but change between sessions |

Override per injection:

```typescript
import { defineSkill } from 'agentfootprint';

defineSkill({
  id: 'port-error-triage',
  description: '...',
  body: '...',       // appended to the system-prompt slot on activation
  tools: [/* ... */],
  cache: 'always',   // override the 'while-active' default
});
```

Valid values: `'always'` | `'while-active'` | `'never'` | `{ until: (ctx) => boolean }` (cached UNTIL the predicate returns `true`; `ctx` exposes `iteration`, `iterationsRemaining`, `userMessage`, `lastToolName?`, `cumulativeInputTokens`).

## How CacheDecision and CacheGate work

Two subflows run between `CollectActivations` and `CallLLM` every iteration:

```
CollectActivations → CacheDecision → CacheGate → (apply markers / no-op) → CallLLM
                          │              │
                          │              └── footprintjs decide() with 3 rules:
                          │                    1. cachingDisabled → no markers
                          │                    2. recentHitRate < 0.3 → no markers
                          │                    3. ≥3 unique skills in last 5 iters → no markers
                          │
                          └── for each active injection, evaluate cache: directive,
                              produce one CacheMarker per flavor that says 'always' or
                              ('while-active' && active)
```

**CacheGate** is the safety net. It looks at runtime signals and disables marker emission when caching would HURT performance. For example, if the LLM is rapidly switching between skills (high churn), every skill change invalidates the cache — so the gate suspends caching for that run.

The gate uses footprintjs `decide()` so its decision evidence is captured for free. A `cacheRecorder()` ships internally to surface it (subscribes to `FlowRecorder.onDecision` for the CacheGate routing + reads provider `usage` for per-iteration metrics). Its `report()` returns a `CacheReportSummary`:

```typescript
// CacheReportSummary shape returned by cacheRecorder().report():
// {
//   totalIterations, applyMarkersIterations, noMarkersIterations,
//   cacheReadTokensTotal, cacheWriteTokensTotal, freshInputTokensTotal,
//   hitRate, estimatedDollarsSpent, estimatedDollarsSavedVsNoCache,
//   perIter: [...]
// }
```

> **Note:** `cacheRecorder`, the strategy registry (`registerCacheStrategy` / `getDefaultCacheStrategy`), and the `CacheStrategy` / `CacheMarker` / `CacheMetrics` types currently live in `src/cache/` but are **not exported from any public entry point** — there is no `agentfootprint/cache` subpath yet. Strategies auto-register on import of the main barrel (side-effect), so the built-in providers cache automatically. The consumer-facing surface today is `Agent.create({ caching: 'off' })` plus the per-injection `cache:` field below. Direct access to the recorder and registry is on the roadmap.

## The 5 strategies

Strategies live behind a registry. Each is auto-registered on import:

| Strategy | Provider names matched | Behavior |
|---|---|---|
| `AnthropicCacheStrategy` | `'anthropic'`, `'browser-anthropic'` | Manual `cache_control` on system blocks; clamps to 4 markers (Anthropic limit); reads `cache_creation_input_tokens` + `cache_read_input_tokens` |
| `OpenAICacheStrategy` | `'openai'`, `'browser-openai'` | Pass-through (auto-cache); extracts `prompt_tokens_details.cached_tokens` for metrics |
| `BedrockCacheStrategy` | `'bedrock'` | Model-aware: applies Anthropic-style hints when modelId matches `^anthropic\.claude`, pass-through otherwise |
| `NoOpCacheStrategy` | `'*'` (wildcard fallback) | Reports `capabilities.enabled = false`; never emits markers |
| _Future: GeminiCacheStrategy_ | `'gemini'` | TBD |

Strategy registration is via side-effect import — each built-in strategy module calls `registerCacheStrategy(strategy)` at load time, keyed by `strategy.providerName`. The wildcard `'*'` → `NoOpCacheStrategy` entry is always present, so an unrecognized provider falls back to no-op.

A custom strategy implements the full `CacheStrategy` interface (`providerName`, `capabilities`, `prepareRequest`, `extractMetrics`) and registers itself with a single argument:

```typescript
// CacheStrategy / registerCacheStrategy are internal today (see note above).
// Shape for reference:
const myStrategy: CacheStrategy = {
  providerName: 'my-provider',                       // registry key
  capabilities: {
    enabled: true,
    maxMarkers: 8,
    ttls: ['short', 'long'],
    fields: ['system', 'tools', 'messages'],
    automatic: false,
  },
  prepareRequest: async (req, candidates, ctx) => {
    // ... attach provider-specific hints to req
    return { request: modifiedReq, markersApplied: candidates };
  },
  extractMetrics: (usage) => ({
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    freshInputTokens: 0,
  }),
};

registerCacheStrategy(myStrategy); // provider name comes from strategy.providerName
```

## Real-world numbers (production-shaped Skills agent)

Same task, same scenario, three context-engineering modes — measured on a 10-skill / 18-tool agent against the live Anthropic API:

| Mode | What's in the system prompt | cache=off | cache=on | Δ |
|---|---|---|---|---|
| **Classic** (no guidance) | Base only — LLM gets 18 raw tool schemas | 40,563 | (untested) | — |
| **Static** (stuff-and-cache) | Base + ALL 10 skill markdowns | ~140,000 | 7,640 | **−95%** |
| **Dynamic** (smart gating) | Base + 1 active skill markdown | 28,404 | **6,535** | **−77%** |

**Key insight:** without caching, you MUST gate (Dynamic). With caching, both work — Dynamic still wins by ~17% but Static becomes economically reasonable.

Cross-model totals (cache=on, Dynamic):

| Model | cache=off | cache=on | Δ |
|---|---|---|---|
| Sonnet 4.5 | 36,322 | 6,535 | **−82%** |
| Haiku 4.5 | 36,309 | 13,637 | **−62%** |
| Opus 4.5 | 28,477 | 10,745 | **−62%** |

## Observability

Two public event surfaces tell you what caching is doing:

1. **`FlowRecorder.onDecision`** — fires when CacheGate routes; `event.chosen` is `'apply-markers'` / `'no-markers'` and `event.evidence` carries the footprintjs `decide()` rule that fired (match the CacheGate stage via `splitStageId(event.traversalContext.stageId).localStageId`).
2. **`EmitRecorder.onEmit`** — `'agentfootprint.stream.llm_end'` events carry per-call cache token counts on `event.payload.usage.cacheRead` / `usage.cacheWrite`.

The internal `cacheRecorder()` composes both into a single `report()` (see the "How CacheDecision and CacheGate work" section), but it is not yet a public export.

## When to turn caching off

`caching: 'off'` is the right call when:
- Running unit tests with the `mock()` provider (no real network — caching is moot)
- Debugging context construction (you want to see exactly what was sent every iter)
- Working with a provider whose strategy is `NoOp` and you want to confirm zero overhead
- Doing token-cost A/B comparisons against pre-v2.6 behavior

In production, leave it on. The CacheGate handles the cases where caching would hurt.

## Smart gating vs stuff-and-cache — pick your trade-off

Pre-v2.6 the only economically sane Dynamic ReAct shape was **smart gating** — bind tools and skill markdowns conditionally, recompute per iter. That's still the lowest-token-per-iter approach and the lowest-latency approach.

Post-v2.6 you have a real second option: **stuff-and-cache** — put every skill markdown into the system prompt always, let the cache layer carry the cost. Simpler agent code, but ~17% more tokens vs gating, and worse latency on the first iter (the cache write).

Both patterns are now first-class. Pick based on your team's preferences, not on token cost.

## See also

- [Skills + InjectionEngine](instructions.md) — the gating mechanism Dynamic ReAct uses
- [Patterns](patterns.md) — Dynamic ReAct described as a composition recipe
- [Recorders](recorders.md) — observability for cache events

# Orchestration

Orchestration wrappers add reliability to any `LLMProvider`. Each wrapper is a **provider decorator** — it takes an `LLMProvider`, returns an `LLMProvider` with the same interface, and you pass the wrapped provider to `Agent.create({ provider })` (or any consumer of a provider). They compose naturally — stack them for production-grade resilience.

All wrappers live in the `agentfootprint/resilience` subpath (not the main barrel), and all return `LLMProvider`, so the wrapped provider is a drop-in replacement for the original.

```typescript
import { anthropic, openai } from 'agentfootprint/llm-providers';
import { withRetry, withFallback } from 'agentfootprint/resilience';
import { Agent } from 'agentfootprint';

const provider = withRetry(withFallback(anthropic({ apiKey }), openai({ apiKey })));
const agent = Agent.create({ provider, model: 'claude-sonnet-4-5' })
  .system('You are a helpful assistant.')
  .build();
```

---

## withRetry

Retries failed `complete()` calls with exponential backoff. Respects AbortSignal during wait periods. `stream()` is delegated as-is (mid-stream resumption is provider-specific, so streams are not retried).

```typescript
import { withRetry } from 'agentfootprint/resilience';

const robust = withRetry(provider, {
  maxAttempts: 3,         // total attempts including the first (default: 3)
  initialDelayMs: 200,    // delay before the first retry (default: 200)
  backoffFactor: 2,       // multiply delay each retry (default: 2)
  maxDelayMs: 10_000,     // cap on any single delay (default: 10000)
});

const agent = Agent.create({ provider: robust, model: 'mock' }).build();
const result = await agent.run({ message: 'Hello' });
// Attempts: 1st try → wait 200ms → 2nd try → wait 400ms → 3rd try (then throws)
```

### Selective Retry

By default `withRetry` skips `AbortError` and HTTP 4xx-class errors (except `429 Too Many Requests`), and retries everything else (network errors, 5xx, unknown shapes). Override `shouldRetry` to add provider-specific signals. The predicate receives the error and the current attempt number:

```typescript
import { withRetry } from 'agentfootprint/resilience';

const robust = withRetry(provider, {
  maxAttempts: 3,
  initialDelayMs: 500,
  shouldRetry: (err, attempt) => {
    // Retry on 429 / 5xx; let client errors propagate.
    const status = (err as { status?: number })?.status;
    return status === 429 || (typeof status === 'number' && status >= 500);
  },
  onRetry: (err, attempt, delayMs) => {
    console.warn(`retry ${attempt} in ${delayMs}ms`, err);
  },
});
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxAttempts` | `number` | `3` | Total attempts including the first (min 1) |
| `initialDelayMs` | `number` | `200` | Delay before the first retry (ms) |
| `backoffFactor` | `number` | `2` | Multiply delay each retry |
| `maxDelayMs` | `number` | `10000` | Cap on any single delay (ms) |
| `shouldRetry` | `(error, attempt) => boolean` | skips AbortError + 4xx (retries 429) | Retry predicate |
| `onRetry` | `(error, attempt, delayMs) => void` | — | Hook fired before each retry |

---

## withFallback

If the primary provider throws, the fallback provider handles the request. `stream()` falls back too — but only if the primary errors *before* yielding any chunk (once tokens flow, restarting would duplicate output).

```typescript
import { withFallback } from 'agentfootprint/resilience';

// Expensive model → cheap model on failure
const resilient = withFallback(expensiveProvider, cheapProvider);
const agent = Agent.create({ provider: resilient, model: 'mock' }).build();
const result = await agent.run({ message: 'Hello' });
```

### Selective Fallback

By default every error except `AbortError` triggers fallback. Override `shouldFallback` to gate on specific status codes or error types:

```typescript
import { withFallback } from 'agentfootprint/resilience';

const resilient = withFallback(primaryProvider, fallbackProviderInstance, {
  shouldFallback: (err) => {
    // Fall back on rate limits, but let auth errors propagate
    return (err as { status?: number })?.status === 429;
  },
  onFallback: (err) => console.warn('primary failed, falling back:', err),
});
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `shouldFallback` | `(error) => boolean` | every error except AbortError | Fallback predicate |
| `onFallback` | `(error) => void` | — | Hook fired before calling the fallback |

### fallbackProvider — N-way chains

For more than two providers, `fallbackProvider(p1, p2, p3, ...)` chains them in order — sugar over nested `withFallback`. The first success wins; if all fail, the last error throws. Pass an options object first to set `shouldFallback`/`onFallback`/`name` for the whole chain.

```typescript
import { fallbackProvider } from 'agentfootprint/resilience';
import { anthropic, openai, mock } from 'agentfootprint/llm-providers';

const provider = fallbackProvider(
  anthropic({ apiKey: A }),
  openai({ apiKey: O }),
  mock({ replies: [{ content: '[degraded] all upstream providers failed' }] }),
);
```

---

## withCircuitBreaker

> **Like:** an electrical breaker — after too many failures, the circuit "opens" and all requests fast-fail until reset time. Stops you from hammering a downed service.

Background: the *Circuit Breaker* pattern was popularized by Martin Fowler (2014) and implemented widely by Hystrix and Resilience4j; this is the same pattern applied to `LLMProvider` calls.

Tracks consecutive failures. After reaching the threshold, the circuit opens and all calls fail immediately (fast-fail) by throwing `CircuitOpenError` — until the cooldown elapses, when one probe call is allowed.

```typescript
import { withCircuitBreaker } from 'agentfootprint/resilience';

const guarded = withCircuitBreaker(provider, {
  failureThreshold: 5,    // consecutive failures before opening (default: 5)
  cooldownMs: 30_000,     // time OPEN before probing (default: 30000)
});

const agent = Agent.create({ provider: guarded, model: 'mock' }).build();
const result = await agent.run({ message: 'Hello' });
```

> **Scope: per-instance, NOT distributed.** Each `withCircuitBreaker(...)` call holds its own breaker state in process memory — one server replica can be CLOSED while another is OPEN. For cluster-wide coordination, layer a shared counter on top via the `onStateChange` hook + `shouldCount` predicate.

### Circuit States

```
CLOSED ──(failure count >= failureThreshold)──→ OPEN
                                                  │
                                       (cooldownMs elapsed)
                                                  │
                                                  ▼
                                              HALF-OPEN
                                             /         \
                                      (success)     (failure)
                                         │              │
                                         ▼              ▼
                                      CLOSED          OPEN
```

| State | Behavior |
|-------|----------|
| `closed` | Normal operation. Counting consecutive failures. |
| `open` | Fast-fail. All calls throw `CircuitOpenError` immediately. |
| `half-open` | Probe calls allowed. `halfOpenSuccessThreshold` successes (default 2) close it. Any failure reopens. |

`CircuitOpenError` carries the root-cause `cause` (the error that tripped the breaker) and a `retryAfter` timestamp (when the breaker may next probe).

### Observing State Transitions

There is no `.breaker` property on the wrapped provider — state is observed via the `onStateChange` hook, which fires on every transition:

```typescript
const guarded = withCircuitBreaker(provider, {
  failureThreshold: 3,
  onStateChange: (state, reason) => {
    // state: 'closed' | 'open' | 'half-open'
    console.log(`breaker → ${state} (${reason})`);
  },
});
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `failureThreshold` | `number` | `5` | Consecutive failures before opening |
| `cooldownMs` | `number` | `30000` | Ms OPEN before a half-open probe |
| `halfOpenSuccessThreshold` | `number` | `2` | Probe successes needed to fully close |
| `shouldCount` | `(error) => boolean` | every error except AbortError | Does this error count toward the threshold? |
| `onStateChange` | `(state, reason) => void` | — | Hook fired on every state transition |

---

## Composing Wrappers

All wrappers return `LLMProvider`, so they compose naturally. The canonical production stack puts a circuit breaker on *each* provider, then chains them with fallback:

```typescript
import { anthropic, openai } from 'agentfootprint/llm-providers';
import { withFallback, withCircuitBreaker } from 'agentfootprint/resilience';

// Each provider gets its own breaker; fallback routes around an open one.
const provider = withFallback(
  withCircuitBreaker(anthropic({ apiKey: A }), { failureThreshold: 5, cooldownMs: 30_000 }),
  withCircuitBreaker(openai({ apiKey: O })),
);

const agent = Agent.create({ provider, model: 'claude-sonnet-4-5' }).build();
const result = await agent.run({ message: 'Hello' });
```

Why this order? When Anthropic 503s for the 5th time, its breaker OPENS and `complete()` throws `CircuitOpenError` immediately (no network round-trip), which `withFallback` catches and routes to OpenAI. Without the breaker, every request still burns `withRetry`'s backoff before failing over.

You can also wrap the whole chain in `withRetry`:

```typescript
import { withRetry, withFallback } from 'agentfootprint/resilience';

const provider = withRetry(
  withFallback(anthropic({ apiKey: A }), openai({ apiKey: O })),
  { maxAttempts: 2, initialDelayMs: 500 },
);
```

> **⚠ Stacking order matters.** Put `withCircuitBreaker` *closest to the provider* (inside `withFallback`), not wrapping `withRetry` — so a single logical "request" maps to one breaker tick and the breaker can route the next call to the fallback.

### In an Agent

Every wrapper feeds the same place — `Agent.create({ provider })`. The agent (and its tool loop, output schema, streaming, etc.) is unchanged; only the provider is hardened:

```typescript
import { Agent } from 'agentfootprint';
import { withRetry } from 'agentfootprint/resilience';

const agent = Agent.create({
  provider: withRetry(anthropic({ apiKey }), { maxAttempts: 2 }),
  model: 'claude-sonnet-4-5',
})
  .system('Research the topic and summarize.')
  .build();
```

### In a Swarm

The same wrapped provider flows into each specialist agent before it becomes a `swarm` member. Wrap the provider, build the agent, then list it in `swarm({ agents, route })`:

```typescript
import { Agent } from 'agentfootprint';
import { swarm } from 'agentfootprint';
import { withCircuitBreaker } from 'agentfootprint/resilience';

const guardedProvider = withCircuitBreaker(anthropic({ apiKey }), { failureThreshold: 3 });

const researcher = Agent.create({ provider: guardedProvider, model: 'mock' })
  .system('Research topics.')
  .build();
const writer = Agent.create({ provider: guardedProvider, model: 'mock' })
  .system('Write the report.')
  .build();

const team = swarm({
  agents: [
    { id: 'research', runner: researcher },
    { id: 'write', runner: writer },
  ],
  route: ({ message }) => (message.includes('write') ? 'write' : 'research'),
});
```

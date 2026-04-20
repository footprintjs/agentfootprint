# Orchestration

Orchestration wrappers add reliability to any `RunnerLike`. They compose naturally — stack them for production-grade resilience.

All three wrappers return `RunnerLike`, so the wrapped runner is interchangeable with the original.

---

## withRetry

Retries on failure with configurable backoff. Respects AbortSignal during wait periods.

```typescript
import { withRetry } from 'agentfootprint';

const reliable = withRetry(agent, {
  maxRetries: 3,          // attempts after initial (default: 3)
  backoffMs: 1000,        // initial delay between retries (default: 0)
  backoffMultiplier: 2,   // multiply delay after each retry (default: 1)
});

const result = await reliable.run('Hello');
// Attempts: 1st try → wait 1s → 2nd try → wait 2s → 3rd try → wait 4s → 4th try
```

### Selective Retry

Only retry on specific errors:

```typescript
import { withRetry, LLMError } from 'agentfootprint';

const reliable = withRetry(agent, {
  maxRetries: 3,
  backoffMs: 500,
  shouldRetry: (err) => {
    if (err instanceof LLMError) return err.retryable;
    return false;
  },
});
```

| `LLMError.code` | `retryable` |
|-----------------|-------------|
| `rate_limit` | true |
| `server` | true |
| `timeout` | true |
| `network` | true |
| `auth` | false |
| `context_length` | false |
| `invalid_request` | false |
| `aborted` | false |
| `unknown` | false |

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxRetries` | `number` | `3` | Retries after initial attempt |
| `backoffMs` | `number` | `0` | Initial delay (ms) |
| `backoffMultiplier` | `number` | `1` | Multiply delay each retry |
| `shouldRetry` | `(error) => boolean` | `() => true` | Retry predicate |

---

## withFallback

If the primary runner throws, the fallback runner handles the request.

```typescript
import { withFallback } from 'agentfootprint';

// Expensive model → cheap model on failure
const resilient = withFallback(expensiveAgent, cheapAgent);
const result = await resilient.run('Hello');
```

### Selective Fallback

Only fall back on specific errors:

```typescript
import { withFallback, LLMError } from 'agentfootprint';

const resilient = withFallback(primaryAgent, fallbackAgent, {
  shouldFallback: (err) => {
    // Fall back on rate limits, but let auth errors propagate
    return err instanceof LLMError && err.code === 'rate_limit';
  },
});
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `shouldFallback` | `(error) => boolean` | `() => true` | Fallback predicate |

---

## withCircuitBreaker

> **Like:** an electrical breaker — after too many failures, the circuit "opens" and all requests fast-fail until reset time. Stops you from hammering a downed service.

Background: the *Circuit Breaker* pattern was popularized by Martin Fowler (2014) and implemented widely by Hystrix and Resilience4j; this is the same pattern applied to `LLMProvider` calls.

Tracks consecutive failures. After reaching the threshold, the circuit opens and all calls fail immediately (fast-fail) until the reset timeout elapses.

```typescript
import { withCircuitBreaker } from 'agentfootprint';

const guarded = withCircuitBreaker(agent, {
  threshold: 5,           // failures before opening (default: 5)
  resetAfterMs: 30_000,   // time before probe attempt (default: 30000)
});

const result = await guarded.run('Hello');
```

### Circuit States

```
CLOSED ──(failure count >= threshold)──→ OPEN
                                           │
                                  (resetAfterMs elapsed)
                                           │
                                           ▼
                                       HALF_OPEN
                                      /         \
                               (success)     (failure)
                                  │              │
                                  ▼              ▼
                               CLOSED          OPEN
```

| State | Behavior |
|-------|----------|
| `closed` | Normal operation. Counting consecutive failures. |
| `open` | Fast-fail. All calls throw `Error('Circuit breaker is open')` immediately. |
| `half_open` | One probe call allowed. Success resets to closed. Failure reopens. |

### Accessing the Breaker

```typescript
const guarded = withCircuitBreaker(agent, { threshold: 3 });

// The breaker is exposed for inspection
guarded.breaker.getState(); // 'closed' | 'open' | 'half_open'
guarded.breaker.reset();    // Force reset to closed
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `threshold` | `number` | `5` | Consecutive failures before opening |
| `resetAfterMs` | `number` | `30000` | Ms before half-open probe |

---

## Composing Wrappers

All wrappers return `RunnerLike`, so they compose naturally:

```typescript
import { withRetry, withFallback, withCircuitBreaker } from 'agentfootprint';

// Stack: circuit breaker → retry → fallback
const production = withCircuitBreaker(
  withRetry(
    withFallback(primaryAgent, fallbackAgent),
    { maxRetries: 2, backoffMs: 500 },
  ),
  { threshold: 3, resetAfterMs: 60_000 },
);

const result = await production.run('Hello');
```

**Evaluation order (inside out):**
1. `withFallback` — if primary fails, try fallback
2. `withRetry` — retry the fallback-wrapped runner up to 2 times
3. `withCircuitBreaker` — if 3 consecutive runs fail, fast-fail for 60s

> **⚠ Stacking order matters.** The outer wrapper sees errors only AFTER inner wrappers have had their chance. Common mistake: putting `withCircuitBreaker` *inside* `withRetry` — every retry counts as a separate breaker probe, so the breaker never trips. Put `withCircuitBreaker` outside `withRetry` if you want one logical "request" per breaker tick.

### In FlowChart

```typescript
import { FlowChart, withRetry, withFallback } from 'agentfootprint';

const reliableResearcher = withRetry(researchAgent, { maxRetries: 2 });
const resilientWriter = withFallback(expensiveWriter, cheapWriter);

const pipeline = FlowChart.create()
  .agent('research', 'Research', reliableResearcher)
  .agent('write', 'Write', resilientWriter)
  .build();
```

### In Swarm

```typescript
import { Swarm, withCircuitBreaker } from 'agentfootprint';

const guardedResearcher = withCircuitBreaker(researchRunner, { threshold: 3 });

const swarm = Swarm.create({ provider })
  .system('Delegate to specialists.')
  .specialist('research', 'Research topics.', guardedResearcher)
  .build();
```

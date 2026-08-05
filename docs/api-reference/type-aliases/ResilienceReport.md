[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ResilienceReport

# Type Alias: ResilienceReport

> **ResilienceReport** = \{ `fallback`: `string`; `kind`: `"fell-back"`; `primary`: `string`; `reason`: `string`; \} \| \{ `attempt`: `number`; `backoffMs`: `number`; `kind`: `"retried"`; `lastError`: `string`; `maxAttempts`: `number`; `reason`: `string`; \} \| \{ `attempt`: `number`; `kind`: `"recovered"`; `totalDurationMs`: `number`; \}

Defined in: [src/adapters/types.ts:294](https://github.com/footprintjs/agentfootprint/blob/a7bc648325994ed8e4f49f22420056b84917c151/src/adapters/types.ts#L294)

v7.8 — what a resilience decorator DID during one provider call.

Plain data only (strings + numbers), so a report drops straight into a
typed event payload and survives `structuredClone`. Field names are
deliberately 1:1 with the declared event payloads
(`FallbackTriggeredPayload`, `ErrorRetriedPayload`,
`ErrorRecoveredPayload`) so the in-run call site maps a report to an
event without renaming or synthesizing anything.

Produced by exactly one decorator per `kind`:
  • `'fell-back'` ← `withFallback`
  • `'retried'` / `'recovered'` ← `withRetry`
  • nothing ← `withCircuitBreaker` (no declared event for a breaker
    transition; a trip is visible via the enclosing fallback's `reason`)

## Union Members

### Type Literal

\{ `fallback`: `string`; `kind`: `"fell-back"`; `primary`: `string`; `reason`: `string`; \}

#### fallback

> `readonly` **fallback**: `string`

Provider called instead — the one that actually served.

#### kind

> `readonly` **kind**: `"fell-back"`

#### primary

> `readonly` **primary**: `string`

Provider tried first, which failed.

#### reason

> `readonly` **reason**: `string`

Message of the error that triggered the fallback.

***

### Type Literal

\{ `attempt`: `number`; `backoffMs`: `number`; `kind`: `"retried"`; `lastError`: `string`; `maxAttempts`: `number`; `reason`: `string`; \}

#### attempt

> `readonly` **attempt**: `number`

1-based number of the attempt ABOUT TO START (2 = first retry).

#### backoffMs

> `readonly` **backoffMs**: `number`

#### kind

> `readonly` **kind**: `"retried"`

#### lastError

> `readonly` **lastError**: `string`

Message of the error that caused this retry.

#### maxAttempts

> `readonly` **maxAttempts**: `number`

#### reason

> `readonly` **reason**: `string`

Classification OF THE ERROR — **not** of the predicate's
reasoning. `shouldRetry` returns a bare boolean, so when a custom
predicate is in force the decorator cannot know *why* it said yes;
this field reports what the error looked like instead, derived
from the same `status`/`statusCode` fields `defaultShouldRetry`
inspects. One of: `'http-429'` | `'http-5xx'` | `'http-4xx'` |
`` `http-${code}` `` | `'no-status'`.

***

### Type Literal

\{ `attempt`: `number`; `kind`: `"recovered"`; `totalDurationMs`: `number`; \}

#### attempt

> `readonly` **attempt**: `number`

1-based attempt that finally succeeded. Always >= 2.

#### kind

> `readonly` **kind**: `"recovered"`

#### totalDurationMs

> `readonly` **totalDurationMs**: `number`

[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ResilienceReport

# Type Alias: ResilienceReport

> **ResilienceReport** = \{ `fallback`: `string`; `kind`: `"fell-back"`; `primary`: `string`; `reason`: `string`; \} \| \{ `attempt`: `number`; `backoffMs`: `number`; `kind`: `"retried"`; `lastError`: `string`; `maxAttempts`: `number`; `reason`: `string`; \} \| \{ `attempt`: `number`; `kind`: `"recovered"`; `totalDurationMs`: `number`; \} \| \{ `kind`: `"circuit-changed"`; `providerName`: `string`; `reason`: `string`; `state`: `"closed"` \| `"open"` \| `"half-open"`; \}

Defined in: [src/adapters/types.ts:342](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/adapters/types.ts#L342)

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
  • `'circuit-changed'` ← `withCircuitBreaker` (9.32.0)

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

***

### Type Literal

\{ `kind`: `"circuit-changed"`; `providerName`: `string`; `reason`: `string`; `state`: `"closed"` \| `"open"` \| `"half-open"`; \}

#### kind

> `readonly` **kind**: `"circuit-changed"`

v9.32 — the breaker moved between `closed` / `open` / `half-open`.

Until this arm existed `withCircuitBreaker` reported NOTHING through
the in-run channel: `onStateChange` was the only way to see a trip,
and that hook fires at consumer level where the run ids are
synthetic. An independent reviewer (2026-08-13, on a local harness of
scripted failures) watched a breaker open after two failures, serve
from fallback, half-open after cooldown and close after two probes —
all correct, and all invisible
to the typed stream. So the same trip is now on the record with the
run's real correlation ids, because every transition happens INSIDE a
call and there is nothing to synthesize.

`onStateChange` is unchanged and still fires beside this: it is the
consumer's own hook, and a Redis-backed counter built on it must not
start depending on whether a run happened to be in flight.

#### providerName

> `readonly` **providerName**: `string`

WHICH provider this breaker wraps. A stack of breakers under one
 fallback produces one stream, and this is what tells them apart.

#### reason

> `readonly` **reason**: `string`

WHY, in the breaker's own words (`'3 consecutive failures'`,
 `'cooldown elapsed'`, `'half-open probe failed'`). Never an error's
 message — the failure that tripped it is reported by whoever threw.

#### state

> `readonly` **state**: `"closed"` \| `"open"` \| `"half-open"`

The state entered. Transitions only — a no-op re-entry never reports.

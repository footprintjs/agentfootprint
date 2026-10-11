**Support** — four composable decorators over `LLMProvider` (retry, fallback,
fallback chain, circuit breaker), each preserving the port so they stack freely.

## What it reads / what it writes
- Reads the request as composed, and the provider's failure.
- Writes nothing on scope and never mutates the caller's request. A fallback
  swaps WHO answers, never WHAT was asked. A leaf-approved thinking omission
  is retained for later attempts of that call, as described below.

## The one law here
The port survives every wrapper. A decorator that changed the request would be
composing, and composing belongs to a Lens. Remembering a retirement the leaf
already approved is not permission to compose or choose new omissions.

## A failed attempt cannot resurrect retired thinking
`replayAttempt.ts` owns one per-call request carrier for retry and fallback.
It observes the actual leaf's `onReplayPrepared`, applies only reported
retirements through `retireReplayHistory`, and forwards that same report once.
It commits its local carrier only after the upstream callback succeeds; a failed
durable write cannot be bypassed by an omission-free subsequent attempt.
The next attempt reads the carrier, even if the previous transport failed
after preparation. Nested decorators carry the same approved decision outward;
they never prepare an unused fallback or decide an omission themselves.

The caller's request stays untouched. Without a retirement every attempt gets
the original request object. With one, only the affected message fields change;
leaf-local model resolution and cache adjustments are not copied into the next
provider's request. Complete and pre-first-chunk streaming retries use the same
carrier. A new call starts fresh; post-first-chunk failures still never retry.

## Declarations pass through; a pair answers for both
A decorator rebuilds the provider object, so it carries every declaration
across: `carriesInMessages`, `carriesForcedToolChoice`, `supportsForcedToolChoice`, `promptCaching`,
`thinkingHandler`, `thinkingMode`. Dropping one degrades it silently (no cache
markers, no thinking stage, no build-time thinking refusal). `withFallback`
combines what both sides declare — for `thinkingMode`, the LEAST either side
promises for the model (`'none'` < `'adaptive'` < `'budget'`), so a fallback
that cannot think is refused at build, not on the call it serves. It never maps
thinking itself: each side's adapter sends its own model's shape. A request an
adapter refused BEFORE sending (`UnsupportedThinkingError`, `UnsupportedToolChoiceError`
or `UnsafeThinkingReplayError`) is a wrong request,
not a failed vendor: by default `withFallback` does not move it to the other
side and `withCircuitBreaker` does not count it.

```ts
const pair = withFallback(anthropic({ defaultModel: 'claude-opus-5-5' }), anthropic());
pair.thinkingMode?.('anthropic'); // 'adaptive' — Opus 5.5 takes no budget
```

For forced tools, the existing boolean wire flag is still the first gate.
`forcedToolChoiceFor(provider, model)` additionally reads the optional model
predicate. `withFallback` requires both sides to accept the model; it does not
turn an explicitly forced request into a prompt-only request.

## The stream law: retry before the first chunk, never after
`withRetry` re-opens a `stream()` that fails before its first chunk (a 429 or
5xx at connect) under the SAME policy as `complete()` — `maxAttempts`,
`shouldRetry`, backoff, `req.signal` — and reports it the same way
(`retried`, then `recovered` when the first chunk arrives). After the first
chunk nothing retries: `withRetry.ts · openStream` owns the only retry loop and
returns WITH the first chunk; the rest is `yield*` delegation with no catch.
`withFallback` pins a stream at the same boundary.

```ts
const robust = withRetry(anthropic({ apiKey }), { maxAttempts: 3 });
for await (const chunk of robust.stream!(req, hooks)) {
  // 429 at connect → retried, then these chunks arrive once each.
  // A reset after the first chunk → thrown here, never replayed.
}
```

## Retry reads what the error declares
`withRetry`'s default predicate (`withRetry.ts` · `defaultShouldRetry`, shared
with `withCredentialRetry`) skips an `AbortError`, a 4xx other than 429, and an
error that declares `retryable: false`; it retries everything else, including an
error with no status. An adapter whose failure has no HTTP status and cannot be
mended by asking again — nothing was sent, or a 2xx already came back — sets
`retryable: false`, or the default policy repeats it. Only the literal `false` is
read, so an error without the field is judged exactly as before.

```ts
class NoKeyError extends Error {
  readonly retryable = false; // nothing was sent; a retry cannot find a key
}
withRetry(provider); // a NoKeyError is thrown once, with no backoff wait
```

## A stated wait beats the schedule — and the decorator never parses prose
When a failure says how long to wait, `withRetry` waits max(its own delay, the
stated wait), capped by `maxDelayMs` so a hostile header cannot stall a run;
`req.signal` still ends the wait. The wait is read through ONE helper
(`statedWait.ts` · `statedRetryAfterMs`): the error's `retryAfterMs`, else its
`retryAfterSeconds`. The ADAPTER that knows its wire declares the field — a
`Retry-After` header (`adapters/llm/retryAfter.ts`), or a gateway's "Try again
in N seconds" (`InvokeModelGatewayProvider.ts` · `statedWaitMs`). The report
carries `statedWaitMs` beside `backoffMs`; with no stated wait the report is
byte-identical to the schedule-only one.

```ts
throw Object.assign(new Error('429'), { status: 429, retryAfterMs: 4000 });
// withRetry(provider) waits 4000 ms (not 200), reports
// { kind: 'retried', backoffMs: 4000, statedWaitMs: 4000, … }
```

## Files
- `withRetry.ts`, `withFallback.ts`, `withCircuitBreaker.ts`,
  `fallbackProvider.ts`, `index.ts`.
- `statedWait.ts` — the one reader of a failure's stated wait.
- `replayAttempt.ts` — the per-call carrier for already-approved retirements.
  It also attaches deduplicated, metadata-only omission reports to a successful
  response or terminal chunk, including reports from an earlier prepared
  attempt whose transport failed. It never re-emits a report hook.

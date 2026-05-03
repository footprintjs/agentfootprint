---
title: Reliability — CircuitBreaker + outputFallback + resumeOnError
group: features
---

# `08-reliability.ts` — the v2.10.x Reliability subsystem end-to-end

Three pieces, three failure modes, one example. Run with:

```bash
npm run example -- examples/features/08-reliability.ts
```

## What it demonstrates

| Tier | Primitive | Solves |
|---|---|---|
| 1 | `withCircuitBreaker(provider, { failureThreshold, cooldownMs })` | **Vendor outage detection.** After N consecutive failures, the breaker OPENS and fails fast in <5µs (no network round-trip). `withFallback` then routes to the secondary provider without wasting 3 retries × backoff per request. |
| 2 | `.outputFallback({ fallback, canned })` | **Schema-validation failure.** When the LLM emits malformed JSON, fall through to consumer's `fallback(err, raw)` function, then to the static `canned` safety net. Agent NEVER throws on output failure when canned is set. |
| 3 | `RunCheckpointError` + `agent.resumeOnError(checkpoint)` | **Mid-run failure recovery.** When LLM 503s mid-iteration, the agent throws `RunCheckpointError` carrying a JSON-serializable conversation-history checkpoint. Persist anywhere (Redis/Postgres/S3); restart the process; call `agent.resumeOnError(checkpoint)` to continue from where it failed. |

## Sample output

```
=== Reliability subsystem demo ===

1. CircuitBreaker — vendor outage detection
   primary calls: 2 (capped by breaker)
   fallback calls: 5 (took over after breaker opened)

2. outputFallback — 3-tier degradation on schema failure
   result: {"amount":0,"reason":"unable to process — please retry"}
   canned fired: true

3. resumeOnError — mid-run failure recovery
   failed at: iteration 2 (iteration)
   checkpoint size: 461 bytes (JSON)
   resume result: refund processed: $50 for product defect…

OK — all 3 reliability primitives behaved as documented.
```

## What to copy

The 3 demo functions in this file are isolated — copy any one of them
into your own code. Each has a comment block explaining the failure
mode it covers and the consumer-facing API.

## See also

- [Reliability guide](/agentfootprint/guides/reliability/) — full conceptual treatment of the subsystem
- [withCircuitBreaker source](../../src/resilience/withCircuitBreaker.ts) — JSDoc has the state-machine diagram
- [outputFallback source](../../src/core/outputFallback.ts) — JSDoc has the 3-tier flow
- [runCheckpoint source](../../src/core/runCheckpoint.ts) — JSDoc has the checkpoint shape + tradeoffs

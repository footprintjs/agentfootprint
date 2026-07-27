/**
 * Integration test — runs the resilience-visibility example end-to-end.
 *
 * The example file (`examples/features/35-resilience-visibility.ts`) carries
 * its own regression guards (`mustBe(...)` throws), and the docs site
 * live-imports two of its regions via `<CodeFile>`. So if the example
 * silently breaks, the docs page silently lies. `npm run test:examples` is
 * not part of the CI test job — this test is what actually keeps the file
 * honest, mirroring `test/core/reliability-example.test.ts` for example 08.
 *
 * Scope note: the seam itself is proven by
 * `resilience-decorator-visibility.test.ts` (correlation ids, stacking,
 * hostile sinks, streaming). This file asserts only that the EXAMPLE — the
 * thing a reader copies — still demonstrates what its prose claims.
 */

import { describe, expect, it } from 'vitest';
import { run } from '../../../examples/features/35-resilience-visibility.js';

interface ExampleResult {
  failover: { primary: string; fallback: string; reason: string; stage: string; runId: string }[];
  retryThenRecover: {
    retried: { attempt: number; maxAttempts: number; backoffMs: number; reason: string }[];
    recovered: { attempt: number; totalDurationMs: number }[];
  };
  recordedSequence: string[];
  standalone: { consumerHooks: string[]; ownSink: string[] };
}

describe('resilience-visibility example — integration', () => {
  it('runs end-to-end and still demonstrates every claim on the docs page', async () => {
    const result = (await run('is the service up?')) as ExampleResult;

    // Scene 1 — the failover names BOTH providers, and the meta is real.
    expect(result.failover).toHaveLength(1);
    expect(result.failover[0]!.primary).toBe('acme-llm');
    expect(result.failover[0]!.fallback).toBe('backup-llm');
    // A consumer-level emit would land as `consumer-emit#0` / `consumer-scope`.
    expect(result.failover[0]!.stage).toMatch(/#\d+$/);
    expect(result.failover[0]!.runId).not.toBe('consumer-scope');

    // Scene 2 — two retries then one recovery, with the error classified.
    expect(result.retryThenRecover.retried.map((r) => r.attempt)).toEqual([2, 3]);
    expect(result.retryThenRecover.retried[0]!.reason).toBe('http-5xx');
    expect(result.retryThenRecover.recovered).toHaveLength(1);
    expect(result.retryThenRecover.recovered[0]!.attempt).toBe(3);

    // Scene 3 — the exact sequence the docs page quotes.
    expect(result.recordedSequence).toEqual([
      'fallback.triggered',
      'error.retried',
      'fallback.triggered',
      'error.recovered',
    ]);

    // Scene 4 — standalone: the consumer hooks fire, and a caller may pass
    // its own LLMCallHooks to collect the same reports outside a run.
    expect(result.standalone.consumerHooks.length).toBeGreaterThan(0);
    expect(result.standalone.ownSink.length).toBeGreaterThan(0);
  });
});

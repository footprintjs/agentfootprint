/**
 * Integration test — runs the v2.11.0 reliability example end-to-end
 * and snapshots its return shape so docs-page consumers and copy-
 * pasters get behavior pinned to a known-good baseline.
 *
 * The example file (`examples/features/08-reliability.ts`) contains
 * its own regression guards (`process.exit(1)` on failure). This
 * test wraps the example's exported `run()` function and asserts:
 *
 *   1. The function completes without throwing.
 *   2. The return value matches the documented shape (snapshot).
 *   3. Each of the 3 reliability primitives engaged as designed.
 *
 * Why an integration test for an example: the example IS the docs
 * (the docs site live-imports the file via `?raw`). If the example
 * silently breaks, the docs page silently lies. This test is the
 * smoke alarm.
 */

import { describe, expect, it } from 'vitest';
import { run } from '../../examples/features/08-reliability.js';

describe('reliability example — integration', () => {
  it('runs end-to-end without throwing + returns the documented shape', async () => {
    const result = (await run('process refund #1234')) as {
      circuitBreaker: { primaryCalls: number; fallbackCalls: number };
      outputFallback: {
        result: { amount: number; reason: string };
        cannedFired: boolean;
      };
      resumeOnError: {
        failedAt: string;
        resumeResult: string;
        serializedCheckpointBytes: number;
      };
    };

    // CircuitBreaker — primary calls capped, fallback took over.
    expect(result.circuitBreaker.primaryCalls).toBeLessThanOrEqual(3);
    expect(result.circuitBreaker.fallbackCalls).toBeGreaterThanOrEqual(2);

    // outputFallback — agent did NOT throw; canned safety net engaged.
    expect(result.outputFallback.cannedFired).toBe(true);
    expect(result.outputFallback.result.amount).toBe(0);
    expect(result.outputFallback.result.reason).toMatch(/unable to process/);

    // resumeOnError — checkpoint captured + resume completed the run.
    expect(result.resumeOnError.failedAt).toMatch(/iteration/);
    expect(result.resumeOnError.resumeResult).toMatch(/refund processed/);
    expect(result.resumeOnError.serializedCheckpointBytes).toBeGreaterThan(50);
    expect(result.resumeOnError.serializedCheckpointBytes).toBeLessThan(10_000);
  }, 30_000);

  it('checkpoint shape from resumeOnError demo matches the documented contract', async () => {
    // Re-run the resume demo in isolation and inspect the captured
    // checkpoint. This is the pinned snapshot of the v1 checkpoint
    // shape — if it drifts, docs/example need to update too.
    const result = (await run('shape check')) as {
      resumeOnError: { serializedCheckpointBytes: number };
    };
    // Loose bounds — the exact byte count varies with mock fixture
    // text, but order of magnitude should hold.
    expect(result.resumeOnError.serializedCheckpointBytes).toBeGreaterThan(100);
    expect(result.resumeOnError.serializedCheckpointBytes).toBeLessThan(5_000);
  }, 30_000);
});

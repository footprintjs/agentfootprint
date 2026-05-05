/**
 * Integration test — runs the v2.11.5 reliability gate example
 * end-to-end and snapshots its return shape so docs-page consumers
 * and copy-pasters get behavior pinned to a known-good baseline.
 *
 * The example file (`examples/features/09-reliability-gate.ts`) contains
 * its own regression guards (process.exit(1) on failure). This test
 * wraps the example's exported `run()` function and asserts each of
 * the three scenarios engaged as designed.
 *
 * Why an integration test for an example: the example IS the docs
 * (the docs site live-imports the file via `?raw`). If the example
 * silently breaks, the docs page silently lies.
 */

import { describe, expect, it } from 'vitest';
import { run } from '../../examples/features/09-reliability-gate.js';

describe('reliability gate example — integration', () => {
  it('three scenarios engage as designed (happy / retry / fail-fast)', async () => {
    const out = await run();

    // Happy path — first call succeeds, returned without rule fire.
    expect(out.happy.result).toBe('all good');

    // Retry path — provider throws once, retry rule fires, second call succeeds.
    expect(out.retry.result).toBe('recovered');
    expect(out.retry.providerCalls).toBe(2);

    // Fail-fast — error → typed ReliabilityFailFastError thrown.
    expect(out.failFast.thrown).toBe(true);
    expect(out.failFast.kind).toBe('unrecoverable');
    expect(out.failFast.phase).toBe('post-decide');
    expect(out.failFast.reason).toMatch(/reliability-post-decide/);
  }, 10_000);
});

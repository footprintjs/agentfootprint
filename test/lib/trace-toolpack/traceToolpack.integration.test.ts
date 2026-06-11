/**
 * Integration test — the trace-debug-session example end-to-end
 * (Convention 2: the example IS the integration-test layer).
 *
 * Runs the buggy loan pipeline + the scripted debugger session from
 * examples/observability/01-trace-debug-session.ts and pins:
 *
 *   1. The planted bug manifests (the run wrongly approves).
 *   2. The session identifies the culprit step from artifacts alone.
 *   3. The transcript carries the load-bearing evidence: the control-edge
 *      rule label, the read→write chain, and the ⚠ honesty marker.
 *   4. THE headline: chars served ≪ full trace dump.
 */

import { describe, expect, it } from 'vitest';

import { run } from '../../../examples/observability/01-trace-debug-session.js';

describe('trace debug session example — integration', () => {
  it('finds the planted culprit from completed-run artifacts, token-cheaply', async () => {
    const result = await run();

    // The bug manifested: the unaffordable application was approved.
    expect(result.decision).toBe('approve');

    // The scripted session named the planted culprit.
    expect(result.culprit).toBe('normalize#1');
    expect(result.transcript).toContain('Culprit: normalize#1');

    // The causal slice carried the decision evidence end-to-end.
    expect(result.transcript).toContain('[control: Prime credit within affordability policy]');
    expect(result.transcript).toContain('← via dti');
    // A2 honesty marker on the args-consuming intake step.
    expect(result.transcript).toContain('⚠ also consumed args');
    // The bulky payload arrived bounded, with its true size + fetch hint.
    expect(result.transcript).toMatch(/chars total — get_value\('intake#0', 'bureauReport'\)/);

    // THE headline ratio: the session served a fraction of the dump.
    expect(result.toolCalls).toBeGreaterThanOrEqual(5);
    expect(result.charsServed).toBeGreaterThan(0);
    expect(result.dumpChars).toBeGreaterThan(result.charsServed);
    expect(result.ratio).toBeLessThan(0.3);
  });
});

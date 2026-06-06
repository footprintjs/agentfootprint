/**
 * Payloads namespace — verifies event payload shapes are grouped under the
 * `Payloads` namespace (5.0.0) instead of flooding the top-level barrel, and
 * that a known shape is reachable as `Payloads.<Name>` (type-level usage —
 * compiled by the build's tsc pass).
 */
import { describe, expect, it } from 'vitest';

import type { Payloads } from '../../src/index.js';
import * as af from '../../src/index.js';

describe('Payloads namespace', () => {
  it('payload shapes are NOT flat on the main barrel anymore', () => {
    // The ~60 *Payload names used to be top-level; now namespaced.
    expect((af as Record<string, unknown>).AgentRouteDecidedPayload).toBeUndefined();
    expect((af as Record<string, unknown>).StreamLLMStartPayload).toBeUndefined();
  });

  it('a payload shape is reachable via the Payloads namespace (type-level)', () => {
    // Type-level usage — if `Payloads.AgentIterationEndPayload` did not resolve,
    // the build's tsc pass would fail. Runtime value is irrelevant (type-only).
    const sample = { turnIndex: 0, iterIndex: 0, toolCallCount: 0 } as Payloads.AgentIterationEndPayload;
    expect(sample).toBeTruthy();
  });
});

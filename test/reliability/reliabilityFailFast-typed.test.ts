/**
 * reliabilityFailFast-typed.test.ts
 *
 * Task 1 of the scope↔emit cleanup: the rules-based loop's fail-fast path
 * used to write its structured context through an UNSAFE cast
 * (`scope as unknown as Record<string, unknown>`). It now writes through
 * the live `TypedScope<AgentState>` using the typed `reliabilityFail*`
 * fields. These tests pin the OBSERVABLE contract that typing must
 * preserve — the fields land in the snapshot and reconstruct into a typed
 * `ReliabilityFailFastError` at the API boundary, byte-for-byte as before.
 *
 * 7-pattern coverage for this task:
 *   • Unit        — failFast writes each typed field into scope (snapshot).
 *   • Functional  — a fail-fast run throws ReliabilityFailFastError.
 *   • Integration — kind/reason/payload/cause all round-trip through the
 *                   snapshot into the thrown error.
 *   • Property    — arbitrary kind/label/phase values round-trip faithfully.
 *   • Security    — the cause crosses the boundary as a PLAIN Error
 *                   (message+name only); no original Error instance / stack
 *                   leaks through scope (structuredClone safety).
 *   • Performance — N/A: typing is a compile-time change; zero added runtime
 *                   work vs the prior cast (no new allocations on the hot path).
 *   • Load        — N/A: fail-fast is a terminal, once-per-run path; the
 *                   176 existing reliability tests already exercise volume.
 */

import { describe, it, expect } from 'vitest';
import { Agent } from '../../src/core/Agent.js';
import { ReliabilityFailFastError } from '../../src/reliability/types.js';

/** Provider whose complete() always throws — drives the loop to fail-fast. */
function failingProvider(message: string) {
  return {
    name: 'failing',
    async complete(): Promise<never> {
      throw new Error(message);
    },
  };
}

function failFastAgent(opts: {
  kind: string;
  label?: string;
  phase?: 'pre-check' | 'post-decide';
  causeMessage?: string;
}) {
  const phase = opts.phase ?? 'post-decide';
  const causeMessage = opts.causeMessage ?? 'upstream 500';
  const rule = {
    when: () => true,
    then: 'fail-fast' as const,
    kind: opts.kind,
    ...(opts.label !== undefined && { label: opts.label }),
  };
  return Agent.create({ provider: failingProvider(causeMessage) as never, model: 'm' })
    .reliability(phase === 'pre-check' ? { preCheck: [rule] } : { postDecide: [rule] })
    .build();
}

describe('Task 1 — typed reliabilityFail* fields', () => {
  // ── Functional ───────────────────────────────────────────────────
  it('functional: a fail-fast run rejects with ReliabilityFailFastError', async () => {
    const agent = failFastAgent({ kind: 'upstream-error', label: 'Upstream failed' });
    await expect(agent.run({ message: 'hi' })).rejects.toBeInstanceOf(ReliabilityFailFastError);
  });

  // ── Unit — the typed fields are written into scope (snapshot) ─────
  it('unit: typed reliabilityFail* fields land in the snapshot sharedState', async () => {
    const agent = failFastAgent({ kind: 'k-unit', label: 'L-unit', causeMessage: 'boom-unit' });
    await agent.run({ message: 'hi' }).catch(() => undefined);

    const shared = (agent.getSnapshot()?.sharedState ?? {}) as Record<string, unknown>;
    expect(shared.reliabilityFailKind).toBe('k-unit');
    // Structural, not exact-format — the `reliability-<phase>: <label>` string
    // is an internal convention; the property test below pins the format once.
    expect(shared.reliabilityFailReason).toContain('post-decide');
    expect(shared.reliabilityFailReason).toContain('L-unit');
    expect(shared.reliabilityFailCauseMessage).toBe('boom-unit');
    expect(shared.reliabilityFailCauseName).toBe('Error');
    const payload = shared.reliabilityFailPayload as {
      phase: string;
      attempt: number;
      providerUsed: string;
      errorKind?: string;
      errorMessage?: string;
    };
    expect(payload.phase).toBe('post-decide');
    expect(payload.providerUsed).toBe('failing');
    expect(typeof payload.attempt).toBe('number');
    expect(payload.errorMessage).toBe('boom-unit');
    // errorKind presence pinned (the exact classifyError tag is internal).
    expect(typeof payload.errorKind).toBe('string');
  });

  // ── Integration — fields reconstruct into the thrown typed error ──
  it('integration: kind/reason/payload/cause round-trip into the thrown error', async () => {
    const agent = failFastAgent({ kind: 'k-int', label: 'L-int', causeMessage: 'boom-int' });
    const err = await agent.run({ message: 'hi' }).catch((e) => e);

    expect(err).toBeInstanceOf(ReliabilityFailFastError);
    const e = err as ReliabilityFailFastError;
    expect(e.kind).toBe('k-int');
    expect(e.reason).toContain('post-decide');
    expect(e.reason).toContain('L-int');
    expect(e.payload?.providerUsed).toBe('failing');
    expect(e.payload?.phase).toBe('post-decide');
    expect(e.cause).toBeInstanceOf(Error);
    expect((e.cause as Error).message).toBe('boom-int');
  });

  // ── Integration — pre-check path: distinct reason + NO cause ──────
  it('integration: pre-check fail-fast has the pre-check reason and no cause', async () => {
    // preCheck fires BEFORE any provider call, so lastError is undefined →
    // the optional cause fields legitimately stay unwritten. This is the one
    // branch where reliabilityFailCause* remain undefined.
    const agent = failFastAgent({ kind: 'budget', label: 'Over budget', phase: 'pre-check' });
    const err = await agent.run({ message: 'hi' }).catch((e) => e);

    expect(err).toBeInstanceOf(ReliabilityFailFastError);
    const e = err as ReliabilityFailFastError;
    expect(e.kind).toBe('budget');
    expect(e.reason).toContain('pre-check');
    expect(e.reason).toContain('Over budget');
    expect(e.payload?.phase).toBe('pre-check');
    expect(e.cause).toBeUndefined();

    const shared = (agent.getSnapshot()?.sharedState ?? {}) as Record<string, unknown>;
    expect(shared.reliabilityFailCauseMessage).toBeUndefined();
    expect(shared.reliabilityFailCauseName).toBeUndefined();
  });

  // ── Property — arbitrary kind/label round-trip faithfully ─────────
  it('property: arbitrary kind/label values survive the scope→error round-trip', async () => {
    const cases = [
      { kind: 'a', label: 'Alpha' },
      { kind: 'rate-limit', label: 'Too many requests' },
      { kind: 'x_9-Z', label: 'Mixed 123 !@#' },
      { kind: 'no-label-kind' }, // label omitted → reason falls back to kind
    ];
    for (const c of cases) {
      const agent = failFastAgent({
        kind: c.kind,
        ...(c.label !== undefined && { label: c.label }),
      });
      const e = (await agent.run({ message: 'hi' }).catch((x) => x)) as ReliabilityFailFastError;
      expect(e).toBeInstanceOf(ReliabilityFailFastError);
      expect(e.kind).toBe(c.kind);
      expect(e.reason).toBe(`reliability-post-decide: ${c.label ?? c.kind}`);
    }
  });

  // ── Security — cause is a plain Error, no instance/stack leak ─────
  it('security: cause crosses the boundary as a fresh plain Error (message+name only)', async () => {
    const original = new Error('sensitive-internal-detail');
    original.name = 'UpstreamError';
    // attach a field that must NOT survive (proves we only carry message+name)
    (original as unknown as { secret: string }).secret = 'do-not-leak';
    const provider = {
      name: 'failing',
      async complete(): Promise<never> {
        throw original;
      },
    };
    const agent = Agent.create({ provider: provider as never, model: 'm' })
      .reliability({ postDecide: [{ when: () => true, then: 'fail-fast', kind: 'sec' }] })
      .build();

    const e = (await agent.run({ message: 'hi' }).catch((x) => x)) as ReliabilityFailFastError;
    expect(e.cause).toBeInstanceOf(Error);
    expect(e.cause).not.toBe(original); // reconstructed, not the same instance
    expect((e.cause as Error).message).toBe('sensitive-internal-detail');
    expect((e.cause as Error).name).toBe('UpstreamError');
    // the non-standard field did NOT ride along through scope
    expect((e.cause as unknown as { secret?: string }).secret).toBeUndefined();
  });
});

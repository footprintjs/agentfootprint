/**
 * outputFallback — 7-pattern tests.
 *
 *   P1 Unit         — primary path returns LLM value when valid
 *   P2 Boundary     — invalid output triggers fallback (tier 2)
 *   P3 Scenario     — fallback throws → canned (tier 3) takes over
 *   P4 Property     — agent NEVER throws when canned is set (fail-open guarantee)
 *   P5 Security     — canned validated against schema at builder time (fail-fast)
 *   P6 Performance  — happy path (no fallback engaged) has zero overhead
 *   P7 ROI          — typed events fire on tier transitions (observability)
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Agent } from '../../src/core/Agent.js';
import { mock } from '../../src/adapters/llm/MockProvider.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';

// ── Test helper: build an agent with given LLM reply ─────────────────

const Refund = z.object({
  amount: z.number().nonnegative(),
  reason: z.string().min(1),
});
type Refund = z.infer<typeof Refund>;

function makeAgent(
  llmReply: string,
  opts?: { fallback?: Parameters<typeof Refund.parse>[0] | (() => Refund); canned?: Refund },
) {
  const builder = Agent.create({
    provider: mock({ replies: [{ content: llmReply }] }),
    model: 'mock',
  })
    .system('You decide refund amounts.')
    .outputSchema(Refund);

  if (opts?.fallback || opts?.canned !== undefined) {
    builder.outputFallback({
      fallback:
        typeof opts.fallback === 'function'
          ? (opts.fallback as () => Refund)
          : () => opts.fallback as Refund,
      ...(opts.canned !== undefined && { canned: opts.canned }),
    });
  }

  return builder.build();
}

// ─── P1 Unit ─────────────────────────────────────────────────────────

describe('outputFallback — P1 unit', () => {
  it('P1 primary path returns LLM value when output validates', async () => {
    const valid: Refund = { amount: 50, reason: 'product defect' };
    const agent = makeAgent(JSON.stringify(valid), {
      fallback: () => ({ amount: 0, reason: 'not used' }),
      canned: { amount: 0, reason: 'not used' },
    });
    const result = await agent.runTyped<Refund>({ message: 'refund my purchase' });
    expect(result).toEqual(valid);
  });
});

// ─── P2 Boundary — fallback engages on invalid output ────────────────

describe('outputFallback — P2 boundary', () => {
  it('P2 invalid LLM output → fallback runs and supplies value', async () => {
    let fallbackRan = false;
    const agent = makeAgent('this is prose, not JSON', {
      fallback: () => {
        fallbackRan = true;
        return { amount: 0, reason: 'manual review (LLM emitted prose)' };
      },
    });
    const result = await agent.runTyped<Refund>({ message: '...' });
    expect(fallbackRan).toBe(true);
    expect(result.reason).toMatch(/manual review/);
  });

  it('P2 fallback receives the original error + raw output', async () => {
    let receivedRaw = '';
    let receivedStage = '';
    const agent = makeAgent('{"amount": "not a number", "reason": "x"}', {
      fallback: (err, raw) => {
        receivedRaw = raw;
        receivedStage = err.stage;
        return { amount: 0, reason: 'recovered' };
      },
      canned: { amount: 0, reason: 'canned' },
    });
    await agent.runTyped<Refund>({ message: '...' });
    expect(receivedRaw).toMatch(/not a number/);
    expect(receivedStage).toBe('schema-validate');
  });
});

// ─── P3 Scenario — fallback throws → canned takes over ───────────────

describe('outputFallback — P3 scenario', () => {
  it('P3 fallback throws → canned is returned', async () => {
    const agent = makeAgent('not JSON', {
      fallback: () => {
        throw new Error('fallback also failed');
      },
      canned: { amount: 0, reason: 'safety net engaged' },
    });
    const result = await agent.runTyped<Refund>({ message: '...' });
    expect(result).toEqual({ amount: 0, reason: 'safety net engaged' });
  });

  it('P3 fallback returns invalid value → canned re-validated and returned', async () => {
    const agent = makeAgent('not JSON', {
      // Returns a value that fails schema (negative amount).
      fallback: () => ({ amount: -100, reason: 'bad' } as unknown as Refund),
      canned: { amount: 0, reason: 'safety net' },
    });
    const result = await agent.runTyped<Refund>({ message: '...' });
    expect(result).toEqual({ amount: 0, reason: 'safety net' });
  });
});

// ─── P4 Property — fail-open guarantee with canned ───────────────────

describe('outputFallback — P4 property', () => {
  it('P4 agent NEVER throws on output failure when canned is set (fail-open)', async () => {
    const agent = makeAgent('absolute garbage', {
      fallback: () => {
        throw new Error('catastrophic fallback');
      },
      canned: { amount: 0, reason: 'never throws' },
    });
    // No try/catch needed — the contract is "doesn't throw".
    const result = await agent.runTyped<Refund>({ message: '...' });
    expect(result.amount).toBe(0);
  });

  it('P4 WITHOUT canned, agent re-throws when fallback fails (fail-closed)', async () => {
    const agent = makeAgent('garbage', {
      fallback: () => {
        throw new Error('fallback failed and no canned set');
      },
      // canned omitted intentionally
    });
    await expect(agent.runTyped<Refund>({ message: '...' })).rejects.toThrow(/fallback failed/);
  });
});

// ─── P5 Security — builder-time canned validation ────────────────────

describe('outputFallback — P5 security', () => {
  it('P5 canned that fails schema throws TypeError at builder time (fail-fast)', () => {
    const builder = Agent.create({
      provider: mock({ replies: [{ content: '' }] }),
      model: 'mock',
    })
      .system('s')
      .outputSchema(Refund);

    expect(() =>
      builder.outputFallback({
        fallback: () => ({ amount: 0, reason: 'x' }),
        // Negative amount — violates `nonnegative()`.
        canned: { amount: -1, reason: 'x' } as unknown as Refund,
      }),
    ).toThrow(TypeError);
  });

  it('P5 outputFallback() before outputSchema() throws (incoherent config)', () => {
    const builder = Agent.create({
      provider: mock({ replies: [{ content: '' }] }),
      model: 'mock',
    }).system('s');

    expect(() =>
      builder.outputFallback({
        fallback: () => ({ amount: 0, reason: 'x' }),
        canned: { amount: 0, reason: 'x' },
      }),
    ).toThrow(/outputSchema/);
  });

  it('P5 calling outputFallback() twice throws (avoid silent override)', () => {
    const builder = Agent.create({
      provider: mock({ replies: [{ content: '' }] }),
      model: 'mock',
    })
      .system('s')
      .outputSchema(Refund)
      .outputFallback({
        fallback: () => ({ amount: 0, reason: 'first' }),
      });

    expect(() =>
      builder.outputFallback({
        fallback: () => ({ amount: 1, reason: 'second' }),
      }),
    ).toThrow(/already set/);
  });
});

// ─── P6 Performance — happy path zero-overhead ───────────────────────

describe('outputFallback — P6 performance', () => {
  it('P6 happy path takes no longer than no-fallback path (no engagement)', async () => {
    const valid: Refund = { amount: 1, reason: 'ok' };
    // Without fallback.
    const a1 = Agent.create({
      provider: mock({ replies: [{ content: JSON.stringify(valid) }] }),
      model: 'mock',
    })
      .system('s')
      .outputSchema(Refund)
      .build();
    // With fallback.
    const a2 = makeAgent(JSON.stringify(valid), {
      fallback: () => ({ amount: 0, reason: 'never used' }),
      canned: { amount: 0, reason: 'never used' },
    });
    const r1 = await a1.runTyped<Refund>({ message: '...' });
    const r2 = await a2.runTyped<Refund>({ message: '...' });
    expect(r1).toEqual(r2);
    expect(r1).toEqual(valid);
  });
});

// ─── P7 ROI — typed events on tier transitions ───────────────────────

describe('outputFallback — P7 ROI', () => {
  it('P7 output_fallback_triggered event fires when fallback engages', async () => {
    const events: AgentfootprintEvent[] = [];
    const agent = makeAgent('not JSON', {
      fallback: () => ({ amount: 0, reason: 'recovered' }),
      canned: { amount: 0, reason: 'canned' },
    });
    agent.on('agentfootprint.resilience.output_fallback_triggered' as never, (event) => {
      events.push(event as AgentfootprintEvent);
    });
    await agent.runTyped<Refund>({ message: '...' });
    expect(events).toHaveLength(1);
    const payload = events[0]?.payload as { stage: string; primaryErrorMessage: string };
    expect(payload.stage).toBe('json-parse');
  });

  it('P7 output_canned_used event fires when canned engages (tier 3)', async () => {
    const events: AgentfootprintEvent[] = [];
    const agent = makeAgent('not JSON', {
      fallback: () => {
        throw new Error('fallback exploded');
      },
      canned: { amount: 0, reason: 'safety net' },
    });
    agent.on('agentfootprint.resilience.output_canned_used' as never, (event) => {
      events.push(event as AgentfootprintEvent);
    });
    await agent.runTyped<Refund>({ message: '...' });
    expect(events).toHaveLength(1);
    const payload = events[0]?.payload as { fallbackErrorMessage: string };
    expect(payload.fallbackErrorMessage).toMatch(/exploded/);
  });
});

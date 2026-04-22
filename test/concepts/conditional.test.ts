/**
 * Conditional concept — 5-pattern tests.
 *
 * Tests predicate-based routing between runners. Uses mock runners — no
 * network, deterministic, fast.
 */
import { describe, it, expect, vi } from 'vitest';
import { Conditional } from '../../src/concepts/Conditional';
import { Agent } from '../../src/lib/concepts';
import { mock } from '../../src/adapters/mock/MockAdapter';
import type { RunnerLike } from '../../src/types/multiAgent';

// ── Helpers ──────────────────────────────────────────────────

function mockRunner(content: string, delay = 0): RunnerLike {
  return {
    run: vi.fn(async () => {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      return { content, messages: [], iterations: 1 };
    }),
  };
}

// ── Unit ────────────────────────────────────────────────────

describe('Conditional — unit', () => {
  it('routes to the first matching predicate', async () => {
    const refund = mockRunner('REFUND_RESULT');
    const general = mockRunner('GENERAL_RESULT');

    const runner = Conditional.create({ name: 'triage' })
      .when((input) => input.includes('refund'), refund, { id: 'refund' })
      .otherwise(general)
      .build();

    const result = await runner.run('I want a refund');

    expect(refund.run).toHaveBeenCalledTimes(1);
    expect(general.run).not.toHaveBeenCalled();
    expect(result.content).toBe('REFUND_RESULT');
  });

  it('routes to otherwise when no predicate matches', async () => {
    const match = mockRunner('MATCHED');
    const fallback = mockRunner('FALLBACK');

    const runner = Conditional.create()
      .when((input) => input.includes('xxx'), match)
      .otherwise(fallback)
      .build();

    const result = await runner.run('hello world');

    expect(match.run).not.toHaveBeenCalled();
    expect(fallback.run).toHaveBeenCalledTimes(1);
    expect(result.content).toBe('FALLBACK');
  });

  it('stops at the first match — later branches never run', async () => {
    const first = mockRunner('FIRST');
    const second = mockRunner('SECOND');
    const fallback = mockRunner('FALLBACK');

    const runner = Conditional.create()
      .when(() => true, first, { id: 'first' })
      .when(() => true, second, { id: 'second' })
      .otherwise(fallback)
      .build();

    const result = await runner.run('anything');

    expect(first.run).toHaveBeenCalledTimes(1);
    expect(second.run).not.toHaveBeenCalled();
    expect(fallback.run).not.toHaveBeenCalled();
    expect(result.content).toBe('FIRST');
  });

  it('surfaces predicate matches in the narrative', async () => {
    const refund = mockRunner('r');
    const fallback = mockRunner('f');

    const runner = Conditional.create({ name: 'triage' })
      .when((input) => input.includes('refund'), refund, {
        id: 'refund',
        name: 'Refund Handler',
      })
      .otherwise(fallback)
      .build();

    await runner.run('I want a refund please');

    const narrative = runner
      .getNarrativeEntries()
      .map((e) => e.text)
      .join('\n');
    expect(narrative).toMatch(/Refund Handler|refund/i);
  });

  it('provides state snapshot to predicate', async () => {
    const match = mockRunner('m');
    const fallback = mockRunner('f');
    const predicate = vi.fn((input: string, state: Record<string, unknown>) => {
      // state must contain pipelineInput equal to input
      return state.pipelineInput === input && input.length > 0;
    });

    const runner = Conditional.create().when(predicate, match).otherwise(fallback).build();

    await runner.run('hello');
    expect(predicate).toHaveBeenCalled();
    expect(match.run).toHaveBeenCalled();
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('Conditional — boundary', () => {
  it('treats throwing predicate as a miss (fail-open)', async () => {
    const throwing = vi.fn(() => {
      throw new Error('predicate boom');
    });
    const match = mockRunner('M');
    const fallback = mockRunner('F');

    const runner = Conditional.create()
      .when(throwing, mockRunner('NEVER'))
      .when((input) => input.length > 0, match)
      .otherwise(fallback)
      .build();

    const result = await runner.run('hello');

    expect(throwing).toHaveBeenCalled();
    expect(match.run).toHaveBeenCalled();
    expect(result.content).toBe('M');
  });

  it('coerces truthy non-boolean predicate returns to true', async () => {
    const match = mockRunner('M');
    const fallback = mockRunner('F');

    // Predicate returns a non-empty string (truthy but not `true`).
    const runner = Conditional.create()
      .when((input) => input as unknown as boolean, match)
      .otherwise(fallback)
      .build();

    const result = await runner.run('truthy');
    expect(match.run).toHaveBeenCalled();
    expect(result.content).toBe('M');
  });

  it('handles empty string input', async () => {
    const match = mockRunner('M');
    const fallback = mockRunner('F');

    const runner = Conditional.create()
      .when((input) => input.length > 0, match)
      .otherwise(fallback)
      .build();

    const result = await runner.run('');
    expect(fallback.run).toHaveBeenCalled();
    expect(result.content).toBe('F');
  });

  it('throws at build() when no branches added', () => {
    expect(() => {
      Conditional.create().otherwise(mockRunner('x')).build();
    }).toThrow(/at least one \.when\(\) branch/);
  });

  it('throws at build() when .otherwise() is missing', () => {
    expect(() => {
      Conditional.create()
        .when(() => true, mockRunner('x'))
        .build();
    }).toThrow(/requires \.otherwise/);
  });

  it('throws on duplicate branch IDs', () => {
    const builder = Conditional.create().when(() => true, mockRunner('a'), {
      id: 'same',
    });
    expect(() => builder.when(() => true, mockRunner('b'), { id: 'same' })).toThrow(
      /duplicate branch ID 'same'/,
    );
  });

  it("reserves 'default' as a branch ID", () => {
    expect(() => Conditional.create().when(() => true, mockRunner('x'), { id: 'default' })).toThrow(
      /reserved for \.otherwise/,
    );
  });

  it('rejects invalid branch IDs', () => {
    expect(() => Conditional.create().when(() => true, mockRunner('x'), { id: 'foo/bar' })).toThrow(
      /invalid/,
    );
    expect(() =>
      Conditional.create().when(() => true, mockRunner('x'), { id: 'has space' }),
    ).toThrow(/invalid/);
  });

  it('rejects non-function predicates', () => {
    expect(() => Conditional.create().when('not-a-fn' as never, mockRunner('x'))).toThrow(
      /predicate must be a function/,
    );
  });

  it('rejects non-runner values in when / otherwise', () => {
    expect(() => Conditional.create().when(() => true, { notARunner: true } as never)).toThrow(
      /run\(\) method/,
    );
    expect(() =>
      Conditional.create()
        .when(() => true, mockRunner('x'))
        .otherwise({ notARunner: true } as never),
    ).toThrow(/run\(\) method/);
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('Conditional — scenario', () => {
  it('composes inside FlowChart — output of Conditional feeds next runner', async () => {
    const { FlowChart } = await import('../../src/concepts/FlowChart');

    const fast = mockRunner('fast-result');
    const slow = mockRunner('slow-result');
    const summarizer = mockRunner('SUMMARY');

    const triage = Conditional.create({ name: 'triage' })
      .when((input) => input.length < 20, fast, { id: 'fast' })
      .otherwise(slow)
      .build();

    const pipeline = FlowChart.create()
      .agent('triage', 'Triage', triage)
      .agent('summarize', 'Summarize', summarizer)
      .build();

    const result = await pipeline.run('short');

    expect(fast.run).toHaveBeenCalled();
    expect(slow.run).not.toHaveBeenCalled();
    expect(summarizer.run).toHaveBeenCalled();
    expect(result.content).toBe('SUMMARY');
  });

  it('nested Conditional (Conditional inside Conditional.otherwise)', async () => {
    const a = mockRunner('A');
    const b = mockRunner('B');
    const c = mockRunner('C');

    const inner = Conditional.create({ name: 'inner' })
      .when((input) => input.includes('b'), b, { id: 'b' })
      .otherwise(c)
      .build();

    const outer = Conditional.create({ name: 'outer' })
      .when((input) => input.includes('a'), a, { id: 'a' })
      .otherwise(inner)
      .build();

    expect((await outer.run('a-thing')).content).toBe('A');
    expect((await outer.run('b-thing')).content).toBe('B');
    expect((await outer.run('other')).content).toBe('C');
  });

  it('works with a real Agent as a branch', async () => {
    const provider = mock([{ content: 'agent-answer' }]);
    const supportAgent = Agent.create({ provider }).system('You are support').build();

    const escalate = mockRunner('ESCALATED');

    const router = Conditional.create({ name: 'support-router' })
      .when((input) => input.toLowerCase().includes('urgent'), escalate, {
        id: 'escalate',
      })
      .otherwise(supportAgent)
      .build();

    // Non-urgent → real Agent path
    const normal = await router.run('how do I reset my password');
    expect(normal.content).toBe('agent-answer');
    expect(escalate.run).not.toHaveBeenCalled();

    // Urgent → escalate path
    const urgent = await router.run('URGENT: my account is locked');
    expect(urgent.content).toBe('ESCALATED');
    expect(escalate.run).toHaveBeenCalled();
  });

  it('preserves branch order semantics across many calls', async () => {
    const a = mockRunner('A');
    const b = mockRunner('B');
    const fallback = mockRunner('F');

    const runner = Conditional.create()
      .when((input) => input.startsWith('a'), a, { id: 'a' })
      .when((input) => input.startsWith('b'), b, { id: 'b' })
      .otherwise(fallback)
      .build();

    expect((await runner.run('apple')).content).toBe('A');
    expect((await runner.run('banana')).content).toBe('B');
    expect((await runner.run('cherry')).content).toBe('F');
    expect((await runner.run('ab')).content).toBe('A'); // first-match wins
  });
});

// ── Property ────────────────────────────────────────────────

describe('Conditional — property', () => {
  it('exactly one branch runs per invocation — never zero, never two', async () => {
    const runners = Array.from({ length: 5 }, (_, i) => mockRunner(`R${i}`));
    const fallback = mockRunner('F');

    const runner = runners
      .reduce(
        (builder, r, i) => builder.when((input) => input.length === i, r, { id: `r-${i}` }),
        Conditional.create(),
      )
      .otherwise(fallback)
      .build();

    // Test a range of inputs; exactly one runner fires each time.
    const inputs = ['', 'a', 'ab', 'abc', 'abcd', 'abcde', 'abcdef', 'abcdefg'];
    for (const input of inputs) {
      // Reset call history
      runners.forEach((r) => (r.run as ReturnType<typeof vi.fn>).mockClear());
      (fallback.run as ReturnType<typeof vi.fn>).mockClear();

      await runner.run(input);

      const fired =
        runners.filter((r) => (r.run as ReturnType<typeof vi.fn>).mock.calls.length > 0).length +
        ((fallback.run as ReturnType<typeof vi.fn>).mock.calls.length > 0 ? 1 : 0);
      expect(fired).toBe(1);
    }
  });

  it('adding a new unmatchable branch does not change routing of any input', async () => {
    const a = mockRunner('A');
    const fallback = mockRunner('F');

    const without = Conditional.create()
      .when((input) => input.startsWith('a'), a, { id: 'a' })
      .otherwise(fallback)
      .build();

    const neverMatch = mockRunner('NM');
    const with_ = Conditional.create()
      .when((input) => input.startsWith('a'), a, { id: 'a' })
      .when(() => false, neverMatch, { id: 'nm' })
      .otherwise(fallback)
      .build();

    const inputs = ['apple', 'banana', 'a', ''];
    for (const input of inputs) {
      const r1 = await without.run(input);
      const r2 = await with_.run(input);
      expect(r1.content).toBe(r2.content);
    }
    expect(neverMatch.run).not.toHaveBeenCalled();
  });
});

// ── Security ────────────────────────────────────────────────

describe('Conditional — security', () => {
  it('a predicate with side effects does NOT leak into scope', async () => {
    // If a predicate tries to mutate scope, the frozen state snapshot should
    // either no-op (strict mode) or throw. Either way, scope must stay clean.
    const a = mockRunner('A');
    const fallback = mockRunner('F');

    const runner = Conditional.create()
      .when((_input, state) => {
        // Try to mutate the frozen state snapshot
        try {
          (state as Record<string, unknown>).injected = 'evil';
        } catch {
          // Frozen — swallow
        }
        return true;
      }, a)
      .otherwise(fallback)
      .build();

    await runner.run('x');

    const snapshot = runner.getSnapshot();
    const shared = (snapshot as { sharedState?: Record<string, unknown> })?.sharedState ?? {};
    expect(shared.injected).toBeUndefined();
  });

  it('a predicate throwing synchronously does not poison subsequent matching', async () => {
    const a = mockRunner('A');
    const fallback = mockRunner('F');

    const runner = Conditional.create()
      .when(() => {
        throw new Error('boom');
      }, mockRunner('NEVER'))
      .when((input) => input === 'a', a)
      .otherwise(fallback)
      .build();

    const result = await runner.run('a');
    expect(result.content).toBe('A');
  });

  it("does not accept 'default' as a branch ID (reserved)", () => {
    expect(() => Conditional.create().when(() => true, mockRunner('x'), { id: 'default' })).toThrow(
      /reserved/,
    );
  });

  it('invalid branch IDs (with /, whitespace, etc.) are rejected at call site', () => {
    const dangerous = ['../x', 'foo/bar', 'a b', '\n', ''];
    for (const id of dangerous) {
      expect(() => Conditional.create().when(() => true, mockRunner('x'), { id })).toThrow();
    }
  });
});

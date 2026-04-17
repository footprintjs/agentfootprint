/**
 * patterns/ — 5-pattern tests covering planExecute, mapReduce,
 * treeOfThoughts, reflexion.
 *
 * Each pattern is a thin factory, so the tests focus on:
 *   - wiring (stages run in the right order with the right inputs)
 *   - composition (pattern inside another concept)
 *   - input validation (meaningful errors for bad args)
 *
 * Uses the `mock` adapter so runs are deterministic and free.
 */
import { describe, it, expect, vi } from 'vitest';
import { planExecute } from '../../src/patterns/planExecute';
import { mapReduce } from '../../src/patterns/mapReduce';
import { treeOfThoughts } from '../../src/patterns/treeOfThoughts';
import { reflexion } from '../../src/patterns/reflexion';
import { mock } from '../../src/adapters/mock/MockAdapter';
import type { RunnerLike } from '../../src/types/multiAgent';

function mockRunner(content: string): RunnerLike {
  return {
    run: vi.fn(async () => ({ content, messages: [], iterations: 1 })),
  };
}

// ── planExecute ─────────────────────────────────────────────

describe('planExecute — unit', () => {
  it('runs planner before executor', async () => {
    const callOrder: string[] = [];
    const planner: RunnerLike = {
      run: vi.fn(async () => {
        callOrder.push('plan');
        return { content: 'step 1\nstep 2', messages: [], iterations: 1 };
      }),
    };
    const executor: RunnerLike = {
      run: vi.fn(async () => {
        callOrder.push('execute');
        return { content: 'done', messages: [], iterations: 1 };
      }),
    };

    const runner = planExecute({ planner, executor });
    const result = await runner.run('build a website');

    expect(callOrder).toEqual(['plan', 'execute']);
    expect(result.content).toBe('done');
  });

  it('feeds planner output as executor input', async () => {
    const planner = mockRunner('PLAN_OUTPUT');
    const executor = mockRunner('EXEC_OUTPUT');

    const runner = planExecute({ planner, executor });
    await runner.run('request');

    expect(executor.run).toHaveBeenCalledWith('PLAN_OUTPUT', expect.any(Object));
  });
});

// ── mapReduce ───────────────────────────────────────────────

describe('mapReduce — unit', () => {
  it('runs mappers in parallel and reduces via fn', async () => {
    const provider = mock([{ content: 'ignored — fn reducer' }]);
    const mappers = [
      { id: 'm0', description: 'Doc 0', runner: mockRunner('SUMMARY_0') },
      { id: 'm1', description: 'Doc 1', runner: mockRunner('SUMMARY_1') },
      { id: 'm2', description: 'Doc 2', runner: mockRunner('SUMMARY_2') },
    ];

    const runner = mapReduce({
      provider,
      mappers,
      reduce: {
        mode: 'fn',
        fn: (results) =>
          Object.values(results)
            .map((r) => r.content)
            .join('|'),
      },
    });

    const result = await runner.run('kick off');

    expect(result.content).toBe('SUMMARY_0|SUMMARY_1|SUMMARY_2');
    for (const m of mappers) expect(m.runner.run).toHaveBeenCalled();
  });

  it('runs mappers and reduces via LLM', async () => {
    const provider = mock([{ content: 'COMBINED_REPORT' }]);
    const runner = mapReduce({
      provider,
      mappers: [
        { id: 'a', description: 'A', runner: mockRunner('a-result') },
        { id: 'b', description: 'B', runner: mockRunner('b-result') },
      ],
      reduce: { mode: 'llm', prompt: 'Combine into one report.' },
    });

    const result = await runner.run('start');
    expect(result.content).toBe('COMBINED_REPORT');
  });

  it('rejects fewer than 2 mappers', () => {
    expect(() =>
      mapReduce({
        provider: mock([]),
        mappers: [{ id: 'only', description: 'only', runner: mockRunner('x') }],
        reduce: { mode: 'fn', fn: () => '' },
      }),
    ).toThrow(/at least 2 mappers/);
  });
});

// ── treeOfThoughts ──────────────────────────────────────────

describe('treeOfThoughts — unit', () => {
  it('runs N thinkers concurrently then hands their outputs to judge', async () => {
    const provider = mock([{ content: 'judge-ignored' }]); // judge uses its own runner
    const thinkers = [mockRunner('T0'), mockRunner('T1'), mockRunner('T2')];
    const judge = mockRunner('BEST: T1');

    const runner = treeOfThoughts({
      provider,
      branches: 3,
      thinker: (i) => thinkers[i],
      judge,
    });

    const result = await runner.run('hard problem');

    for (const t of thinkers) expect(t.run).toHaveBeenCalled();
    expect(judge.run).toHaveBeenCalled();
    // Judge should receive each thought labeled by id
    const judgeInput = (judge.run as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(judgeInput).toContain('=== thinker-0 ===');
    expect(judgeInput).toContain('T0');
    expect(judgeInput).toContain('=== thinker-1 ===');
    expect(judgeInput).toContain('T1');
    expect(result.content).toBe('BEST: T1');
  });

  it('rejects branches < 2', () => {
    expect(() =>
      treeOfThoughts({
        provider: mock([]),
        branches: 1,
        thinker: () => mockRunner('x'),
        judge: mockRunner('y'),
      }),
    ).toThrow(/at least 2 branches/);
  });
});

// ── reflexion ───────────────────────────────────────────────

describe('reflexion — unit', () => {
  it('runs solve → critique → improve in order', async () => {
    const order: string[] = [];
    const solver: RunnerLike = {
      run: vi.fn(async () => {
        order.push('solve');
        return { content: 'DRAFT', messages: [], iterations: 1 };
      }),
    };
    const critic: RunnerLike = {
      run: vi.fn(async () => {
        order.push('critique');
        return { content: 'CRITIQUE', messages: [], iterations: 1 };
      }),
    };
    const improver: RunnerLike = {
      run: vi.fn(async () => {
        order.push('improve');
        return { content: 'FINAL', messages: [], iterations: 1 };
      }),
    };

    const runner = reflexion({ solver, critic, improver });
    const result = await runner.run('question');

    expect(order).toEqual(['solve', 'critique', 'improve']);
    expect(result.content).toBe('FINAL');
    // Each runner receives the previous one's output
    expect((critic.run as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe('DRAFT');
    expect((improver.run as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe('CRITIQUE');
  });
});

// ── Scenario: patterns-in-patterns ─────────────────────────

describe('patterns — scenario', () => {
  it('Conditional picks between two patterns', async () => {
    const { Conditional } = await import('../../src/concepts/Conditional');
    const provider = mock([]);

    const slow = reflexion({
      solver: mockRunner('S'),
      critic: mockRunner('C'),
      improver: mockRunner('REFLEXION_DONE'),
    });
    const fast = planExecute({
      planner: mockRunner('PLAN'),
      executor: mockRunner('FAST_DONE'),
    });

    const router = Conditional.create()
      .when((input) => input.length < 20, fast, { id: 'fast' })
      .otherwise(slow)
      .build();

    const shortResult = await router.run('hi');
    expect(shortResult.content).toBe('FAST_DONE');

    const longResult = await router.run('this is a long complicated request that needs reflection');
    expect(longResult.content).toBe('REFLEXION_DONE');

    // Reference `provider` to silence unused var warning (mocks don't need it).
    expect(provider).toBeDefined();
  });

  it('mapReduce inside planExecute — plan then fan-out, reduce, execute', async () => {
    const provider = mock([{ content: 'IGNORED' }]);

    const plan = mockRunner('PLAN_DOC');
    const fanOut = mapReduce({
      provider,
      mappers: [
        { id: 'a', description: 'A', runner: mockRunner('a') },
        { id: 'b', description: 'B', runner: mockRunner('b') },
      ],
      reduce: {
        mode: 'fn',
        fn: (r) =>
          Object.values(r)
            .map((x) => x.content)
            .join('+'),
      },
    });

    const pipeline = planExecute({ planner: plan, executor: fanOut });
    const result = await pipeline.run('req');

    // Plan runs first (output: PLAN_DOC), then fanOut receives it
    expect(plan.run).toHaveBeenCalled();
    expect(result.content).toBe('a+b');
  });
});

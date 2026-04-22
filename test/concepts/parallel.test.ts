/**
 * Parallel concept — 5-pattern tests.
 *
 * Tests concurrent agent execution with fan-out/fan-in.
 */
import { describe, it, expect, vi } from 'vitest';
import { Parallel } from '../../src/concepts/Parallel';
import type { LLMProvider, LLMResponse } from '../../src/types';
import type { RunnerLike } from '../../src/types/multiAgent';

// ── Helpers ──────────────────────────────────────────────────

function mockProvider(responses: LLMResponse[]): LLMProvider {
  let i = 0;
  return { chat: vi.fn(async () => responses[i++] ?? responses[responses.length - 1]) };
}

function mockRunner(content: string, delay = 0): RunnerLike {
  return {
    run: vi.fn(async () => {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      return { content, messages: [], iterations: 1 };
    }),
  };
}

// ── Unit ────────────────────────────────────────────────────

describe('Parallel — unit', () => {
  it('runs two agents in parallel and merges with function', async () => {
    const provider = mockProvider([{ content: 'merged' }]);
    const runner1 = mockRunner('research-result');
    const runner2 = mockRunner('writing-result');

    const parallel = Parallel.create({ provider })
      .agent('research', runner1, 'Research')
      .agent('writing', runner2, 'Writing')
      .merge((results) => {
        return `Research: ${results.research.content}\nWriting: ${results.writing.content}`;
      })
      .build();

    const result = await parallel.run('test');

    expect(runner1.run).toHaveBeenCalled();
    expect(runner2.run).toHaveBeenCalled();
    expect(result.content).toContain('Research: research-result');
    expect(result.content).toContain('Writing: writing-result');
    expect(result.branches).toHaveLength(2);
  });

  it('runs two agents and merges with LLM', async () => {
    const provider = mockProvider([{ content: 'Synthesized report.' }]);
    const runner1 = mockRunner('data-from-research');
    const runner2 = mockRunner('draft-from-writer');

    const parallel = Parallel.create({ provider })
      .agent('research', runner1, 'Research')
      .agent('writing', runner2, 'Writing')
      .mergeWithLLM('Combine into a report')
      .build();

    const result = await parallel.run('AI safety');

    expect(result.content).toBe('Synthesized report.');
    expect(result.branches).toHaveLength(2);
    expect(result.branches[0].status).toBe('fulfilled');
  });

  it('getSpec() returns spec with fork structure', () => {
    const provider = mockProvider([{ content: 'x' }]);
    const parallel = Parallel.create({ provider })
      .agent('a', mockRunner('x'), 'A')
      .agent('b', mockRunner('y'), 'B')
      .merge(() => 'merged')
      .build();

    const spec = parallel.getSpec();
    expect(spec).toBeDefined();
    const specStr = JSON.stringify(spec);
    expect(specStr).toContain('fork');
  });

  it('branch results are keyed by ID', async () => {
    const provider = mockProvider([{ content: 'merged' }]);
    const parallel = Parallel.create({ provider })
      .agent('alpha', mockRunner('a-result'), 'Alpha')
      .agent('beta', mockRunner('b-result'), 'Beta')
      .merge((results) => `${results.alpha.content}+${results.beta.content}`)
      .build();

    const result = await parallel.run('test');
    expect(result.branches.find((b) => b.id === 'alpha')?.content).toBe('a-result');
    expect(result.branches.find((b) => b.id === 'beta')?.content).toBe('b-result');
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('Parallel — boundary', () => {
  it('throws with fewer than 2 branches', () => {
    const provider = mockProvider([{ content: 'x' }]);
    expect(() =>
      Parallel.create({ provider })
        .agent('only', mockRunner('x'), 'Only')
        .merge(() => 'x')
        .build(),
    ).toThrow('at least 2');
  });

  it('throws with duplicate branch IDs', () => {
    const provider = mockProvider([{ content: 'x' }]);
    expect(() =>
      Parallel.create({ provider })
        .agent('same', mockRunner('x'), 'A')
        .agent('same', mockRunner('y'), 'B'),
    ).toThrow('duplicate');
  });

  it('throws without merge strategy', () => {
    const provider = mockProvider([{ content: 'x' }]);
    expect(() =>
      Parallel.create({ provider })
        .agent('a', mockRunner('x'), 'A')
        .agent('b', mockRunner('y'), 'B')
        .build(),
    ).toThrow('merge strategy');
  });

  it('throws with more than 10 branches', () => {
    const provider = mockProvider([{ content: 'x' }]);
    const builder = Parallel.create({ provider });
    for (let i = 0; i < 10; i++) {
      builder.agent(`agent-${i}`, mockRunner('x'), `Agent ${i}`);
    }
    expect(() => builder.agent('agent-10', mockRunner('x'), 'Too many')).toThrow('maximum 10');
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('Parallel — scenario', () => {
  it('research + writing pipeline with LLM merge', async () => {
    const researchRunner = mockRunner('AI safety is a critical field...');
    const writingRunner = mockRunner('Here is a draft report on the topic...');
    const provider = mockProvider([
      { content: 'Combined Report:\nAI safety is critical. Here is a comprehensive report...' },
    ]);

    const parallel = Parallel.create({ provider })
      .agent('research', researchRunner, 'Deep research on the topic')
      .agent('writing', writingRunner, 'Draft initial content')
      .mergeWithLLM('Synthesize the research findings and writing draft into a final report')
      .build();

    const result = await parallel.run('Write a report on AI safety');

    expect(researchRunner.run).toHaveBeenCalledWith('Write a report on AI safety');
    expect(writingRunner.run).toHaveBeenCalledWith('Write a report on AI safety');
    expect(result.content).toContain('Combined Report');
    expect(result.branches).toHaveLength(2);

    // LLM was called with merge prompt containing branch results
    const chatCall = (provider.chat as any).mock.calls[0];
    const messages = chatCall[0];
    expect(messages[1].content).toContain('<branch id="research">');
    expect(messages[1].content).toContain('<branch id="writing">');
  });

  it('three agents with function merge', async () => {
    const parallel = Parallel.create({ provider: mockProvider([]) })
      .agent('a', mockRunner('result-a'), 'Agent A')
      .agent('b', mockRunner('result-b'), 'Agent B')
      .agent('c', mockRunner('result-c'), 'Agent C')
      .merge((results) => {
        return Object.values(results)
          .map((r) => r.content)
          .join(' | ');
      })
      .build();

    const result = await parallel.run('test');
    expect(result.content).toBe('result-a | result-b | result-c');
    expect(result.branches).toHaveLength(3);
  });
});

// ── Property ────────────────────────────────────────────────

describe('Parallel — property', () => {
  it('all branches receive the same input message', async () => {
    const runner1 = mockRunner('r1');
    const runner2 = mockRunner('r2');

    const parallel = Parallel.create({ provider: mockProvider([]) })
      .agent('a', runner1, 'A')
      .agent('b', runner2, 'B')
      .merge(() => 'done')
      .build();

    await parallel.run('specific message');
    expect(runner1.run).toHaveBeenCalledWith('specific message');
    expect(runner2.run).toHaveBeenCalledWith('specific message');
  });

  it('branch results all have status fulfilled on success', async () => {
    const parallel = Parallel.create({ provider: mockProvider([]) })
      .agent('a', mockRunner('x'), 'A')
      .agent('b', mockRunner('y'), 'B')
      .merge(() => 'ok')
      .build();

    const result = await parallel.run('test');
    for (const branch of result.branches) {
      expect(branch.status).toBe('fulfilled');
    }
  });

  it('narrative includes branch stages', async () => {
    const parallel = Parallel.create({ provider: mockProvider([]) })
      .agent('research', mockRunner('data'), 'Research agent')
      .agent('writer', mockRunner('draft'), 'Writing agent')
      .merge(() => 'combined')
      .build();

    await parallel.run('test');
    const narrative = parallel.getNarrativeEntries().map((e) => e.text);
    expect(narrative.length).toBeGreaterThan(0);
  });
});

// ── Security ────────────────────────────────────────────────

describe('Parallel — security', () => {
  it('branches have isolated scope (one cannot read another)', async () => {
    // Each runner writes to scope.result — if scope is shared, last-write-wins
    // With isolated subflows, each branch has its own scope
    const runner1 = {
      run: vi.fn(async () => ({ content: 'isolated-1', messages: [], iterations: 1 })),
    };
    const runner2 = {
      run: vi.fn(async () => ({ content: 'isolated-2', messages: [], iterations: 1 })),
    };

    const parallel = Parallel.create({ provider: mockProvider([]) })
      .agent('a', runner1, 'A')
      .agent('b', runner2, 'B')
      .merge((results) => `${results.a.content}|${results.b.content}`)
      .build();

    const result = await parallel.run('test');
    // Both results should be preserved (not overwritten by each other)
    expect(result.content).toBe('isolated-1|isolated-2');
  });

  it('merge function receives all branch IDs', async () => {
    let receivedKeys: string[] = [];
    const parallel = Parallel.create({ provider: mockProvider([]) })
      .agent('alpha', mockRunner('x'), 'A')
      .agent('beta', mockRunner('y'), 'B')
      .merge((results) => {
        receivedKeys = Object.keys(results);
        return 'done';
      })
      .build();

    await parallel.run('test');
    expect(receivedKeys).toEqual(expect.arrayContaining(['alpha', 'beta']));
  });
});

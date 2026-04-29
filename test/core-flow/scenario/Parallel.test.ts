/**
 * Scenario tests — Parallel composition.
 */

import { describe, it, expect, vi } from 'vitest';
import { Parallel } from '../../../src/core-flow/Parallel.js';
import { LLMCall } from '../../../src/core/LLMCall.js';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';

function llm(reply: string) {
  return LLMCall.create({ provider: new MockProvider({ reply }), model: 'mock' })
    .system('')
    .build();
}

describe('Parallel — fn-merge', () => {
  it('runs branches concurrently and merges via fn', async () => {
    const p = Parallel.create({ name: 'Review' })
      .branch('a', llm('answer-A'))
      .branch('b', llm('answer-B'))
      .branch('c', llm('answer-C'))
      .mergeWithFn((results) => {
        return [results.a, results.b, results.c].join(' | ');
      })
      .build();

    const out = await p.run({ message: 'go' });
    expect(out).toBe('answer-A | answer-B | answer-C');
  });

  it('emits fork_start and merge_end events', async () => {
    const p = Parallel.create()
      .branch('a', llm('A'))
      .branch('b', llm('B'))
      .mergeWithFn((r) => Object.values(r).join(','))
      .build();

    const forkStarts = vi.fn();
    const mergeEnds = vi.fn();
    p.on('agentfootprint.composition.fork_start', forkStarts);
    p.on('agentfootprint.composition.merge_end', mergeEnds);

    await p.run({ message: 'hi' });

    expect(forkStarts).toHaveBeenCalledTimes(1);
    expect(forkStarts.mock.calls[0][0].payload.branches).toEqual([
      { id: 'a', name: 'a' },
      { id: 'b', name: 'b' },
    ]);
    expect(mergeEnds).toHaveBeenCalledTimes(1);
    expect(mergeEnds.mock.calls[0][0].payload.strategy).toBe('fn');
    expect(mergeEnds.mock.calls[0][0].payload.mergedBranchCount).toBe(2);
  });

  it('each branch receives the same input message', async () => {
    const seen: string[] = [];
    const captureBranch = (id: string) =>
      LLMCall.create({
        provider: new MockProvider({
          respond: (req) => {
            const last = [...req.messages].reverse().find((m) => m.role === 'user');
            seen.push(`${id}:${last?.content}`);
            return id;
          },
        }),
        model: 'mock',
      })
        .system('')
        .build();

    const p = Parallel.create()
      .branch('x', captureBranch('x'))
      .branch('y', captureBranch('y'))
      .mergeWithFn((r) => Object.values(r).join(','))
      .build();

    await p.run({ message: 'shared-input' });

    expect(seen.sort()).toEqual(['x:shared-input', 'y:shared-input']);
  });
});

describe('Parallel — LLM-merge', () => {
  it('calls the merge LLM with XML-tagged branch results', async () => {
    const capture = vi.fn();
    const mergeProvider = new MockProvider({
      respond: (req) => {
        const last = [...req.messages].reverse().find((m) => m.role === 'user');
        capture(last?.content);
        return 'synthesized';
      },
    });

    const p = Parallel.create()
      .branch('ethics', llm('ethics-report'))
      .branch('cost', llm('cost-report'))
      .mergeWithLLM({
        provider: mergeProvider,
        model: 'merge-mock',
        prompt: 'Synthesize:',
      })
      .build();

    const out = await p.run({ message: 'review' });
    expect(out).toBe('synthesized');

    const promptSent = capture.mock.calls[0][0] as string;
    expect(promptSent).toContain('Synthesize:');
    expect(promptSent).toContain('<ethics>ethics-report</ethics>');
    expect(promptSent).toContain('<cost>cost-report</cost>');
  });

  it('emits stream.llm_start/end for the merge call', async () => {
    const p = Parallel.create()
      .branch('a', llm('A'))
      .branch('b', llm('B'))
      .mergeWithLLM({
        provider: new MockProvider({ reply: 'merged' }),
        model: 'merge-mock',
        prompt: '',
      })
      .build();

    const starts: string[] = [];
    p.on('agentfootprint.stream.llm_start', (e) => starts.push(e.payload.model));

    await p.run({ message: 'hi' });
    // 2 branch LLM calls + 1 merge LLM call
    expect(starts).toContain('merge-mock');
    expect(starts.filter((m) => m === 'mock').length).toBe(2);
  });
});

describe('Parallel — validation', () => {
  it('rejects fewer than 2 branches', () => {
    expect(() =>
      Parallel.create()
        .branch('a', llm('x'))
        .mergeWithFn((r) => Object.values(r).join(','))
        .build(),
    ).toThrow(/at least 2 branches/);
  });

  it('rejects duplicate branch ids', () => {
    expect(() => Parallel.create().branch('same', llm('a')).branch('same', llm('b'))).toThrow(
      /duplicate branch id/,
    );
  });

  it('rejects build() with no merge strategy', () => {
    expect(() => Parallel.create().branch('a', llm('x')).branch('b', llm('y')).build()).toThrow(
      /no merge strategy/,
    );
  });

  it('rejects setting two merge strategies', () => {
    expect(() =>
      Parallel.create()
        .branch('a', llm('x'))
        .branch('b', llm('y'))
        .mergeWithFn((r) => Object.values(r).join(','))
        .mergeWithLLM({
          provider: new MockProvider(),
          model: 'm',
          prompt: '',
        }),
    ).toThrow(/already set/);
  });
});

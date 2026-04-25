/**
 * Property tests — composition event-count invariants.
 *
 * Every composition must satisfy: 1 enter, 1 exit, no orphan iteration/fork/
 * merge events. These tests parameterize over varying child counts.
 */

import { describe, it, expect } from 'vitest';
import { Sequence } from '../../../src/core-flow/Sequence.js';
import { Parallel } from '../../../src/core-flow/Parallel.js';
import { Conditional } from '../../../src/core-flow/Conditional.js';
import { Loop } from '../../../src/core-flow/Loop.js';
import { LLMCall } from '../../../src/core/LLMCall.js';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';

function llm(reply: string) {
  return LLMCall.create({ provider: new MockProvider({ reply }), model: 'mock' })
    .system('')
    .build();
}

describe('property — Sequence: 1 enter + 1 exit for any step count', () => {
  it.each([1, 2, 3, 5])('with %d steps', async (n) => {
    let builder = Sequence.create();
    for (let i = 0; i < n; i++) builder = builder.step(`s${i}`, llm(`R${i}`));
    const seq = builder.build();

    let enters = 0;
    let exits = 0;
    seq.on('agentfootprint.composition.enter', () => enters++);
    seq.on('agentfootprint.composition.exit', () => exits++);
    await seq.run({ message: 'go' });
    expect(enters).toBe(1);
    expect(exits).toBe(1);
  });
});

describe('property — Parallel: exactly 1 fork_start + 1 merge_end + 1 exit', () => {
  it.each([2, 3, 4, 6])('with %d branches', async (n) => {
    let builder = Parallel.create();
    for (let i = 0; i < n; i++) builder = builder.branch(`b${i}`, llm(`R${i}`));
    const par = builder.mergeWithFn((r) => Object.values(r).join(',')).build();

    let enters = 0;
    let forks = 0;
    let merges = 0;
    let exits = 0;
    par.on('agentfootprint.composition.enter', () => enters++);
    par.on('agentfootprint.composition.fork_start', () => forks++);
    par.on('agentfootprint.composition.merge_end', () => merges++);
    par.on('agentfootprint.composition.exit', () => exits++);
    await par.run({ message: 'go' });
    expect(enters).toBe(1);
    expect(forks).toBe(1);
    expect(merges).toBe(1);
    expect(exits).toBe(1);
  });

  it('fork_start carries the exact branch id set', async () => {
    const par = Parallel.create()
      .branch('a', llm('A'))
      .branch('b', llm('B'))
      .branch('c', llm('C'))
      .mergeWithFn((r) => Object.keys(r).join(','))
      .build();

    const seen: string[][] = [];
    par.on('agentfootprint.composition.fork_start', (e) => {
      seen.push((e.payload.branches as { id: string }[]).map((b) => b.id));
    });
    await par.run({ message: 'go' });
    expect(seen).toEqual([['a', 'b', 'c']]);
  });
});

describe('property — Conditional: exactly 1 route_decided per run', () => {
  it.each(['urgent', 'normal', 'unknown'])('for input classified as %s', async (kind) => {
    const cond = Conditional.create()
      .when('urgent', (i) => i.message.startsWith('!'), llm('URGENT'))
      .when('normal', (i) => i.message.startsWith('.'), llm('NORMAL'))
      .otherwise('unknown', llm('UNKNOWN'))
      .build();

    const msg = kind === 'urgent' ? '!crit' : kind === 'normal' ? '.hi' : 'plain';
    let routeCount = 0;
    cond.on('agentfootprint.composition.route_decided', () => routeCount++);
    await cond.run({ message: msg });
    expect(routeCount).toBe(1);
  });
});

describe('property — Loop: iteration_start count == iteration_exit count', () => {
  it.each([1, 2, 3, 5])('with times(%d) budget', async (n) => {
    const body = llm('step');
    const loop = Loop.create().repeat(body).times(n).build();

    let starts = 0;
    let exits = 0;
    loop.on('agentfootprint.composition.iteration_start', () => starts++);
    loop.on('agentfootprint.composition.iteration_exit', () => exits++);
    await loop.run({ message: 'go' });
    expect(starts).toBe(exits);
    expect(starts).toBe(n);
  });

  it('last iteration_exit reason is always "budget" when times() saturates', async () => {
    const loop = Loop.create().repeat(llm('x')).times(3).build();
    const reasons: string[] = [];
    loop.on('agentfootprint.composition.iteration_exit', (e) =>
      reasons.push((e.payload as { reason: string }).reason),
    );
    await loop.run({ message: 'go' });
    expect(reasons[reasons.length - 1]).toBe('budget');
  });
});

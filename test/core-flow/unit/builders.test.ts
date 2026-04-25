/**
 * Unit tests — composition builders (Sequence, Parallel, Conditional, Loop).
 *
 * Scope: isolated builder state transitions + validation (duplicate ids,
 * missing required calls, dangling transformers). End-to-end runs live
 * in scenario/.
 */

import { describe, it, expect } from 'vitest';
import { Sequence } from '../../../src/core-flow/Sequence.js';
import { Parallel } from '../../../src/core-flow/Parallel.js';
import { Conditional } from '../../../src/core-flow/Conditional.js';
import { Loop } from '../../../src/core-flow/Loop.js';
import { LLMCall } from '../../../src/core/LLMCall.js';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';

function trivialRunner() {
  return LLMCall.create({ provider: new MockProvider({ reply: 'ok' }), model: 'mock' })
    .system('')
    .build();
}

describe('Sequence builder', () => {
  it('accepts default options', () => {
    const seq = Sequence.create().step('a', trivialRunner()).build();
    expect(seq.name).toBe('Sequence');
    expect(seq.id).toBe('sequence');
  });

  it('accepts custom name + id', () => {
    const seq = Sequence.create({ name: 'Pipe', id: 'p' })
      .step('a', trivialRunner())
      .build();
    expect(seq.name).toBe('Pipe');
    expect(seq.id).toBe('p');
  });

  it('rejects duplicate step ids', () => {
    expect(() =>
      Sequence.create()
        .step('same', trivialRunner())
        .step('same', trivialRunner()),
    ).toThrow(/duplicate step id/);
  });

  it('rejects build() with zero steps', () => {
    expect(() => Sequence.create().build()).toThrow(/at least one/);
  });

  it('rejects dangling .pipeVia() at build time', () => {
    expect(() =>
      Sequence.create()
        .step('a', trivialRunner())
        .pipeVia((prev) => ({ message: prev }))
        .build(),
    ).toThrow(/dangling|pipeVia/i);
  });

  it('exposes runner-contract methods', () => {
    const seq = Sequence.create().step('a', trivialRunner()).build();
    expect(typeof seq.run).toBe('function');
    expect(typeof seq.toFlowChart).toBe('function');
    expect(typeof seq.on).toBe('function');
    expect(typeof seq.enable.thinking).toBe('function');
  });
});

describe('Parallel builder', () => {
  it('accepts default options', () => {
    const par = Parallel.create()
      .branch('a', trivialRunner())
      .branch('b', trivialRunner())
      .mergeWithFn((r) => Object.values(r).join('\n'))
      .build();
    expect(par.name).toBe('Parallel');
    expect(par.id).toBe('parallel');
  });

  it('rejects duplicate branch ids', () => {
    expect(() =>
      Parallel.create()
        .branch('same', trivialRunner())
        .branch('same', trivialRunner()),
    ).toThrow(/duplicate branch id/);
  });

  it('rejects build() without any merge strategy', () => {
    expect(() =>
      Parallel.create()
        .branch('a', trivialRunner())
        .branch('b', trivialRunner())
        .build(),
    ).toThrow(/merge/);
  });

  it('rejects double merge strategy', () => {
    expect(() =>
      Parallel.create()
        .branch('a', trivialRunner())
        .branch('b', trivialRunner())
        .mergeWithFn((r) => Object.values(r).join(''))
        .mergeWithFn((r) => Object.keys(r).join('')),
    ).toThrow(/merge strategy already set/);
  });

  it('accepts mergeWithLLM option', () => {
    const par = Parallel.create()
      .branch('a', trivialRunner())
      .branch('b', trivialRunner())
      .mergeWithLLM({
        provider: new MockProvider({ reply: 'merged' }),
        model: 'mock',
        prompt: 'Merge:',
      })
      .build();
    expect(par).toBeDefined();
  });
});

describe('Conditional builder', () => {
  it('rejects build() without .otherwise()', () => {
    expect(() =>
      Conditional.create()
        .when('a', () => true, trivialRunner())
        .build(),
    ).toThrow(/otherwise|fallback/i);
  });

  it('rejects duplicate when() ids', () => {
    expect(() =>
      Conditional.create()
        .when('dup', () => true, trivialRunner())
        .when('dup', () => false, trivialRunner()),
    ).toThrow(/duplicate branch id/);
  });

  it('rejects duplicate otherwise() registration', () => {
    expect(() =>
      Conditional.create()
        .when('a', () => true, trivialRunner())
        .otherwise('fallback', trivialRunner())
        .otherwise('fallback2', trivialRunner()),
    ).toThrow(/already registered/);
  });

  it('rejects otherwise id colliding with a when() id', () => {
    expect(() =>
      Conditional.create()
        .when('same', () => true, trivialRunner())
        .otherwise('same', trivialRunner()),
    ).toThrow(/duplicate/);
  });

  it('builds successfully with when + otherwise', () => {
    const cond = Conditional.create()
      .when('urgent', (i) => i.message.startsWith('!'), trivialRunner())
      .otherwise('normal', trivialRunner())
      .build();
    expect(cond).toBeDefined();
  });
});

describe('Loop builder', () => {
  it('rejects build() without .repeat()', () => {
    expect(() => Loop.create().build()).toThrow(/repeat/);
  });

  it('rejects second .repeat() call', () => {
    expect(() =>
      Loop.create()
        .repeat(trivialRunner())
        .repeat(trivialRunner()),
    ).toThrow(/already set/);
  });

  it('accepts .repeat() alone (default maxIterations=10)', () => {
    const loop = Loop.create().repeat(trivialRunner()).build();
    expect(loop).toBeDefined();
  });

  it('accepts .times(n) override', () => {
    const loop = Loop.create().repeat(trivialRunner()).times(5).build();
    expect(loop).toBeDefined();
  });

  it('accepts .forAtMost(ms) override', () => {
    const loop = Loop.create().repeat(trivialRunner()).forAtMost(10_000).build();
    expect(loop).toBeDefined();
  });

  it('accepts .until(guard) override', () => {
    const loop = Loop.create()
      .repeat(trivialRunner())
      .until(({ iteration }) => iteration > 3)
      .build();
    expect(loop).toBeDefined();
  });

  it('clamps .times(0) to 1 (defensive)', () => {
    const loop = Loop.create().repeat(trivialRunner()).times(0).build();
    expect(loop).toBeDefined();
  });

  it('clamps .times(99999) to hard ceiling (500)', () => {
    const loop = Loop.create().repeat(trivialRunner()).times(99999).build();
    expect(loop).toBeDefined();
  });

  it('clamps non-integer .times() to 1', () => {
    const loop = Loop.create().repeat(trivialRunner()).times(3.5).build();
    expect(loop).toBeDefined();
  });

  it('accepts custom name + id', () => {
    const loop = Loop.create({ name: 'MyLoop', id: 'ml' })
      .repeat(trivialRunner())
      .build();
    expect(loop.name).toBe('MyLoop');
    expect(loop.id).toBe('ml');
  });
});

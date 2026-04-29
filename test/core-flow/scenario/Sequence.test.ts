/**
 * Scenario tests — Sequence composition.
 */

import { describe, it, expect, vi } from 'vitest';
import { Sequence } from '../../../src/core-flow/Sequence.js';
import { LLMCall } from '../../../src/core/LLMCall.js';
import { Agent } from '../../../src/core/Agent.js';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';

describe('Sequence — two LLMCalls chained', () => {
  it('runs steps in order, piping output→input as message', async () => {
    const step1 = LLMCall.create({
      provider: new MockProvider({ reply: 'first-output' }),
      model: 'mock',
    })
      .system('step 1')
      .build();

    const step2 = LLMCall.create({
      provider: new MockProvider({
        respond: (req) => {
          const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
          return `step2 saw: ${lastUser?.content ?? ''}`;
        },
      }),
      model: 'mock',
    })
      .system('step 2')
      .build();

    const seq = Sequence.create({ name: 'Pipeline', id: 'pipe' })
      .step('s1', step1)
      .step('s2', step2)
      .build();

    const out = await seq.run({ message: 'hello' });
    expect(out).toBe('step2 saw: first-output');
  });

  it('emits composition.enter and composition.exit once each', async () => {
    const seq = Sequence.create()
      .step(
        's1',
        LLMCall.create({ provider: new MockProvider({ reply: 'a' }), model: 'mock' })
          .system('')
          .build(),
      )
      .step(
        's2',
        LLMCall.create({ provider: new MockProvider({ reply: 'b' }), model: 'mock' })
          .system('')
          .build(),
      )
      .build();

    const enters = vi.fn();
    const exits = vi.fn();
    seq.on('agentfootprint.composition.enter', enters);
    seq.on('agentfootprint.composition.exit', exits);

    await seq.run({ message: 'hi' });
    expect(enters).toHaveBeenCalledTimes(1);
    expect(exits).toHaveBeenCalledTimes(1);
    expect(enters.mock.calls[0][0].payload.kind).toBe('Sequence');
    expect(enters.mock.calls[0][0].payload.childCount).toBe(2);
    expect(exits.mock.calls[0][0].payload.status).toBe('ok');
  });

  it('forwards stream events from nested steps', async () => {
    const seq = Sequence.create()
      .step(
        's1',
        LLMCall.create({ provider: new MockProvider({ reply: 'a' }), model: 'mock' })
          .system('')
          .build(),
      )
      .step(
        's2',
        LLMCall.create({ provider: new MockProvider({ reply: 'b' }), model: 'mock' })
          .system('')
          .build(),
      )
      .build();

    const starts = vi.fn();
    seq.on('agentfootprint.stream.llm_start', starts);

    await seq.run({ message: 'hi' });
    // Two steps = two llm_start events
    expect(starts).toHaveBeenCalledTimes(2);
  });
});

describe('Sequence — pipeVia custom mapper', () => {
  it('transforms prev output before feeding to next step', async () => {
    const capture = vi.fn();
    const step1 = LLMCall.create({
      provider: new MockProvider({ reply: 'RAW' }),
      model: 'mock',
    })
      .system('')
      .build();
    const step2 = LLMCall.create({
      provider: new MockProvider({
        respond: (req) => {
          const last = [...req.messages].reverse().find((m) => m.role === 'user');
          capture(last?.content);
          return 'step2-done';
        },
      }),
      model: 'mock',
    })
      .system('')
      .build();

    const seq = Sequence.create()
      .step('a', step1)
      .pipeVia((prev) => ({ message: `prefix:${prev.toLowerCase()}` }))
      .step('b', step2)
      .build();

    await seq.run({ message: 'ignored' });
    expect(capture).toHaveBeenCalledWith('prefix:raw');
  });

  it('throws if .pipeVia() is dangling at build time', () => {
    expect(() =>
      Sequence.create()
        .step(
          'a',
          LLMCall.create({ provider: new MockProvider(), model: 'mock' }).system('').build(),
        )
        .pipeVia((prev) => ({ message: prev }))
        .build(),
    ).toThrow(/dangling|no following|pipeVia/i);
  });
});

describe('Sequence — validation', () => {
  it('rejects duplicate step ids', () => {
    const step = LLMCall.create({ provider: new MockProvider(), model: 'mock' }).system('').build();
    expect(() => Sequence.create().step('same', step).step('same', step)).toThrow(
      /duplicate step id/,
    );
  });

  it('rejects build() with zero steps', () => {
    expect(() => Sequence.create().build()).toThrow(/at least one/);
  });
});

describe('Sequence — nesting (Agent inside Sequence)', () => {
  it('runs an Agent step and forwards agent events', async () => {
    const agent = Agent.create({
      provider: new MockProvider({ reply: 'agent-final' }),
      model: 'mock',
    })
      .system('')
      .build();

    const seq = Sequence.create({ name: 'Pipe' }).step('agent', agent).build();

    const turnEnds = vi.fn();
    seq.on('agentfootprint.agent.turn_end', turnEnds);

    const out = await seq.run({ message: 'hi' });
    expect(out).toBe('agent-final');
    expect(turnEnds).toHaveBeenCalledTimes(1);
  });
});

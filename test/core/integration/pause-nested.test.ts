/**
 * Integration — pause bubbling through nested compositions.
 *
 * When an Agent pauses inside a Sequence / Loop / Conditional, the parent
 * composition must surface the pause as its own RunnerPauseOutcome, and
 * `resume()` on the outer composition must restart execution at the
 * nested paused stage.
 */

import { describe, it, expect } from 'vitest';
import { Agent } from '../../../src/core/Agent.js';
import { Sequence } from '../../../src/core-flow/Sequence.js';
import { Loop } from '../../../src/core-flow/Loop.js';
import { Conditional } from '../../../src/core-flow/Conditional.js';
import { isPaused, pauseHere } from '../../../src/core/pause.js';
import type { LLMProvider, LLMResponse } from '../../../src/adapters/types.js';

function scripted(...responses: readonly LLMResponse[]): LLMProvider {
  let i = 0;
  return {
    name: 'mock',
    complete: async () => responses[Math.min(i++, responses.length - 1)],
  };
}

function resp(
  content: string,
  toolCalls: readonly { id: string; name: string; args: Record<string, unknown> }[] = [],
): LLMResponse {
  return {
    content,
    toolCalls,
    usage: { input: 0, output: content.length / 4 },
    stopReason: toolCalls.length > 0 ? 'tool_use' : 'stop',
  };
}

function pausingAgent(reason: string) {
  return Agent.create({
    provider: scripted(resp('', [{ id: 't1', name: 'ask', args: {} }]), resp(`done-${reason}`)),
    model: 'mock',
  })
    .system('')
    .tool({
      schema: { name: 'ask', description: '', inputSchema: { type: 'object' } },
      execute: () => {
        pauseHere({ question: `approve ${reason}?` });
        return '';
      },
    })
    .build();
}

describe('integration — Agent paused inside Sequence', () => {
  it('outer Sequence surfaces the pause as its own RunnerPauseOutcome', async () => {
    const seq = Sequence.create().step('approve', pausingAgent('refund')).build();

    const paused = await seq.run({ message: 'refund me' });
    expect(isPaused(paused)).toBe(true);
    if (!isPaused(paused)) return;
    expect((paused.pauseData as { question: string }).question).toBe('approve refund?');
  });

  it('Sequence.resume() completes a paused Agent subflow', async () => {
    const seq = Sequence.create().step('approve', pausingAgent('refund')).build();

    const paused = await seq.run({ message: 'refund me' });
    if (!isPaused(paused)) return expect.fail('expected paused');

    const final = await seq.resume(paused.checkpoint, 'approved');
    expect(isPaused(final)).toBe(false);
    expect(final).toBe('done-refund');
  });
});

describe('integration — Agent paused inside Loop body', () => {
  it('Loop surfaces the pause from its first iteration', async () => {
    const loop = Loop.create().repeat(pausingAgent('loop-1')).times(2).build();

    const paused = await loop.run({ message: 'go' });
    expect(isPaused(paused)).toBe(true);
  });
});

describe('integration — Agent paused inside Conditional branch', () => {
  it('Conditional surfaces the pause from the chosen branch', async () => {
    const cond = Conditional.create()
      .when('critical', (i) => i.message.includes('CRIT'), pausingAgent('critical'))
      .otherwise(
        'normal',
        Agent.create({
          provider: scripted(resp('ok')),
          model: 'mock',
        })
          .system('')
          .build(),
      )
      .build();

    const paused = await cond.run({ message: 'CRIT action' });
    expect(isPaused(paused)).toBe(true);
  });

  it('non-critical path does not pause', async () => {
    const cond = Conditional.create()
      .when('critical', (i) => i.message.includes('CRIT'), pausingAgent('critical'))
      .otherwise(
        'normal',
        Agent.create({ provider: scripted(resp('normal-done')), model: 'mock' })
          .system('')
          .build(),
      )
      .build();

    const out = await cond.run({ message: 'just hi' });
    expect(isPaused(out)).toBe(false);
    expect(out).toBe('normal-done');
  });
});

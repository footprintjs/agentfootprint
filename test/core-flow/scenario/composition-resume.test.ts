/**
 * A paused agent inside a Conditional / Parallel that is itself a step of a
 * Sequence resumes WITH the composition's continuation (footprintjs 9.28.0 —
 * "resume walks the real chart").
 *
 * Pattern: Test-as-specification, scenario style — real compositions, a
 *          scripted provider, a tool that pauses.
 * Role:    Pin the visible change the dependency bump brought. Before 9.28.0 a
 *          pause two subflows deep whose inner mount was dispatched inside the
 *          outer subflow lost the outer continuation: `Sequence(Conditional(
 *          agent))` lost its Finalize, `Sequence(Parallel(agent, other))` its
 *          Merge — the resumed run ended without the composition's result.
 *
 * Test types (Convention 3): integration / regression.
 */

import { describe, expect, it } from 'vitest';

import { Agent } from '../../../src/core/Agent.js';
import { Conditional } from '../../../src/core-flow/Conditional.js';
import { Parallel } from '../../../src/core-flow/Parallel.js';
import { Sequence } from '../../../src/core-flow/Sequence.js';
import { isPaused, pauseHere } from '../../../src/core/pause.js';
import type { LLMProvider, LLMResponse } from '../../../src/adapters/types.js';

const resp = (
  content: string,
  toolCalls: readonly { id: string; name: string; args: Record<string, unknown> }[] = [],
): LLMResponse => ({
  content,
  toolCalls,
  usage: { input: 0, output: 1 },
  stopReason: toolCalls.length > 0 ? 'tool_use' : 'stop',
});

const scripted = (...responses: readonly LLMResponse[]): LLMProvider => {
  let i = 0;
  return { name: 'mock', complete: async () => responses[Math.min(i++, responses.length - 1)]! };
};

const text = (reply: string): LLMProvider => scripted(resp(reply));

/** An agent whose one tool pauses for a human, then answers 'approved'. */
const asksAHuman = () =>
  Agent.create({
    provider: scripted(resp('', [{ id: 't1', name: 'approve', args: {} }]), resp('approved')),
    model: 'mock',
  })
    .system('')
    .tool({
      schema: { name: 'approve', description: '', inputSchema: { type: 'object' } },
      execute: () => {
        pauseHere({ question: 'Approve?' });
        return '';
      },
    })
    .build();

const plain = (reply: string) =>
  Agent.create({ provider: text(reply), model: 'mock' })
    .system('')
    .build();

describe('composition resume — the continuation runs (footprintjs 9.28.0)', () => {
  it('Sequence(Conditional(agent)): Finalize runs, and the next step reads its result', async () => {
    const cond = Conditional.create()
      .when('gate', () => true, asksAHuman())
      .otherwise('fallback', plain('fallback'))
      .build();
    const seq = Sequence.create().step('route', cond).step('after', plain('after-ran')).build();

    const paused = await seq.run({ message: 'go' });
    expect(isPaused(paused)).toBe(true);
    if (!isPaused(paused)) return;
    const resumed = await seq.resume(paused.checkpoint, { approved: true });
    expect(resumed).toBe('after-ran');
  });

  it('Sequence(Parallel(agent, other)): Merge runs once, after the answer', async () => {
    const merged: Record<string, string>[] = [];
    const par = Parallel.create()
      .branch('gate', asksAHuman())
      .branch('other', plain('other-ran'))
      .mergeWithFn((results) => {
        merged.push({ ...results });
        return `merged:${results.gate}+${results.other}`;
      })
      .build();
    const seq = Sequence.create().step('fan', par).build();

    const paused = await seq.run({ message: 'go' });
    expect(isPaused(paused)).toBe(true);
    if (!isPaused(paused)) return;
    const resumed = await seq.resume(paused.checkpoint, { approved: true });
    expect(resumed).toBe('merged:approved+other-ran');
    expect(merged).toEqual([{ gate: 'approved', other: 'other-ran' }]);
  });
});

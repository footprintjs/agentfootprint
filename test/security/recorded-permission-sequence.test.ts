import { describe, expect, it } from 'vitest';
import type { LLMMessage, ToolCallEntry } from '../../src/provider-contract/types.js';
import {
  extractSequence,
  extractSequenceForPolicy,
  SYNTHETIC_DENY_PREFIX,
} from '../../src/security/extractSequence.js';

const reused = 'sample-1';
const first = { id: reused, name: 'first_sample', args: { label: 'first' } };
const second = { id: reused, name: 'second_sample', args: { label: 'second' } };
const inner = {
  toolCallId: 'inner-sample',
  toolName: 'nested_sample',
  args: { label: 'shown' },
} as const;

function proposals(...toolCalls: NonNullable<LLMMessage['toolCalls']>): LLMMessage {
  return { role: 'assistant', content: '', toolCalls };
}

function result(call: typeof first, content: string, calls?: LLMMessage['calls']): LLMMessage {
  return {
    role: 'tool',
    toolCallId: call.id,
    toolName: call.name,
    content,
    ...(calls && { calls }),
  };
}

function entry(call: typeof first, iteration: number): ToolCallEntry {
  return { name: call.name, args: call.args, iteration };
}

const denied = `${SYNTHETIC_DENY_PREFIX} fixture]`;

describe('sequence projection from recorded tool results', () => {
  it('omits a custom refusal when the record says the tool was never entered', () => {
    const refused: LLMMessage = {
      ...result(first, 'The sample is unavailable.'),
      toolResultOrigin: 'not-entered',
      outcome: 'refused',
    };
    expect(extractSequence([proposals(first), refused], 1)).toEqual([]);
  });

  it('retains a refusal outcome without an origin or the legacy marker as a known limit', () => {
    const unmarked: LLMMessage = {
      ...result(first, 'The sample is unavailable.'),
      outcome: 'refused',
    };
    expect(extractSequence([proposals(first), unmarked], 1)).toEqual([entry(first, 1)]);
  });

  it('omits a cancellation with a recorded input-cancelled origin', () => {
    const cancelled: LLMMessage = {
      ...result(first, 'Sample input cancelled.'),
      toolResultOrigin: 'input-cancelled',
    };
    expect(extractSequence([proposals(first), cancelled], 1)).toEqual([]);
  });

  it('retains an unmarked cancellation under the existing fallback', () => {
    const unmarked = result(first, 'Sample input cancelled.');
    expect(extractSequence([proposals(first), unmarked], 1)).toEqual([entry(first, 1)]);
  });

  it('retains a possible dispatch when its recorded origin is outcome-unknown', () => {
    const unknown: LLMMessage = {
      ...result(first, denied),
      toolResultOrigin: 'outcome-unknown',
    };
    expect(extractSequence([proposals(first), unknown], 1)).toEqual([entry(first, 1)]);
  });

  it.each([
    ['an earlier refusal', [proposals(first), result(first, denied)]],
    ['an earlier open proposal', [proposals(first)]],
  ] satisfies [string, LLMMessage[]][])('keeps only the owned result after %s', (_, prior) => {
    const history = [...prior, proposals(second), result(second, 'sample', [inner])];
    expect(extractSequence(history, 2)).toEqual([
      entry(second, 2),
      { name: inner.toolName, args: inner.args, iteration: 2, inner: true },
    ]);
  });

  it('keeps an earlier completed result when a later occurrence is refused', () => {
    const history = [
      proposals(first),
      result(first, 'sample', [inner]),
      proposals(second),
      result(second, denied),
    ];
    expect(extractSequence(history, 2)).toEqual([
      entry(first, 1),
      { name: inner.toolName, args: inner.args, iteration: 1, inner: true },
    ]);
    expect(extractSequenceForPolicy(history, 2, () => ({ label: 'working' }))).toEqual([
      entry(first, 1),
      { name: inner.toolName, args: { label: 'working' }, iteration: 1, inner: true },
    ]);
  });

  it('consumes the answer of each proposal in recorded batch order', () => {
    const history = [
      proposals(first, second),
      result(first, denied),
      result(second, 'sample', [inner]),
    ];
    expect(extractSequence(history, 1)).toEqual([
      entry(second, 1),
      { name: inner.toolName, args: inner.args, iteration: 1, inner: true },
    ]);
  });

  it('keeps results with their proposals across a restored history', () => {
    const priorSecond = { ...second, id: 'sample-2' };
    const laterFirst = { ...second, name: 'restored_first_sample' };
    const laterSecond = { ...priorSecond, name: 'restored_second_sample' };
    const restored: { history: LLMMessage[] } = JSON.parse(
      JSON.stringify({
        history: [
          proposals(first, priorSecond),
          result(first, 'sample', [inner]),
          {
            ...result(priorSecond, 'settled'),
            notDispatched: { pausedCall: { toolCallId: first.id, toolName: first.name } },
          },
        ],
      }),
    );
    const history = [
      ...restored.history,
      { role: 'user', content: 'continue sample' } as const,
      proposals(laterFirst, laterSecond),
      result(laterFirst, denied),
      result(laterSecond, 'sample'),
    ];
    expect(extractSequence(history, 2)).toEqual([
      entry(first, 1),
      { name: inner.toolName, args: inner.args, iteration: 1, inner: true },
      entry(laterSecond, 2),
    ]);
  });
});

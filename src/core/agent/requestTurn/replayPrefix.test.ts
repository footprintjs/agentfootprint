import { describe, expect, it } from 'vitest';
import type { LLMMessage } from '../../../provider-contract/types.js';
import type { MessageReplay } from '../../../thinking/replay.js';
import { captureReplayPrefix, restoreReplayPrefix } from './replayPrefix.js';

const user = (content: string): LLMMessage => ({ role: 'user', content });
const tool = (toolCallId: string, content: string): LLMMessage => ({
  role: 'tool',
  toolCallId,
  content,
});
const note = (content: string) => ({ reason: 'test-note', message: user(content) });
const replay = (id: string): MessageReplay => ({
  version: 1,
  protocol: 'anthropic-messages',
  id,
  layout: [],
  stopReason: 'tool_use',
  contentDigest: `${id}-digest`,
});
const assistant = (record: MessageReplay): LLMMessage => ({
  role: 'assistant',
  content: '',
  replay: record,
});

describe('library contributions to an unfinished tool turn', () => {
  const initial = user('Original question');
  const first = assistant(replay('first'));
  const second = assistant(replay('second'));
  const result = tool('t1', 'Tool bytes');
  const ticket = tool('t1', 'First ticket');
  const later = tool('t2', 'New tool bytes');
  const earlierLine = note('First DATA');
  const secondLine = note('Second DATA');
  const initialFrame = captureReplayPrefix(first.replay!, [initial], [initial], [earlierLine], 0);
  const nextFrame = captureReplayPrefix(
    second.replay!,
    [initial, first, result],
    [initial, first, ticket],
    [secondLine],
    2,
  );

  it('keeps each library line at its original anchor and renders only new results afresh', () => {
    const history = [initial, first, result, second, later];
    const freshTicket = tool('t2', 'Fresh ticket');
    const rendered = [initial, first, tool('t1', 'Different ticket'), second, freshTicket];
    const frames = JSON.parse(JSON.stringify([initialFrame, nextFrame]));
    const projection = restoreReplayPrefix(history, rendered, frames);
    expect(projection).toEqual({
      history: [initial, first, ticket, second, freshTicket],
      wire: [initial, earlierLine.message, first, ticket, secondLine.message, second, freshTicket],
      historyPositions: [0, undefined, 1, 2, undefined, 3, 4],
      additions: [
        { ...earlierLine, wireIndex: 1 },
        { ...secondLine, wireIndex: 4 },
      ],
      frozenBefore: 4,
    });
    expect(history[2]).toBe(result);
  });

  it('keeps the content originally sent when a later judgement would first substitute it', () => {
    const rawFrame = captureReplayPrefix(
      second.replay!,
      [initial, first, result],
      [initial, first, result],
      [],
      2,
    );
    const restored = restoreReplayPrefix(
      [initial, first, result, second],
      [initial, first, ticket, second],
      [initialFrame, rawFrame],
    );
    expect(restored?.history[2]).toBe(result);
  });

  it('leaves a caller edit visible instead of replacing it with the old projection', () => {
    const edited = tool('t1', 'Caller changed the body');
    const restored = restoreReplayPrefix(
      [initial, first, edited, second],
      [initial, first, ticket, second],
      [initialFrame, nextFrame],
    );
    expect(restored?.history[2]).toBe(edited);
  });

  it.each([
    ['missing', [initial, first, result]],
    ['reordered', [initial, second, result, first]],
    ['duplicate', [initial, first, result, second, second]],
    [
      'changed identity',
      [initial, first, result, assistant({ ...second.replay!, contentDigest: 'changed' })],
    ],
  ] as const)('does not relocate old notes when an anchor is %s', (_reason, history) => {
    expect(restoreReplayPrefix(history, history, [initialFrame, nextFrame])).toBeUndefined();
  });
});

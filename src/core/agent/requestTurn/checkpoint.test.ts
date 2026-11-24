import { describe, expect, it } from 'vitest';
import { FINDINGS_DATA_FRAME_PREFIX } from '../../../lib/saidByPerson.js';
import { sha256Hex } from '../../../lib/sha256.js';
import type { LLMMessage } from '../../../provider-contract/types.js';
import type { MessageReplay } from '../../../thinking/replay.js';
import { admitRequestReplayCheckpoint, captureRequestReplayCheckpoint } from './checkpoint.js';
import type { ReplayPrefixFrame } from './replayPrefix.js';

const signed = (id: string, contentDigest: string): MessageReplay => ({
  version: 1,
  protocol: 'anthropic-messages',
  id,
  contentDigest,
  stopReason: 'tool_use',
  layout: [{ type: 'thinking', index: 0 }],
  binding: {
    model: 'claude-sonnet-5-5',
    salt: id,
    system: 's',
    tools: 't',
    messages: 'm',
    priorThinking: [],
  },
});

const first: ReplayPrefixFrame = {
  id: 'first',
  contentDigest: 'a'.repeat(64),
  libraryMessages: [
    {
      reason: 'findings-data',
      message: { role: 'user', content: `${FINDINGS_DATA_FRAME_PREFIX}\n{}` },
    },
  ],
  toolProjections: [],
};
const result: LLMMessage = { role: 'tool', toolCallId: 'lookup', content: 'tool result' };
const second: ReplayPrefixFrame = {
  id: 'second',
  contentDigest: 'b'.repeat(64),
  libraryMessages: [],
  toolProjections: [
    { distance: 1, toolCallId: 'lookup', original: sha256Hex(result.content), content: 'ticket' },
  ],
};
const assistant = (frame: ReplayPrefixFrame): LLMMessage => ({
  role: 'assistant',
  content: '',
  replay: signed(frame.id, frame.contentDigest),
});
const history = [assistant(first), result, assistant(second)];
const end: LLMMessage = {
  role: 'assistant',
  content: 'Finished',
  replay: { ...signed('end', 'c'.repeat(64)), stopReason: 'end_turn' },
};

describe('crash continuation replay carrier', () => {
  it('carries detached deltas for anchored tool responses through JSON', () => {
    const captured = captureRequestReplayCheckpoint({ requestReplay: [first, second] }, history);
    expect(captured).toEqual([first, second]);
    expect(captured?.[0]).not.toBe(first);
    const saved: unknown = JSON.parse(JSON.stringify({ requestReplay: captured }));
    expect(admitRequestReplayCheckpoint(saved, history)).toEqual([first, second]);
    expect(admitRequestReplayCheckpoint({}, history)).toBeUndefined();
  });

  it('omits uncommitted suffixes and never promotes a private closure', () => {
    expect(
      captureRequestReplayCheckpoint({ requestReplay: [first, second] }, history.slice(0, 2)),
    ).toEqual([first]);
    expect(
      captureRequestReplayCheckpoint({ requestReplay: [first, second, { closing: end }] }, history),
    ).toEqual([first, second]);
    expect(
      captureRequestReplayCheckpoint({ requestReplay: [first, second] }, [...history, end]),
    ).toBeUndefined();
    expect(() =>
      admitRequestReplayCheckpoint({ requestReplay: [first, { closing: end }] }, history),
    ).toThrow(/requestReplay is malformed/);
  });

  it('rejects missing or duplicate anchors and different tool bytes', () => {
    const saved = { requestReplay: [first, second] };
    for (const changed of [
      history.slice(0, 2),
      [...history, assistant(first)],
      [assistant(first), { ...result, content: 'changed result' }, assistant(second)],
    ]) {
      expect(() => admitRequestReplayCheckpoint(saved, changed)).toThrow(
        /requestReplay is malformed/,
      );
    }
  });

  it('rejects non-data and oversized values without evaluating a getter', () => {
    let reads = 0;
    const getter = {
      get requestReplay() {
        reads++;
        return [first];
      },
    };
    for (const saved of [
      getter,
      {
        requestReplay: [
          {
            ...first,
            get libraryMessages() {
              reads++;
              return [];
            },
          },
        ],
      },
      { requestReplay: [{ ...first, id: 'x'.repeat(8 * 1024 * 1024) }] },
      { requestReplay: undefined },
    ]) {
      expect(() => admitRequestReplayCheckpoint(saved, history)).toThrow(
        /requestReplay is malformed/,
      );
    }
    const getterHistory = [
      {
        ...assistant(first),
        get replay() {
          reads++;
          return signed(first.id, first.contentDigest);
        },
      },
    ];
    expect(() => admitRequestReplayCheckpoint({ requestReplay: [first] }, getterHistory)).toThrow(
      /requestReplay is malformed/,
    );
    expect(reads).toBe(0);
  });
});

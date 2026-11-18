import { describe, expect, it, vi } from 'vitest';
import type {
  MessageOutcome,
  ToolOutcome,
  ToolResultOutcome,
} from '../core/agent/middleware/types.js';
import { runMessageChain, runToolAfterChain, runToolChain } from './runChain.js';

const args = { category: 'sample' };
const input = {
  toolName: 'fixture',
  toolCallId: 'fixture-1',
  iteration: 1,
  args,
  history: [],
};

describe('middleware answers at the shared walker', () => {
  it.each([undefined, null, {}, { kind: 'unfamiliar', detail: 'fixture detail' }])(
    'stops at an unrecognised before-tool answer (%j)',
    async (answer) => {
      const next = vi.fn((): ToolOutcome => ({ kind: 'allow' }));
      const result = await runToolChain(
        [
          { name: 'first', onToolCall: () => ({ kind: 'allow' }) },
          { name: 'sample', onToolCall: () => answer as ToolOutcome },
          { name: 'later', onToolCall: next },
        ],
        input,
      );
      expect(next).not.toHaveBeenCalled();
      expect(result.kind).toBe('deny');
      expect(result.args).toBe(args);
      expect(result.decisions).toEqual([
        expect.objectContaining({ middleware: 'first', outcome: 'allow' }),
        expect.objectContaining({
          middleware: 'sample',
          moment: 'before-tool',
          outcome: 'refused',
          changed: false,
          why: 'The library refused an unrecognised middleware answer.',
        }),
      ]);
      expect(JSON.stringify(result)).not.toContain('fixture detail');
    },
  );

  it('reads a recognised outcome tag once and keeps the rewrite', async () => {
    const replacement = { category: 'second sample' };
    const readKind = vi.fn(() => 'allow' as const);
    const outcome = {
      get kind() {
        return readKind();
      },
      value: replacement,
      why: 'Use the second sample.',
    };
    const result = await runToolChain([{ name: 'replace', onToolCall: () => outcome }], input);
    expect(readKind).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      kind: 'allow',
      args: replacement,
      decisions: [{ outcome: 'allow', before: args, after: replacement, changed: true }],
    });
  });

  it('keeps a middleware deny and a supported ask attributed to the link', async () => {
    const denied = await runToolChain(
      [{ name: 'deny', onToolCall: () => ({ kind: 'deny', reason: 'Use another sample.' }) }],
      input,
    );
    expect(denied).toMatchObject({
      kind: 'deny',
      reason: 'Use another sample.',
      decisions: [{ outcome: 'deny', why: 'Use another sample.' }],
    });

    const asking = await runToolChain(
      [
        {
          name: 'ask',
          onToolCall: () => ({
            kind: 'ask',
            payload: { question: 'Which sample?', detail: { options: ['first', 'second'] } },
          }),
        },
      ],
      input,
    );
    expect(asking).toMatchObject({
      kind: 'ask',
      payload: { question: 'Which sample?', detail: { options: ['first', 'second'] } },
      decisions: [{ outcome: 'ask', why: 'Which sample?' }],
    });
  });

  it('withholds an already-returned result when its middleware answer is unrecognised', async () => {
    const returned = { sample: 'value' };
    const next = vi.fn((): ToolResultOutcome => ({ kind: 'allow' }));
    const result = await runToolAfterChain(
      [
        { name: 'later', onToolResult: next },
        { name: 'sample', onToolResult: () => ({ kind: 'unfamiliar' } as ToolResultOutcome) },
      ],
      { ...input, result: returned },
    );
    expect(next).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      kind: 'deny',
      result: returned,
      decisions: [{ moment: 'after-tool', outcome: 'refused', changed: true, before: returned }],
    });
  });

  it('keeps an unrecognised message answer distinct from the existing unsupported ask', async () => {
    const input = { phase: 'output' as const, content: 'sample text', iteration: 1, history: [] };
    const replies = await Promise.all(
      [{ kind: 'unfamiliar' }, { kind: 'ask', payload: { question: 'Which sample?' } }].map(
        (answer) =>
          runMessageChain([{ name: 'sample', onMessage: () => answer as MessageOutcome }], input),
      ),
    );
    expect(replies).toMatchObject([
      { kind: 'deny', content: 'sample text', decisions: [{ outcome: 'refused' }] },
      { kind: 'deny', content: 'sample text', decisions: [{ outcome: 'deny' }] },
    ]);
  });
});

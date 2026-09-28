/**
 * The inputs layer beside the evidence gate — the two grounding laws, end to end.
 *
 * Test types (Convention 3):
 *   - INTEGRATION — under `.namesAndNumbersFromEvidence()` AND the layer, a
 *                   declared default the answer states is EXEMPT this turn (the
 *                   app's own declaration, read from the tool's rule — never
 *                   from the row), so an honest answer is not flagged;
 *   - SECURITY    — the library's NOTE grounds nothing: in a later turn that
 *                   filed no default row, the same value — present in history
 *                   only inside the earlier turn's note, behind the tool-bytes
 *                   boundary — is unsupported, exactly as if the note had never
 *                   been written. Without the boundary, the note would have
 *                   laundered an assumption into evidence.
 */

import { describe, expect, it } from 'vitest';

import { Agent, defineTool, type Tool } from '../../../../src/index.js';
import type { LLMRequest, LLMResponse } from '../../../../src/adapters/types.js';
import { answeredValuesOf } from '../../../../src/core/agent/stages/route.js';

function scripted(script: readonly { content: string; toolCalls?: unknown[] }[]) {
  let i = 0;
  return {
    name: 'gate-mock',
    complete: async (_req: LLMRequest): Promise<LLMResponse> => {
      const reply = script[Math.min(i, script.length - 1)]!;
      i += 1;
      return {
        content: reply.content,
        toolCalls: (reply.toolCalls ?? []) as never,
        usage: { input: 0, output: 0 },
      };
    },
  };
}

// The period value is spelled so the gate reads it as DATA: a number glued to a
// unit is judged on its number, which needs 4 digits (`evidence/extract.ts`) —
// `1440m`. The tool's own result never echoes it.
const searchLogs = (): Tool =>
  defineTool({
    name: 'search_logs',
    description: 'Error lines for one service over a look-back period.',
    inputSchema: {
      type: 'object',
      required: ['service', 'window'],
      properties: {
        service: { type: 'string' },
        window: { type: 'string', enum: ['1440m', '4320m'] },
      },
    },
    askOrAssume: { window: { assume: '1440m' } },
    execute: () => ({ errors: 0 }),
  }) as Tool;

const unsupportedOf = (agent: Agent): readonly string[] =>
  (agent.unsupportedValues()?.values ?? []).map((v) => v.value);

describe('the inputs layer beside the evidence gate', () => {
  it('this turn: the declared default the answer states is exempt — not flagged', async () => {
    const agent = Agent.create({
      provider: scripted([
        { content: '', toolCalls: [{ id: 'c1', name: 'search_logs', args: { service: 'api' } }] },
        { content: 'No errors on api in the last 1440m.' },
      ]) as never,
      model: 'm',
    })
      .tool(searchLogs())
      .namesAndNumbersFromEvidence({ posture: 'assist' })
      .build();
    await agent.run({ message: 'errors on api?' });
    expect(unsupportedOf(agent)).toEqual([]);

    // The control: the same answer from an agent whose tool buries the same
    // default in `execute` (no rule, so no layer) — the gate flags the value,
    // so the exemption above is what cleared it.
    const control = Agent.create({
      provider: scripted([
        {
          content: '',
          toolCalls: [{ id: 'c1', name: 'search_logs', args: { service: 'api', window: '1440m' } }],
        },
        { content: 'No errors on api in the last 1440m.' },
      ]) as never,
      model: 'm',
    })
      .tool({ ...searchLogs(), askOrAssume: undefined } as unknown as Tool)
      .namesAndNumbersFromEvidence({ posture: 'assist' })
      .build();
    await control.run({ message: 'errors on api?' });
    expect(unsupportedOf(control)).toContain('1440');
  });

  it('a later turn: the value lives only in the earlier note — the note grounds nothing', async () => {
    const first = Agent.create({
      provider: scripted([
        { content: '', toolCalls: [{ id: 'c1', name: 'search_logs', args: { service: 'api' } }] },
        { content: 'No errors on api.' },
      ]) as never,
      model: 'm',
    })
      .tool(searchLogs())
      .namesAndNumbersFromEvidence({ posture: 'assist' })
      .build();
    await first.run({ message: 'errors on api?' });
    const cp = first.checkpoint()!;
    // The note is in the carried history, after the tool's own bytes.
    const tool = cp.history.find((m) => m.role === 'tool')!;
    expect(tool.content).toContain('the call ran with "1440m"');
    expect(tool.toolChars).toBe('{"errors":0}'.length);

    const second = Agent.create({
      provider: scripted([{ content: 'That search covered the last 1440m.' }]) as never,
      model: 'm',
    })
      .tool(searchLogs())
      .namesAndNumbersFromEvidence({ posture: 'assist' })
      .build();
    await second.run({ message: 'what period was that?', continueFrom: cp });
    // No default row THIS turn, and the note is behind the boundary: unsupported.
    expect(unsupportedOf(second)).toContain('1440');
  });
});

describe('answeredValuesOf — the person’s answers, THIS turn, in the tool’s own view', () => {
  const row = (turn: number, source: string, value: string, argument = 'window') => ({
    kind: 'argument',
    turn,
    toolCallId: `c-${turn}-${value}`,
    toolName: 'search_logs',
    iteration: 1,
    argument,
    rule: 'ask',
    source,
    value,
  });

  it('reads only this turn’s `answered` rows — an earlier turn’s answer exempts nothing now', () => {
    const scope = {
      turnNumber: 2,
      findingsLedger: [
        row(1, 'answered', '4320m'),
        row(2, 'answered', '1440m'),
        row(2, 'answered', '1440m', 'other'),
        row(2, 'model', '9999m'),
        row(2, 'answered', 'REDACTED'),
        { kind: 'standing', turn: 2, value: '7777' },
      ],
    };
    expect(answeredValuesOf(scope as never)).toEqual(['1440m']);
  });
});

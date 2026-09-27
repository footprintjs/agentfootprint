/**
 * The kept answer and the ask's marker (honesty layer 2, step 4 review) — the
 * pure halves, judged without an agent: `arguments/kept.ts`, the layer's one
 * table filling from a kept answer (`resolve.ts`), and `arguments/askMarker.ts`.
 *
 * Test types (Convention 3):
 *   - UNIT     — a kept answer is read only in its own turn, one per
 *                (tool, argument), and dropped once used; the table fills a
 *                missing `ask` value from a kept answer (`answered`, `free` for
 *                a free-text field, the value in the tool's own view) and asks
 *                when the kept answer no longer fits the property; the marker
 *                recognises the library's ask and nothing else;
 *   - SECURITY — the resume event's projection of a reply to the library's ask
 *                keeps the shape (request id, field ids) and no value; a reader
 *                of every pause kind never throws on a shape it does not know.
 */

import { describe, expect, it } from 'vitest';

import { defineTool, type Tool } from '../../../../src/index.js';
import {
  keptAnswerFor,
  keptThisTurn,
  withKept,
  withoutUsed,
  type KeptAnswer,
} from '../../../../src/core/agent/arguments/kept.js';
import {
  declareBatch,
  resolutionsOf,
  rowsOf,
  verifyPlan,
  type BatchCall,
  type ToolOf,
} from '../../../../src/core/agent/arguments/resolve.js';
import {
  argumentAskReplyForEvent,
  isArgumentAskContext,
  isArgumentAskPause,
} from '../../../../src/core/agent/arguments/askMarker.js';
import { SHOWN_ARGS } from '../../../../src/core/toolShownArgs.js';

const kept = (
  toolName: string,
  argument: string,
  value: string | number,
  turn = 1,
): KeptAnswer => ({
  turn,
  toolName,
  argument,
  value,
});

describe('kept.ts — one answer per (tool, argument), this turn, used once', () => {
  it('reads only this turn’s entries, and never an entry of an unknown shape', () => {
    const list = [
      kept('purge_logs', 'window', '24h', 1),
      kept('purge_logs', 'window', '7d', 2),
      { turn: 1, toolName: 'x', argument: 'y', value: { raw: true } },
      { turn: 1, toolName: 'x' },
      null,
    ];
    expect(keptThisTurn(list, 1)).toEqual([kept('purge_logs', 'window', '24h', 1)]);
    expect(keptThisTurn(list, 2)).toEqual([kept('purge_logs', 'window', '7d', 2)]);
    expect(keptThisTurn(undefined, 1)).toEqual([]);
    expect(keptThisTurn('not a list', 1)).toEqual([]);
  });

  it('keeping a pair again replaces its earlier answer; other pairs stay', () => {
    const first = withKept(undefined, 1, 'purge_logs', [{ argument: 'window', value: '24h' }]);
    const second = withKept(first, 1, 'search_logs', [{ argument: 'window', value: '1h' }]);
    const third = withKept(second, 1, 'purge_logs', [{ argument: 'window', value: '7d' }]);
    expect(third).toEqual([
      kept('search_logs', 'window', '1h'),
      kept('purge_logs', 'window', '7d'),
    ]);
    expect(keptAnswerFor(third, 'purge_logs', 'window')?.value).toBe('7d');
    expect(keptAnswerFor(third, 'purge_logs', 'limit')).toBeUndefined();
  });

  it('keeping drops another turn’s entries', () => {
    const next = withKept([kept('purge_logs', 'window', '24h', 1)], 2, 'purge_logs', [
      { argument: 'limit', value: 5 },
    ]);
    expect(next).toEqual([kept('purge_logs', 'limit', 5, 2)]);
  });

  it('a used pair is dropped; nothing left clears the key (`undefined`, never an empty list)', () => {
    const list = [kept('purge_logs', 'window', '24h'), kept('search_logs', 'window', '1h')];
    expect(withoutUsed(list, 1, [{ toolName: 'purge_logs', argument: 'window' }])).toEqual([
      kept('search_logs', 'window', '1h'),
    ]);
    expect(
      withoutUsed(list, 1, [
        { toolName: 'purge_logs', argument: 'window' },
        { toolName: 'search_logs', argument: 'window' },
      ]),
    ).toBeUndefined();
  });
});

// ─── the layer's one table, filling from a kept answer ─────────────────

function purgeLogs(extra: Partial<Tool> = {}): Tool {
  const tool = defineTool({
    name: 'purge_logs',
    description: 'd',
    inputSchema: {
      type: 'object',
      properties: {
        service: { type: 'string' },
        window: { type: 'string', enum: ['1h', '24h'] },
        owner: { type: 'string' },
      },
    },
    askOrAssume: {
      window: { ask: 'Which period?', choices: ['1h', '24h'] },
      owner: { ask: 'Who owns it?' },
    },
    period: { argument: 'window', spelling: 'lookback' },
    execute: () => 'ok',
  });
  return { ...tool, ...extra } as Tool;
}

const call = (id: string, args: Record<string, unknown> = {}): BatchCall => ({
  id,
  name: 'purge_logs',
  args,
});
const toolOfList =
  (...tools: Tool[]): ToolOf =>
  (name) =>
    tools.find((t) => t.schema.name === name);
const STAMP = { turn: 1, iteration: 2 };

function table(toolOf: ToolOf, calls: readonly BatchCall[], answers?: readonly KeptAnswer[]) {
  const plan = declareBatch(calls, toolOf);
  const checked = verifyPlan(plan, calls, toolOf, answers);
  return {
    checked,
    rows: rowsOf(checked, calls, toolOf, STAMP, answers),
    resolutions: resolutionsOf(plan, checked, toolOf, STAMP.iteration, answers),
  };
}

describe('resolve.ts — a missing `ask` value the turn kept an answer for is FILLED, not asked', () => {
  it('fills the kept answer, files `answered` in the tool’s view, and asks only for the rest', () => {
    const toolOf = toolOfList(purgeLogs());
    const { rows, resolutions } = table(
      toolOf,
      [call('c2', { service: 'checkout' })],
      [kept('purge_logs', 'window', '24h')],
    );
    expect(rows).toEqual([
      {
        kind: 'argument',
        turn: 1,
        toolCallId: 'c2',
        toolName: 'purge_logs',
        iteration: 2,
        argument: 'window',
        rule: 'ask',
        period: true,
        source: 'answered',
        value: '24h',
      },
      {
        kind: 'argument',
        turn: 1,
        toolCallId: 'c2',
        toolName: 'purge_logs',
        iteration: 2,
        argument: 'owner',
        rule: 'ask',
        asked: 'missing',
      },
    ]);
    expect(resolutions).toEqual([
      {
        toolCallId: 'c2',
        iteration: 2,
        fills: [{ argument: 'window', value: '24h', source: 'answered' }],
        ask: ['owner'],
      },
    ]);
  });

  it('a kept free-text answer files `free: true`, as the answer did when it was given', () => {
    const { rows } = table(
      toolOfList(purgeLogs()),
      [call('c2', { window: '1h' })],
      [kept('purge_logs', 'owner', 'team-sre')],
    );
    expect(rows.find((r) => r.argument === 'owner')).toMatchObject({
      source: 'answered',
      value: 'team-sre',
      free: true,
    });
  });

  it('a hidden argument’s kept answer is on its row as the placeholder, never raw', () => {
    const hiding = purgeLogs({
      [SHOWN_ARGS]: (args: Record<string, unknown>) =>
        'owner' in args ? { ...args, owner: 'REDACTED' } : args,
    } as never);
    const { rows, resolutions } = table(
      toolOfList(hiding),
      [call('c2', { window: '1h' })],
      [kept('purge_logs', 'owner', 'OWNER-SECRET')],
    );
    expect(JSON.stringify(rows)).not.toContain('OWNER-SECRET');
    expect(rows.find((r) => r.argument === 'owner')).toMatchObject({
      source: 'answered',
      value: 'REDACTED',
    });
    // The raw value rides only the working-state entry the call runs with.
    expect(resolutions[0]!.fills).toEqual([
      { argument: 'owner', value: 'OWNER-SECRET', source: 'answered' },
    ]);
  });

  it('a kept answer that no longer fits the property is not used — the value is asked for', () => {
    const { rows, resolutions } = table(
      toolOfList(purgeLogs()),
      [call('c2', { owner: 'sre' })],
      [kept('purge_logs', 'window', '7d')],
    );
    expect(rows.find((r) => r.argument === 'window')).toMatchObject({ asked: 'missing' });
    expect(rows.some((r) => r.source === 'answered')).toBe(false);
    expect(resolutions).toEqual([{ toolCallId: 'c2', iteration: 2, ask: ['window'] }]);
  });

  it('no kept answer, or a present value: the table is the one it always was', () => {
    const toolOf = toolOfList(purgeLogs());
    const calls = [call('c2', { window: '1h' })];
    expect(table(toolOf, calls, [kept('purge_logs', 'window', '24h')])).toEqual(
      table(toolOf, calls),
    );
    expect(table(toolOf, [call('c3')], [kept('search_logs', 'window', '24h')])).toEqual(
      table(toolOf, [call('c3')]),
    );
  });
});

// ─── askMarker.ts — the library's own ask, recognised without the ask ───

describe('askMarker.ts — the reserved marker, and the reply the resume event may carry', () => {
  const pauseOf = (context: unknown) => ({
    reason: 'q',
    awaitingInput: { status: 'awaiting_input', context },
  });

  it('recognises the library’s ask, and nothing else — never throwing on a shape it does not know', () => {
    expect(isArgumentAskPause(pauseOf({ agentfootprint: { ask: 'arguments', fields: [] } }))).toBe(
      true,
    );
    for (const other of [
      pauseOf({ agentfootprint: { ask: 'spoof' } }),
      pauseOf({ routing: { step: 'x' } }),
      pauseOf(undefined),
      pauseOf([{ agentfootprint: { ask: 'arguments' } }]),
      { checkIn: { toolName: 't' } },
      { awaitingInput: 'not an object' },
      'a string',
      null,
      undefined,
    ]) {
      expect(isArgumentAskPause(other)).toBe(false);
    }
    expect(isArgumentAskContext({ agentfootprint: { ask: 'arguments' } })).toBe(true);
    expect(isArgumentAskContext({ agentfootprint: ['arguments'] })).toBe(false);
  });

  it('keeps the reply’s shape and replaces every value — and anything unknown — with the placeholder', () => {
    expect(
      argumentAskReplyForEvent({
        status: 'input_received',
        requestId: 'r1',
        values: { f1: 'ACCT-1', f2: 4321 },
        origins: { f1: 'response', f2: 'response' },
        smuggled: 'ACCT-1',
      }),
    ).toEqual({
      status: 'input_received',
      requestId: 'r1',
      values: { f1: 'REDACTED', f2: 'REDACTED' },
      origins: { f1: 'response', f2: 'response' },
      smuggled: 'REDACTED',
    });
    // A raw InputResponse (a composition's resume) and a bare value alike.
    expect(argumentAskReplyForEvent({ requestId: 'r1', values: { f1: 'ACCT-1' } })).toEqual({
      requestId: 'r1',
      values: { f1: 'REDACTED' },
    });
    expect(argumentAskReplyForEvent('ACCT-1')).toEqual({ input: 'REDACTED' });
    expect(argumentAskReplyForEvent({ values: 'ACCT-1' })).toEqual({ values: 'REDACTED' });
  });
});

/**
 * The inputs layer's batch ask (honesty layer 2, step 4) — the pure half:
 * `arguments/ask.ts`, judged without an agent.
 *
 * Test types (Convention 3):
 *   - UNIT        — the declaration always passes `validateInputDeclaration`;
 *                   the fixed question; positional ids; `context` within 16384
 *                   characters, carrying no model value; the host hook refused
 *                   when it uses the reserved key or is not a plain object; two
 *                   period arguments share a field only when every converted
 *                   choice is valid for both; an `iso-range` never merges; the
 *                   re-check against the property's own schema; the bound;
 *   - SECURITY    — over any model output, the ask carries none of the model's
 *                   values or choices;
 *   - PERFORMANCE — building the ask over 32 fields;
 *   - LOAD        — a batch that needs 40 fields asks in two rounds and binds
 *                   all 40.
 */

import { describe, expect, it } from 'vitest';

import { defineTool, type Tool } from '../../../../src/index.js';
import {
  applyInputResponse,
  InputRequestError,
  stampInputRequest,
  validateInputDeclaration,
} from '../../../../src/core/inputRequest.js';
import {
  ARGUMENT_ASK_QUESTION,
  ARGUMENT_REASK_QUESTION,
  ASK_CONTEXT_CHARS,
  ASK_CONTEXT_KEY,
  MAX_ASK_FIELDS,
  MAX_ASK_ROUNDS,
  argumentAskDeclaration,
  bindAnswer,
  checkAnswer,
  convertSpelling,
  initialAskState,
  isArgumentAsk,
  judgeAskContextHook,
  nextAskRound,
  periodsShareField,
  planAskFields,
  readAskAnswer,
  settledCalls,
  withWaiting,
  type ArgumentAskState,
  type AskField,
} from '../../../../src/core/agent/arguments/ask.js';
import type { BatchCall, ToolOf } from '../../../../src/core/agent/arguments/resolve.js';
import {
  answeredRowOf,
  argumentRowIsWellFormed,
  askedRowOf,
} from '../../../../src/core/agent/arguments/rows.js';
import { SHOWN_ARGS } from '../../../../src/core/toolShownArgs.js';

// ─── fixtures ────────────────────────────────────────────────────────

/** mulberry32 — a tiny seeded PRNG (the repo carries no property-testing library). */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lookbackTool(
  name: string,
  choices: readonly string[],
  spelling: 'lookback' | 'signed-lookback' | 'iso-range',
): Tool {
  return defineTool({
    name,
    description: `${name}.`,
    inputSchema: {
      type: 'object',
      required: ['host', 'window'],
      properties: {
        host: { type: 'string' },
        window: { type: 'string', enum: [...choices] },
      },
    },
    askOrAssume: { window: { ask: `Which period should ${name} cover?`, choices: [...choices] } },
    period: { argument: 'window', spelling },
    execute: () => 'ok',
  });
}

const limitTool = (): Tool =>
  defineTool({
    name: 'top_talkers',
    description: 'd',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        site: { type: 'string', pattern: '^[a-z]{3}(-[0-9])?$' },
      },
    },
    askOrAssume: {
      limit: { ask: 'How many rows?' },
      site: { ask: 'Which site?' },
    },
    execute: () => 'ok',
  });

const toolOfList =
  (...tools: Tool[]): ToolOf =>
  (name) =>
    tools.find((t) => t.schema.name === name);

const call = (id: string, name: string, args: Record<string, unknown> = {}): BatchCall => ({
  id,
  name,
  args,
});

function waitingState(state: ArgumentAskState, round = nextAskRound(state)!): ArgumentAskState {
  const { declaration, fieldIndexes } = argumentAskDeclaration(state, round);
  const awaiting = stampInputRequest(declaration, `req-${state.progress.length}-${Math.random()}`, {
    originalRequest: 'q',
    toolCallId: 'c1',
  });
  return withWaiting(state, { requestId: awaiting.requestId, fieldIndexes, awaiting });
}

const STAMP = { turn: 1, iteration: 1 };

// ─── UNIT — the fields ───────────────────────────────────────────────

describe('planAskFields — one field per distinct (tool, argument), bound to every call', () => {
  it('two calls of one tool missing `window` share ONE field bound to both', () => {
    const tool = lookbackTool('search_logs', ['1h', '24h'], 'lookback');
    const fields = planAskFields(
      [
        { toolCallId: 'c1', ask: ['window'] },
        { toolCallId: 'c2', ask: ['window'] },
      ],
      [call('c1', 'search_logs'), call('c2', 'search_logs')],
      toolOfList(tool),
    );
    expect(fields).toHaveLength(1);
    expect(fields[0]!.members).toEqual([
      {
        toolName: 'search_logs',
        argument: 'window',
        period: true,
        spelling: 'lookback',
        toolCallIds: ['c1', 'c2'],
      },
    ]);
  });

  it('an integer asks as a number; a free string field has no choices', () => {
    const fields = planAskFields(
      [{ toolCallId: 'c1', ask: ['limit', 'site'] }],
      [call('c1', 'top_talkers')],
      toolOfList(limitTool()),
    );
    expect(fields.map((f) => [f.type, f.choices])).toEqual([
      ['number', undefined],
      ['string', undefined],
    ]);
  });

  it('a name whose rules cannot be read is left out (the dispatch re-read refuses its call)', () => {
    const fields = planAskFields(
      [{ toolCallId: 'c1', ask: ['window'] }],
      [call('c1', 'nobody')],
      toolOfList(),
    );
    expect(fields).toEqual([]);
  });
});

describe('the one period shape — shared fields and spellings', () => {
  it('converts only between lookback and signed-lookback, by the leading minus', () => {
    expect(convertSpelling('24h', 'lookback', 'signed-lookback')).toBe('-24h');
    expect(convertSpelling('-30m', 'signed-lookback', 'lookback')).toBe('30m');
    expect(convertSpelling('24h', 'lookback', 'lookback')).toBe('24h');
    expect(
      convertSpelling('2026-01-01T00:00Z..2026-01-02T00:00Z', 'iso-range', 'lookback'),
    ).toBeUndefined();
    expect(convertSpelling('last week', 'lookback', 'signed-lookback')).toBeUndefined();
  });

  it('two period arguments share a field when every converted choice is valid for both', () => {
    const a = lookbackTool('io_profile', ['1h', '24h'], 'lookback');
    const b = lookbackTool('net_flows', ['-1h', '-24h'], 'signed-lookback');
    const fields = planAskFields(
      [
        { toolCallId: 'c1', ask: ['window'] },
        { toolCallId: 'c2', ask: ['window'] },
      ],
      [call('c1', 'io_profile'), call('c2', 'net_flows')],
      toolOfList(a, b),
    );
    expect(fields).toHaveLength(1);
    expect(fields[0]!.choices).toEqual(['1h', '24h']);
    expect(fields[0]!.members.map((m) => [m.toolName, m.spelling])).toEqual([
      ['io_profile', 'lookback'],
      ['net_flows', 'signed-lookback'],
    ]);
  });

  it('…and stay separate when one choice has no twin', () => {
    const a = lookbackTool('io_profile', ['1h', '24h', '7d'], 'lookback');
    const b = lookbackTool('net_flows', ['-1h', '-24h'], 'signed-lookback');
    const fields = planAskFields(
      [
        { toolCallId: 'c1', ask: ['window'] },
        { toolCallId: 'c2', ask: ['window'] },
      ],
      [call('c1', 'io_profile'), call('c2', 'net_flows')],
      toolOfList(a, b),
    );
    expect(fields).toHaveLength(2);
  });

  it('an iso-range period never merges — not even with another iso-range', () => {
    const range = '2026-01-01T00:00Z..2026-01-02T00:00Z';
    const a = lookbackTool('packets_a', [range], 'iso-range');
    const b = lookbackTool('packets_b', [range], 'iso-range');
    const fields = planAskFields(
      [
        { toolCallId: 'c1', ask: ['window'] },
        { toolCallId: 'c2', ask: ['window'] },
      ],
      [call('c1', 'packets_a'), call('c2', 'packets_b')],
      toolOfList(a, b),
    );
    expect(fields).toHaveLength(2);
  });

  it('a field with no choices never shares (nothing proves every value fits both)', () => {
    const f = (spelling: 'lookback' | 'signed-lookback'): AskField => ({
      type: 'string',
      question: 'q',
      spelling,
      members: [],
    });
    expect(periodsShareField(f('lookback'), f('signed-lookback'))).toBe(false);
  });
});

// ─── UNIT — the declaration ──────────────────────────────────────────

describe('argumentAskDeclaration — the typed ask for one round', () => {
  const tool = lookbackTool('search_logs', ['1h', '24h', '7d'], 'lookback');
  const state = initialAskState(
    1,
    planAskFields(
      [
        { toolCallId: 'c1', ask: ['window'] },
        { toolCallId: 'c2', ask: ['window'] },
      ],
      [call('c1', 'search_logs'), call('c2', 'search_logs')],
      toolOfList(tool),
    ),
  );

  it('passes the typed ask’s own validator, with the fixed question and positional ids', () => {
    const { declaration } = argumentAskDeclaration(state, nextAskRound(state)!);
    expect(() => validateInputDeclaration(declaration)).not.toThrow();
    expect(declaration.question).toBe(ARGUMENT_ASK_QUESTION);
    expect(declaration.fields).toEqual([
      {
        id: 'f1',
        type: 'string',
        required: true,
        description: 'Which period should search_logs cover?',
        enum: ['1h', '24h', '7d'],
      },
    ]);
    expect(declaration.context).toEqual({
      [ASK_CONTEXT_KEY]: {
        ask: 'arguments',
        fields: [{ id: 'f1', tool: 'search_logs', argument: 'window', calls: ['c1', 'c2'] }],
      },
    });
    expect(declaration.supplied).toBeUndefined();
  });

  it('a re-ask carries the second fixed question', () => {
    expect(
      argumentAskDeclaration(state, { fieldIndexes: [0], reask: true }).declaration.question,
    ).toBe(ARGUMENT_REASK_QUESTION);
  });

  it('spreads the host’s context beside the reserved key', () => {
    const { declaration } = argumentAskDeclaration(state, nextAskRound(state)!, {
      routing: { step: 'metrics' },
    });
    expect(declaration.context).toMatchObject({ routing: { step: 'metrics' } });
    expect(
      isArgumentAsk(
        stampInputRequest(declaration, 'r', { originalRequest: 'q', toolCallId: 'c1' }),
      ),
    ).toBe(true);
  });

  it('keeps the context within 16384 characters: fewer fields in the round, or fewer calls listed', () => {
    const wide = lookbackTool('search_logs', ['1h'], 'lookback');
    const ids = Array.from({ length: 1200 }, (_, i) => `call_${String(i).padStart(6, '0')}`);
    const big = initialAskState(
      1,
      planAskFields(
        ids.map((id) => ({ toolCallId: id, ask: ['window'] })),
        ids.map((id) => call(id, 'search_logs')),
        toolOfList(wide),
      ),
    );
    const { declaration } = argumentAskDeclaration(big, nextAskRound(big)!);
    expect(() => validateInputDeclaration(declaration)).not.toThrow();
    expect(JSON.stringify(declaration.context).length).toBeLessThanOrEqual(ASK_CONTEXT_CHARS);
    const listed = (declaration.context as never)[ASK_CONTEXT_KEY]['fields'][0];
    expect(listed.calls.length + listed.moreCalls).toBe(1200);
  });
});

describe('judgeAskContextHook — the host’s own context', () => {
  it('refuses the reserved key, naming the option', () => {
    expect(() => judgeAskContextHook({ [ASK_CONTEXT_KEY]: { ask: 'x' } })).toThrow(
      /argumentAskContext: returned the reserved key 'agentfootprint'/,
    );
  });
  it('refuses a value that is not a plain object', () => {
    expect(() => judgeAskContextHook(['a'])).toThrow(/plain JSON object/);
    expect(() => judgeAskContextHook(new Map())).toThrow(/plain JSON object/);
    expect(() => judgeAskContextHook(undefined)).toThrow(/plain JSON object/);
    expect(() => judgeAskContextHook({ at: new Date() })).toThrow(/plain JSON object/);
    expect(() => judgeAskContextHook({ run: () => 1 })).toThrow(/plain JSON object/);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => judgeAskContextHook(cyclic)).toThrow(/plain JSON object/);
  });
  it('accepts a plain JSON object', () => {
    expect(judgeAskContextHook({ routing: 'x' })).toEqual({ routing: 'x' });
  });
  it('a hook object too large for the context is refused when the ask is built', () => {
    const tool = lookbackTool('search_logs', ['1h'], 'lookback');
    const state = initialAskState(
      1,
      planAskFields(
        [{ toolCallId: 'c1', ask: ['window'] }],
        [call('c1', 'search_logs')],
        toolOfList(tool),
      ),
    );
    expect(() =>
      argumentAskDeclaration(state, nextAskRound(state)!, { blob: 'x'.repeat(ASK_CONTEXT_CHARS) }),
    ).toThrow(/exceeds the ask's 16384-character context bound/);
  });
});

// ─── UNIT — the answer ───────────────────────────────────────────────

describe('bindAnswer — the re-check against the property’s own schema, and the bound', () => {
  const tool = limitTool();
  const toolOf = toolOfList(tool);
  const calls = [call('c1', 'top_talkers', { site: 'lon' })];
  const fresh = () =>
    initialAskState(1, planAskFields([{ toolCallId: 'c1', ask: ['limit'] }], calls, toolOf));

  it('an integer answered 2.5 is not bound: an invalid-answer row, asked again', () => {
    const state = waitingState(fresh());
    const bound = bindAnswer(state, { f1: 2.5 }, calls, toolOf, STAMP);
    expect(bound.rows).toEqual([
      {
        kind: 'argument',
        turn: 1,
        toolCallId: 'c1',
        toolName: 'top_talkers',
        iteration: 1,
        argument: 'limit',
        rule: 'ask',
        asked: 'invalid-answer',
      },
    ]);
    expect(bound.state.waiting).toBeUndefined();
    expect(bound.state.progress[0]).toMatchObject({
      rounds: 1,
      invalid: true,
      expected: 'integer',
    });
    expect(nextAskRound(bound.state)).toEqual({ fieldIndexes: [0], reask: true });
  });

  it('an answer that breaks the property’s pattern is not bound either (the typed ask checks only type and enum)', () => {
    const state = waitingState(
      initialAskState(1, planAskFields([{ toolCallId: 'c1', ask: ['site'] }], calls, toolOf)),
    );
    const bound = bindAnswer(state, { f1: 'LONDON!' }, calls, toolOf, STAMP);
    expect(bound.state.progress[0]!.invalid).toBe(true);
  });

  it('a numeric bound is NOT judged — the one validator’s honest subset ignores minimum/maximum', () => {
    // Named in the README's "Not covered": one judgment of a property's schema
    // (`toolArgsValidation.ts` · `validatePropertyValue`), at definition, at the
    // re-check and at dispatch alike; the tool receives 500 and may refuse it itself.
    const bound = bindAnswer(waitingState(fresh()), { f1: 500 }, calls, toolOf, STAMP);
    expect(bound.state.progress[0]!.answer).toBe(500);
  });

  it(`the ${MAX_ASK_ROUNDS}rd answer that does not fit exhausts the field; its call is refused`, () => {
    let state = fresh();
    for (let round = 1; round <= MAX_ASK_ROUNDS; round++) {
      state = bindAnswer(waitingState(state), { f1: 2.5 }, calls, toolOf, STAMP).state;
    }
    expect(state.progress[0]).toMatchObject({ rounds: MAX_ASK_ROUNDS, exhausted: true });
    expect(nextAskRound(state)).toBeUndefined();
    expect(settledCalls(state).get('c1')).toEqual({
      fills: [],
      exhausted: [{ argument: 'limit', expected: 'integer' }],
    });
  });

  it('an answer that fits is bound: an answered row in the tool’s own view, and the fill', () => {
    const bound = bindAnswer(waitingState(fresh()), { f1: 25 }, calls, toolOf, STAMP);
    expect(bound.rows).toEqual([
      {
        kind: 'argument',
        turn: 1,
        toolCallId: 'c1',
        toolName: 'top_talkers',
        iteration: 1,
        argument: 'limit',
        rule: 'ask',
        source: 'answered',
        value: '25',
      },
    ]);
    expect(settledCalls(bound.state).get('c1')).toEqual({
      fills: [{ argument: 'limit', value: 25, source: 'answered' }],
      exhausted: [],
    });
  });

  it('a free-text string field files `free: true` — a name the person typed, never support', () => {
    const state = waitingState(
      initialAskState(1, planAskFields([{ toolCallId: 'c1', ask: ['site'] }], calls, toolOf)),
    );
    const bound = bindAnswer(state, { f1: 'lon-2' }, calls, toolOf, STAMP);
    expect(bound.rows[0]).toMatchObject({ source: 'answered', value: 'lon-2', free: true });
  });

  it('a shared period binds each member in its OWN spelling', () => {
    const a = lookbackTool('io_profile', ['1h', '24h'], 'lookback');
    const b = lookbackTool('net_flows', ['-1h', '-24h'], 'signed-lookback');
    const periodCalls = [call('c1', 'io_profile'), call('c2', 'net_flows')];
    const of = toolOfList(a, b);
    const state = waitingState(
      initialAskState(
        1,
        planAskFields(
          [
            { toolCallId: 'c1', ask: ['window'] },
            { toolCallId: 'c2', ask: ['window'] },
          ],
          periodCalls,
          of,
        ),
      ),
    );
    const bound = bindAnswer(state, { f1: '24h' }, periodCalls, of, STAMP);
    expect(bound.rows.map((r) => [r.toolCallId, r.value])).toEqual([
      ['c1', '24h'],
      ['c2', '-24h'],
    ]);
    expect(settledCalls(bound.state).get('c2')!.fills).toEqual([
      { argument: 'window', value: '-24h', source: 'answered' },
    ]);
  });

  it('checkAnswer names what a misfit failed, never the answer', () => {
    const [field] = planAskFields([{ toolCallId: 'c1', ask: ['limit'] }], calls, toolOf);
    expect(checkAnswer(field!, 2.5, toolOf)).toEqual({ fits: false, expected: 'integer' });
    expect(checkAnswer(field!, 3, toolOf)).toEqual({ fits: true });
  });
});

describe('readAskAnswer — one validator, both doors', () => {
  const tool = lookbackTool('search_logs', ['1h', '24h'], 'lookback');
  const state = waitingState(
    initialAskState(
      1,
      planAskFields(
        [{ toolCallId: 'c1', ask: ['window'] }],
        [call('c1', 'search_logs')],
        toolOfList(tool),
      ),
    ),
  );
  const waiting = state.waiting!;

  it('accepts the door’s `input_received` and a raw InputResponse alike', () => {
    const answered = applyInputResponse(waiting.awaiting, {
      requestId: waiting.requestId,
      values: { f1: '24h' },
    });
    const received = {
      status: 'input_received',
      requestId: waiting.requestId,
      values: (answered as { supplied: object }).supplied,
    };
    expect(readAskAnswer(waiting, received)).toEqual({ f1: '24h' });
    expect(readAskAnswer(waiting, { requestId: waiting.requestId, values: { f1: '1h' } })).toEqual({
      f1: '1h',
    });
  });

  it('refuses another request, a value outside the choices, and a partial reply', () => {
    expect(() => readAskAnswer(waiting, { requestId: 'other', values: { f1: '1h' } })).toThrow(
      InputRequestError,
    );
    expect(() =>
      readAskAnswer(waiting, { requestId: waiting.requestId, values: { f1: '9h' } }),
    ).toThrow(InputRequestError);
    const two = waitingState(
      initialAskState(
        1,
        planAskFields(
          [{ toolCallId: 'c1', ask: ['limit', 'site'] }],
          [call('c1', 'top_talkers')],
          toolOfList(limitTool()),
        ),
      ),
    ).waiting!;
    expect(() => readAskAnswer(two, { requestId: two.requestId, values: { f1: 3 } })).toThrow(
      /every field answered in one reply/,
    );
  });

  it('a cancellation is the door’s refusal', () => {
    expect(() => readAskAnswer(waiting, { requestId: waiting.requestId, cancel: true })).toThrow(
      /Cancel a hosted request through its host/,
    );
  });
});

describe('SECURITY — a name nothing answers at bind time', () => {
  it('shows the answered value as hidden — there is no view to ask, so nothing raw is written', () => {
    const tool = lookbackTool('search_logs', ['1h', '24h'], 'lookback');
    const calls = [call('c1', 'search_logs')];
    const state = waitingState(
      initialAskState(
        1,
        planAskFields([{ toolCallId: 'c1', ask: ['window'] }], calls, toolOfList(tool)),
      ),
    );
    // The resolver answers nothing now (a provider tool not yet re-listed, say).
    const bound = bindAnswer(state, { f1: '24h' }, calls, toolOfList(), STAMP);
    expect(bound.rows[0]).toMatchObject({ source: 'answered', value: 'REDACTED' });
  });
});

describe('the rows the ask files pass the checkpoint door', () => {
  const who = {
    toolCallId: 'c1',
    toolName: 'search_logs',
    argument: 'window',
    rule: 'ask' as const,
  };
  it('asked (missing, invalid-answer) and answered (free) rows are well-formed', () => {
    expect(argumentRowIsWellFormed(askedRowOf(who, STAMP) as never)).toBe(true);
    expect(argumentRowIsWellFormed(askedRowOf(who, STAMP, 'invalid-answer') as never)).toBe(true);
    const answered = answeredRowOf({ ...who, shownValue: 'lon-2', free: true }, STAMP);
    expect(argumentRowIsWellFormed(answered as never)).toBe(true);
    expect(answered).toEqual({
      kind: 'argument',
      turn: 1,
      toolCallId: 'c1',
      toolName: 'search_logs',
      iteration: 1,
      argument: 'window',
      rule: 'ask',
      source: 'answered',
      value: 'lon-2',
      free: true,
    });
    // An asked row carries no value and no source — never a guess at one.
    expect(askedRowOf(who, STAMP)).not.toHaveProperty('value');
    expect(askedRowOf(who, STAMP)).not.toHaveProperty('source');
  });
});

// ─── SECURITY ────────────────────────────────────────────────────────

describe('SECURITY — the ask carries nothing the model proposed', () => {
  it('over 500 generated model outputs, no model value or choice reaches the declaration', () => {
    const tool = lookbackTool('search_logs', ['1h', '24h'], 'lookback');
    for (let seed = 1; seed <= 500; seed++) {
      const r = prng(seed);
      const args: Record<string, unknown> = {};
      const keys = Math.floor(r() * 5);
      for (let k = 0; k < keys; k++) {
        args[['host', 'service', 'limit', 'window2', 'q'][k]!] = `MODEL:${Math.floor(r() * 1e9)}`;
      }
      // Sometimes the model writes its OWN choices into the call, as data.
      if (r() < 0.5) args.choices = ['MODEL:7d', 'MODEL:30d'];
      const calls = [call('c1', 'search_logs', args)];
      const state = initialAskState(
        1,
        planAskFields([{ toolCallId: 'c1', ask: ['window'] }], calls, toolOfList(tool)),
      );
      const { declaration } = argumentAskDeclaration(state, nextAskRound(state)!);
      expect(JSON.stringify(declaration)).not.toContain('MODEL:');
    }
  });

  it('a hidden argument’s answer shows as the placeholder on its row', () => {
    const tool = lookbackTool('search_logs', ['1h', '24h'], 'lookback');
    const hiding = {
      ...tool,
      [SHOWN_ARGS]: (args: Record<string, unknown>) =>
        'window' in args ? { ...args, window: 'REDACTED' } : args,
    } as Tool;
    const calls = [call('c1', 'search_logs')];
    const state = waitingState(
      initialAskState(
        1,
        planAskFields([{ toolCallId: 'c1', ask: ['window'] }], calls, toolOfList(hiding)),
      ),
    );
    const bound = bindAnswer(state, { f1: '24h' }, calls, toolOfList(hiding), STAMP);
    expect(bound.rows[0]).toMatchObject({ source: 'answered', value: 'REDACTED' });
    expect(JSON.stringify(bound.rows)).not.toContain('24h');
  });
});

// ─── PERFORMANCE and LOAD ────────────────────────────────────────────

/** A tool with `n` ask-ruled integer arguments `a0…a(n-1)`. */
function wideTool(n: number): Tool {
  const properties: Record<string, unknown> = {};
  const rules: Record<string, unknown> = {};
  for (let i = 0; i < n; i++) {
    properties[`a${i}`] = { type: 'integer' };
    rules[`a${i}`] = { ask: `Value ${i}?` };
  }
  return defineTool({
    name: `wide_${n}`,
    description: 'd',
    inputSchema: { type: 'object', properties },
    askOrAssume: rules as never,
    execute: () => 'ok',
  });
}

describe('PERFORMANCE — building the ask over 32 fields', () => {
  it('plans, builds and validates a 32-field ask well inside a millisecond budget', () => {
    const tool = wideTool(32);
    const args = Array.from({ length: 32 }, (_, i) => `a${i}`);
    const calls = [call('c1', tool.schema.name)];
    const started = performance.now();
    for (let i = 0; i < 50; i++) {
      const state = initialAskState(
        1,
        planAskFields([{ toolCallId: 'c1', ask: args }], calls, toolOfList(tool)),
      );
      validateInputDeclaration(argumentAskDeclaration(state, nextAskRound(state)!).declaration);
    }
    const perAsk = (performance.now() - started) / 50;
    // eslint-disable-next-line no-console
    console.log(`[perf] 32-field batch ask: ${perAsk.toFixed(3)} ms to plan, build and validate`);
    expect(perAsk).toBeLessThan(50);
  });
});

describe('LOAD — a batch that needs 40 fields', () => {
  it(`asks in two rounds (${MAX_ASK_FIELDS} + 8) and binds all 40`, () => {
    const a = wideTool(32);
    const b = wideTool(8);
    const calls = [call('c1', a.schema.name), call('c2', b.schema.name)];
    const toolOf = toolOfList(a, b);
    let state = initialAskState(
      1,
      planAskFields(
        [
          { toolCallId: 'c1', ask: Array.from({ length: 32 }, (_, i) => `a${i}`) },
          { toolCallId: 'c2', ask: Array.from({ length: 8 }, (_, i) => `a${i}`) },
        ],
        calls,
        toolOf,
      ),
    );
    expect(state.fields).toHaveLength(40);
    const rounds: number[] = [];
    for (let guard = 0; guard < 5; guard++) {
      const round = nextAskRound(state);
      if (round === undefined) break;
      state = waitingState(state, round);
      const n = state.waiting!.fieldIndexes.length;
      rounds.push(n);
      const values = Object.fromEntries(Array.from({ length: n }, (_, k) => [`f${k + 1}`, k + 1]));
      state = bindAnswer(state, values, calls, toolOf, STAMP).state;
    }
    expect(rounds).toEqual([32, 8]);
    const settled = settledCalls(state);
    expect(settled.get('c1')!.fills).toHaveLength(32);
    expect(settled.get('c2')!.fills).toHaveLength(8);
  });
});

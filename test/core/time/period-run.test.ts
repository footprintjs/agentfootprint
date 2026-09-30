/**
 * A tool's period forms through real agents (time design § 7.1–§ 7.5, step
 * T5a): the declaration (in process and over MCP `_meta.agentfootprint.period`),
 * the fill from the turn's one window, the binding by quote, the record-and-run
 * law for a differing model window, `ctx.time` in process and in the call's
 * `_meta.agentfootprint.time`, and the tool facts joining the batch ask's
 * re-check. A scripted provider and a FIXTURE reader — no English is read and
 * no model is called.
 *
 * Law: the library fills a period only from the person's one window and only
 * exactly; it never writes over a window the model chose — a differing one
 * runs as sent and is recorded beside the person's.
 *
 * Test types:
 *   functional  — a two-argument epoch-ms tool over the mock MCP client is filled from
 *                 "10/09/26 8 AM to 8:40 AM" (argument rows `said`/`mention`, a `call-window`
 *                 row, the served note, `_meta.agentfootprint.time`); a model window that
 *                 differs runs, is recorded `model-chosen`, and the standing reads "not sure";
 *                 a UI window (`time.window`) fills as `app`; a `model` reader's window fills as
 *                 a reading (not sure); "today vs yesterday" → two mentions, no fill, each call
 *                 bound by its quote under declared sources;
 *   integration — `ctx.time` in process; `mcpServe` hands a served tool the context the client
 *                 sent; the rows cross the checkpoint door;
 *   security    — a malformed declaration is refused at definition and dropped at MCP ingest,
 *                 never repaired; a forged time context is not handed on;
 *   byte identity — without `.time()` a forms tool files no `call-window` row and its tool is
 *                 handed no `ctx.time` (every earlier byte reference is unchanged —
 *                 test/core/tools/byte-identity.test.ts).
 * Unit, property, boundary, performance: convert.test.ts, bind.test.ts.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  Agent,
  defineTool,
  isInputPause,
  type TimeParts,
  type TimeReader,
  type TimeReading,
  type Tool,
  type ToolExecutionContext,
} from '../../../src/index.js';
import type { LLMRequest, LLMResponse } from '../../../src/adapters/types.js';
import { validateCheckpoint } from '../../../src/core/runCheckpoint.js';
import { mockMcpClient } from '../../../src/lib/mcp/mockMcpClient.js';
import { readToolExtras, _resetToolExtrasWarnings } from '../../../src/lib/mcp/toolExtras.js';
import { mcpServe } from '../../../src/tool-providers/index.js';
import type { McpCallToolRequest, McpSdkServer } from '../../../src/lib/mcp/types.js';

// ─── the harness ─────────────────────────────────────────────────────

type Reply = { content: string; toolCalls?: { id: string; name: string; args: object }[] };

function scripted(script: readonly Reply[]) {
  let i = 0;
  const requests: LLMRequest[] = [];
  return {
    requests,
    provider: {
      name: 'time-period-mock',
      complete: async (req: LLMRequest): Promise<LLMResponse> => {
        requests.push(req);
        const reply = script[Math.min(i, script.length - 1)] ?? { content: 'done' };
        i += 1;
        return {
          content: reply.content,
          toolCalls: reply.toolCalls ?? [],
          usage: { input: 0, output: 0 },
        };
      },
    },
  };
}

const call = (id: string, name: string, args: object = {}): Reply => ({
  content: '',
  toolCalls: [{ id, name, args }],
});
const answer = (content: string): Reply => ({ content });

const LA = 'America/Los_Angeles';
const NOW = '2026-10-09T15:40:00Z';
const MESSAGE = 'Show client activity 10/09/26 8 AM to 8:40 AM';
const FROM_MS = Date.parse('2026-10-09T08:00:00-07:00');
const TO_MS = Date.parse('2026-10-09T08:41:00-07:00');

const RANGE_PARTS: TimeParts = {
  date: { kind: 'numeric', fields: [10, 9, 26] },
  rangeOf: [{ wall: { h: 8, meridiem: 'am' } }, { wall: { h: 8, m: 40, meridiem: 'am' } }],
};

function fixtureReader(
  answerFor: (text: string) => TimeReading,
  kind: 'rule' | 'model' = 'rule',
): TimeReader {
  return {
    id: `fixture/${kind}`,
    version: '1.0.0',
    locale: 'en-US',
    kind,
    read: (text) => answerFor(text),
  };
}

const rangeReader = (kind: 'rule' | 'model' = 'rule') =>
  fixtureReader(
    (text) =>
      text.includes('10/09/26')
        ? { mentions: [{ quote: '10/09/26 8 AM to 8:40 AM', parses: [RANGE_PARTS] }] }
        : { mentions: [] },
    kind,
  );

/** The design's § 7.1 JSON: a Python tool's two epoch-ms arguments, served over MCP. */
const PERIOD_META = {
  agentfootprint: {
    askOrAssume: {
      start_time: { ask: 'From when?' },
      end_time: { ask: 'Until when?' },
    },
    period: {
      forms: [
        {
          kind: 'bounds',
          from: { argument: 'start_time', as: 'epoch-ms' },
          to: { argument: 'end_time', as: 'epoch-ms', edge: 'exclusive' },
        },
      ],
      retention: '30d',
    },
  },
};

function epochServer() {
  const seen: { args: Record<string, unknown>; meta?: Readonly<Record<string, unknown>> }[] = [];
  const client = mockMcpClient({
    name: 'metrics',
    tools: [
      {
        name: 'client_activity',
        description: 'Client operations over a window.',
        inputSchema: {
          type: 'object',
          properties: { start_time: { type: 'integer' }, end_time: { type: 'integer' } },
        },
        _meta: PERIOD_META,
        handler: async (args, request) => {
          seen.push({ args, ...(request._meta !== undefined && { meta: request._meta }) });
          return '{"ops":42}';
        },
      },
    ],
  });
  return { client, seen };
}

type Row = { kind: string } & Record<string, unknown>;
const rows = (agent: { findings(): unknown }): Row[] =>
  ((agent.findings() as Row[] | undefined) ?? []).map((r) => ({ ...r }));
const ofKind = (agent: { findings(): unknown }, kind: string) =>
  rows(agent).filter((r) => r.kind === kind);

async function build(
  script: readonly Reply[],
  tools: readonly Tool[],
  arm: (b: ReturnType<typeof Agent.create>) => ReturnType<typeof Agent.create>,
) {
  const s = scripted(script);
  const agent = arm(
    Agent.create({ provider: s.provider as never, model: 'mock', maxIterations: 6 }).tools(tools),
  ).build();
  return { agent, requests: s.requests };
}

// ─── the fill ────────────────────────────────────────────────────────

describe('the fill — the turn’s one window, into the tool’s form, exactly', () => {
  it('a two-argument epoch-ms tool over the mock MCP client is filled from the person’s words', async () => {
    const { client, seen } = epochServer();
    const { agent, requests } = await build(
      [call('c1', 'client_activity', {}), answer('42 operations.')],
      await client.tools(),
      (b) => b.time({ zone: LA, reader: rangeReader(), policy: { dateOrder: 'MDY' } }),
    );
    await agent.run({ message: MESSAGE, time: { now: NOW } });

    // The tool ran with the window in its own form, the end exclusive.
    expect(seen[0]?.args).toEqual({ start_time: FROM_MS, end_time: TO_MS });
    // …and received the call's time in the request's own `_meta`.
    const time = (seen[0]?.meta?.agentfootprint as { time: Record<string, unknown> }).time;
    expect(time).toMatchObject({
      version: 1,
      asked: {
        from: '2026-10-09T08:00:00-07:00',
        to: '2026-10-09T08:41:00-07:00',
        edge: 'exclusive',
      },
      zone: LA,
      now: NOW,
    });
    const callRow = ofKind(agent, 'call')[0]!;
    expect(time.dispatchedAt).toBe(callRow.dispatchedAt);

    // The record: one row per argument (the person's, matched to the mention), one call-window row.
    expect(
      ofKind(agent, 'argument').map((r) => [r.argument, r.source, r.matched, r.value]),
    ).toEqual([
      ['start_time', 'said', 'mention', String(FROM_MS)],
      ['end_time', 'said', 'mention', String(TO_MS)],
    ]);
    expect(ofKind(agent, 'call-window')).toEqual([
      {
        kind: 'call-window',
        turn: 1,
        iteration: 1,
        toolCallId: 'c1',
        toolName: 'client_activity',
        how: 'filled',
        form: 0,
        asked: { from: '2026-10-09T08:00:00-07:00', to: '2026-10-09T08:41:00-07:00' },
        person: {
          from: '2026-10-09T08:00:00-07:00',
          to: '2026-10-09T08:41:00-07:00',
          source: 'said',
          mention: 0,
        },
      },
    ]);

    // The model read, past tense, what the call ran with.
    const tool = requests[1]!.messages.find((m) => m.role === 'tool')!;
    expect(tool.content).toContain(
      `[start_time was not in the client_activity call this result answers; the call ran with ${FROM_MS}, ` +
        "from the window the person's own words gave — recorded as the person's.]",
    );
    // Nothing about the window was assumed or unverified.
    const standing = (await agent.assessment())!;
    expect(standing.reasons.map((r) => r.reason).filter((r) => r.startsWith('argument'))).toEqual(
      [],
    );
  });

  it('a window set in a UI fills as the app’s — no reader armed', async () => {
    const seen: ToolExecutionContext[] = [];
    const tool = defineTool({
      name: 'search_logs',
      description: 'Error lines over a window.',
      inputSchema: { type: 'object', properties: { window: { type: 'string' } } },
      askOrAssume: { window: { assume: '2026-10-09T07:00:00Z..2026-10-09T08:00:00Z' } },
      period: { argument: 'window', spelling: 'iso-range', direction: 'past' },
      execute: (_args, ctx) => {
        seen.push(ctx);
        return 'no errors';
      },
    });
    const { agent } = await build([call('c1', 'search_logs', {}), answer('none')], [tool], (b) =>
      b.time({ zone: LA }),
    );
    const window = { from: '2026-10-09T14:00:00Z', to: '2026-10-09T15:00:00Z' };
    await agent.run({ message: 'errors?', time: { now: NOW, window } });
    expect(ofKind(agent, 'argument')).toMatchObject([
      {
        argument: 'window',
        source: 'app',
        appSource: 'time.window',
        value: '2026-10-09T14:00:00Z..2026-10-09T14:59:59Z',
      },
    ]);
    // In process, `ctx.time` is a field on the execution context.
    expect(seen[0]?.time).toMatchObject({
      version: 1,
      asked: { ...window, edge: 'exclusive' },
      zone: LA,
      now: NOW,
    });
    expect(ofKind(agent, 'call-window')[0]).toMatchObject({
      how: 'filled',
      person: { ...window, source: 'control' },
    });
  });

  it('a `model` reader’s window fills as a reading — the standing reads "not sure"', async () => {
    const { client } = epochServer();
    const { agent } = await build(
      [call('c1', 'client_activity', {}), answer('42 operations.')],
      await client.tools(),
      (b) => b.time({ zone: LA, reader: rangeReader('model'), policy: { dateOrder: 'MDY' } }),
    );
    await agent.run({ message: MESSAGE, time: { now: NOW } });
    expect(ofKind(agent, 'argument').map((r) => [r.source, r.reading, r.matched])).toEqual([
      ['said', true, 'mention'],
      ['said', true, 'mention'],
    ]);
    const standing = (await agent.assessment())!;
    expect(standing.standing).toBe('not-sure');
    expect(standing.reasons.map((r) => r.reason)).toContain('argument-read');
  });
});

// ─── the model's own window ──────────────────────────────────────────

describe('a window the model chose — record and run', () => {
  it('a model window that differs runs as sent, is recorded model-chosen beside the person’s, and folds "not sure"', async () => {
    const { client, seen } = epochServer();
    const drill = {
      start_time: Date.parse('2026-10-09T09:00:00-07:00'),
      end_time: Date.parse('2026-10-09T10:00:00-07:00'),
    };
    const { agent } = await build(
      [call('c1', 'client_activity', drill), answer('done')],
      await client.tools(),
      (b) => b.time({ zone: LA, reader: rangeReader(), policy: { dateOrder: 'MDY' } }),
    );
    await agent.run({ message: MESSAGE, time: { now: NOW } });
    expect(seen[0]?.args).toEqual(drill); // never written over
    expect(ofKind(agent, 'call-window')[0]).toMatchObject({
      how: 'model-chosen',
      asked: { from: '2026-10-09T16:00:00Z', to: '2026-10-09T17:00:00Z' },
      person: {
        from: '2026-10-09T08:00:00-07:00',
        to: '2026-10-09T08:41:00-07:00',
        source: 'said',
        mention: 0,
      },
    });
    expect(ofKind(agent, 'argument').map((r) => r.source)).toEqual(['model', 'model']);
    const standing = (await agent.assessment())!;
    expect(standing.standing).toBe('not-sure');
    expect(standing.reasons.map((r) => r.reason)).toContain('argument-unverified');
  });

  it('"today vs yesterday": two mentions, no fill, each call bound by its quote', async () => {
    const reader = fixtureReader(() => ({
      mentions: [
        { quote: 'today', parses: [{ relative: { unit: 'day', offset: 0 } }] },
        { quote: 'yesterday', parses: [{ relative: { unit: 'day', offset: -1 } }] },
      ],
    }));
    const day = (d: string, n: string) => ({
      start_time: Date.parse(`${d}T00:00:00-07:00`),
      end_time: Date.parse(`${n}T00:00:00-07:00`),
    });
    const from = (quote: string) => ({
      _findings: {
        from: [
          { argument: 'start_time', source: 'user', quote },
          { argument: 'end_time', source: 'user', quote },
        ],
      },
    });
    const { client, seen } = epochServer();
    const { agent } = await build(
      [
        {
          content: '',
          toolCalls: [
            {
              id: 'c1',
              name: 'client_activity',
              args: { ...day('2026-10-09', '2026-10-10'), ...from('today') },
            },
            {
              id: 'c2',
              name: 'client_activity',
              args: { ...day('2026-10-08', '2026-10-09'), ...from('yesterday') },
            },
          ],
        },
        answer('compared'),
      ],
      await client.tools(),
      (b) => b.time({ zone: LA, reader }).inputsLayer({ argumentSources: true }),
    );
    const out = await agent.run({
      message: 'compare client activity today vs yesterday',
      time: { now: NOW },
    });
    expect(isInputPause(out)).toBe(false); // nothing asked
    expect(seen.map((s) => s.args)).toEqual([
      day('2026-10-09', '2026-10-10'),
      day('2026-10-08', '2026-10-09'),
    ]);
    expect(
      ofKind(agent, 'call-window').map((r) => [
        r.toolCallId,
        r.how,
        r.by,
        (r.person as { mention: number }).mention,
      ]),
    ).toEqual([
      ['c1', 'bound', 'quote', 0],
      ['c2', 'bound', 'quote', 1],
    ]);
    expect(
      ofKind(agent, 'argument').map((r) => [r.toolCallId, r.source, r.matched, r.reading]),
    ).toEqual([
      ['c1', 'said', 'mention', undefined],
      ['c1', 'said', 'mention', undefined],
      ['c2', 'said', 'mention', undefined],
      ['c2', 'said', 'mention', undefined],
    ]);
  });

  it('two mentions and the period left out: nothing is filled, the tool’s own rule asks', async () => {
    const reader = fixtureReader(() => ({
      mentions: [
        { quote: 'today', parses: [{ relative: { unit: 'day', offset: 0 } }] },
        { quote: 'yesterday', parses: [{ relative: { unit: 'day', offset: -1 } }] },
      ],
    }));
    const { client, seen } = epochServer();
    const { agent } = await build(
      [call('c1', 'client_activity', {}), answer('x')],
      await client.tools(),
      (b) => b.time({ zone: LA, reader }),
    );
    const out = await agent.run({ message: 'today vs yesterday', time: { now: NOW } });
    expect(isInputPause(out)).toBe(true);
    expect(seen).toEqual([]);
    expect(ofKind(agent, 'call-window')[0]).toMatchObject({
      how: 'not-filled',
      why: 'several-mentions',
    });
  });
});

// ─── the declaration ─────────────────────────────────────────────────

describe('the declaration — refused at definition, dropped at MCP ingest, never repaired', () => {
  const schema = {
    type: 'object',
    properties: {
      a: { type: 'integer' },
      b: { type: 'integer' },
      w: { type: 'string' },
      tz: { type: 'string' },
    },
  } as const;
  const rules = { a: { ask: 'a?' }, b: { ask: 'b?' }, w: { ask: 'w?' }, tz: { assume: LA } };
  const define = (period: unknown) =>
    defineTool({
      name: 't',
      description: 'd',
      inputSchema: schema,
      askOrAssume: rules,
      period: period as never,
      execute: () => '',
    });

  it.each([
    [
      'both halves',
      {
        argument: 'w',
        spelling: 'iso-range',
        forms: [{ kind: 'day', argument: 'w', zone: { argument: 'tz' } }],
      },
    ],
    ['a wall range with no zone', { argument: 'w', spelling: 'wall-range' }],
    [
      'a zone argument beside a non-wall spelling',
      { argument: 'w', spelling: 'iso-range', zoneArgument: 'tz' },
    ],
    [
      'an epoch bound on a string property',
      {
        forms: [
          {
            kind: 'bounds',
            from: { argument: 'w', as: 'epoch-ms' },
            to: { argument: 'b', as: 'epoch-ms' },
          },
        ],
      },
    ],
    ['a day with no zone', { forms: [{ kind: 'day', argument: 'w' }] }],
    [
      'a bound with no rule',
      {
        forms: [
          {
            kind: 'bounds',
            from: { argument: 'a', as: 'epoch-s' },
            to: { argument: 'c', as: 'epoch-s' },
          },
        ],
      },
    ],
    [
      'a retention that is no duration',
      { argument: 'w', spelling: 'iso-range', retention: '30 days' },
    ],
    [
      'a direction outside the three',
      { argument: 'w', spelling: 'iso-range', direction: 'forward' },
    ],
    ['an unknown key', { argument: 'w', spelling: 'iso-range', widen: 'refuse' }],
  ])('refuses %s', (_what, period) => {
    expect(() => define(period)).toThrow(/defineTool\('t'\): period/);
  });

  it('takes the design’s declarations: accepts + zoneArgument + facts, and a two-argument form', () => {
    expect(() =>
      define({
        argument: 'w',
        accepts: ['iso-range', 'wall-range'],
        zoneArgument: 'tz',
        direction: 'past',
        maxRange: '24h',
      }),
    ).not.toThrow();
    expect(() =>
      define({
        forms: [
          {
            kind: 'bounds',
            from: { argument: 'a', as: 'epoch-ms' },
            to: { argument: 'b', as: 'epoch-ms', edge: 'exclusive' },
          },
        ],
        retention: '30d',
        granularity: '1m',
        filtersToAsked: true,
      }),
    ).not.toThrow();
  });

  it('MCP ingest reads the § 7.1 JSON, and drops a malformed period with one warning', () => {
    _resetToolExtrasWarnings();
    const origin = {
      server: 'metrics',
      tool: 'client_activity',
      inputSchema: {
        type: 'object',
        properties: { start_time: { type: 'integer' }, end_time: { type: 'integer' } },
      },
    };
    expect(readToolExtras(PERIOD_META, origin).period).toEqual(PERIOD_META.agentfootprint.period);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad = {
      agentfootprint: {
        ...PERIOD_META.agentfootprint,
        period: { forms: [{ kind: 'day', argument: 'start_time' }] },
      },
    };
    expect(readToolExtras(bad, origin).period).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

// ─── the facts join the re-check ─────────────────────────────────────

describe("the tool's facts join the answer's re-check (§ 6.2)", () => {
  it('a period answer outside the tool’s direction is not taken — the field is asked again', async () => {
    const ran: unknown[] = [];
    const tool = defineTool({
      name: 'search_logs',
      description: 'Error lines over a window.',
      inputSchema: { type: 'object', properties: { window: { type: 'string' } } },
      askOrAssume: { window: { ask: 'Which window?' } },
      period: { argument: 'window', spelling: 'iso-range', direction: 'past', maxRange: '24h' },
      execute: (args) => {
        ran.push(args);
        return 'no errors';
      },
    });
    const { agent } = await build([call('c1', 'search_logs', {}), answer('none')], [tool], (b) =>
      b.time({ zone: LA }),
    );
    const first = await agent.run({ message: 'errors?', time: { now: NOW } });
    expect(isInputPause(first)).toBe(true);
    if (!isInputPause(first)) return;
    const tomorrow = '2026-10-10T08:00:00-07:00..2026-10-10T09:00:00-07:00';
    const again = await agent.resume(first.checkpoint, {
      requestId: first.awaitingInput.requestId,
      values: { f1: tomorrow },
    });
    expect(isInputPause(again)).toBe(true);
    expect(ran).toEqual([]);
    expect(ofKind(agent, 'argument').map((r) => r.asked)).toContain('invalid-answer');
    if (!isInputPause(again)) return;
    const good = '2026-10-09T07:00:00-07:00..2026-10-09T07:59:59-07:00';
    await agent.resume(again.checkpoint, {
      requestId: again.awaitingInput.requestId,
      values: { f1: good },
    });
    expect(ran).toEqual([{ window: good }]);
  });

  it('the one judge reads the facts for a `time-range` answer, with a catalog reason', async () => {
    const { checkTimeAnswer, refusalReason } = await import('../../../src/core/time/ask.js');
    const { defaultTimeAskMessages } = await import('../../../src/index.js');
    const old = '2026-08-01T00:00:00Z/2026-08-02T00:00:00Z';
    const refused = checkTimeAnswer('time-range', old, LA, {
      facts: { retention: '30d' },
      now: NOW,
    });
    expect(refused).toMatchObject({ problem: 'beyond-retention', facts: { retention: '30d' } });
    expect(refusalReason([refused!], defaultTimeAskMessages)).toBe(
      'That window is older than this source keeps (30d): nothing from 2026-08-01T00:00:00Z to 2026-08-02T00:00:00Z is still held.',
    );
    expect(checkTimeAnswer('time-range', old, LA)).toBeUndefined();
  });
});

// ─── the transports and the record ───────────────────────────────────

describe('ctx.time across a transport, and the record across the checkpoint door', () => {
  it('mcpServe hands a served tool the context the client sent; a forged one is not handed on', async () => {
    const seen: (ToolExecutionContext['time'] | undefined)[] = [];
    const served = defineTool({
      name: 'client_activity',
      description: 'd',
      inputSchema: { type: 'object', properties: {} },
      execute: (_a, ctx) => {
        seen.push(ctx.time);
        return 'ok';
      },
    });
    const handlers = new Map<string, (req: McpCallToolRequest, extra: object) => unknown>();
    const server: McpSdkServer = {
      setRequestHandler: (schema: unknown, handler: never) => {
        handlers.set((schema as { method: string }).method, handler);
      },
      connect: async () => {},
      close: async () => {},
    } as never;
    await mcpServe([served], { name: 's', _server: server });
    const call = handlers.get('tools/call')!;
    const time = {
      version: 1,
      asked: { from: '2026-10-09T15:00:00Z', to: '2026-10-09T16:00:00Z', edge: 'exclusive' },
      zone: LA,
      now: NOW,
      dispatchedAt: NOW,
    };
    await call(
      { params: { name: 'client_activity', arguments: {}, _meta: { agentfootprint: { time } } } },
      {},
    );
    await call(
      {
        params: {
          name: 'client_activity',
          arguments: {},
          _meta: { agentfootprint: { time: { ...time, version: 2 } } },
        },
      },
      {},
    );
    expect(seen).toEqual([time, undefined]);
  });

  it('a paused run’s call-window rows cross the checkpoint door', async () => {
    const reader = fixtureReader(() => ({
      mentions: [
        { quote: 'today', parses: [{ relative: { unit: 'day', offset: 0 } }] },
        { quote: 'yesterday', parses: [{ relative: { unit: 'day', offset: -1 } }] },
      ],
    }));
    const { client } = epochServer();
    const { agent } = await build(
      [call('c1', 'client_activity', {}), answer('x')],
      await client.tools(),
      (b) => b.time({ zone: LA, reader }),
    );
    await agent.run({ message: 'today vs yesterday', time: { now: NOW } });
    const cp = JSON.parse(JSON.stringify(agent.checkpoint())) as { findingsLedger?: Row[] };
    expect(() => validateCheckpoint(cp)).not.toThrow();
    expect(JSON.stringify(cp)).toContain('"kind":"call-window"');
    // A forged row is refused at the same door.
    const forged = JSON.parse(JSON.stringify(cp).replace('"how":"not-filled"', '"how":"guessed"'));
    expect(() => validateCheckpoint(forged)).toThrow();
  });
});

// ─── byte identity ───────────────────────────────────────────────────

describe('off: without .time() nothing new is filed or handed', () => {
  it('a forms tool without .time() files no call-window row and is handed no ctx.time', async () => {
    const seen: ToolExecutionContext[] = [];
    const tool = defineTool({
      name: 'client_activity',
      description: 'd',
      inputSchema: {
        type: 'object',
        properties: { start_time: { type: 'integer' }, end_time: { type: 'integer' } },
      },
      askOrAssume: { start_time: { assume: 1 }, end_time: { assume: 2 } },
      period: PERIOD_META.agentfootprint.period as never,
      execute: (_a, ctx) => {
        seen.push(ctx);
        return 'ok';
      },
    });
    const { agent } = await build(
      [call('c1', 'client_activity', {}), answer('x')],
      [tool],
      (b) => b,
    );
    await agent.run({ message: MESSAGE });
    expect(ofKind(agent, 'call-window')).toEqual([]);
    expect(seen[0]).not.toHaveProperty('time');
    expect(ofKind(agent, 'argument').map((r) => r.source)).toEqual(['default', 'default']);
  });
});

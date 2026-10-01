/**
 * Time follow-ups, packet "gaps" — what an app switching to the time layer
 * found through real agents (a scripted provider, the wall clock pinned with
 * fake `Date` — no model is called).
 *
 * Law (the owner's decision "Always confirm", TQ29, carried to its end): the
 * person wrote a time, so a tool's default never stands in for it — whatever
 * the library could make of the words. A reading waiting on its ZONE (the
 * person wrote an abbreviation outside the app's map) and words the reader
 * could NOT read are as open as a reading to confirm: a call that leaves its
 * period out is asked the window, its answer judged as a time and converted
 * into the tool's own form by the one owner (`convert.ts` · `convertForTool`).
 *
 * Test types:
 *   functional  — G1: "10/09/26 8 AM to 8:40 AM PST" to a tool whose rule ASSUMES `-30m` → the
 *                 zone is asked, then the readings, and the tool runs the person's window, never
 *                 `-30m`; G2: "yesterday morning" to an assume tool → asked which time they
 *                 meant (free entry, `format: 'time-range'`, nothing pre-filled), the answer runs
 *                 in the tool's own spelling (`a..b`, never the raw `a/b`) and is filed as the
 *                 person's (`time-answer`, `edited`); the same to an ASK-rule tool → one window
 *                 field with a format, not the tool's own format-less ask;
 *   integration — the served line names the unread words as pending (what the form will do),
 *                 and once answered names the window as the person's;
 *   security    — a free answer that is no time range is refused at the door and asked again;
 *   G14         — the app's control window is a fact about the person's TURN: served on every
 *                 request whether or not a served tool declares a period (inputs layer armed or
 *                 not), the window alone when no tool can take values, the rebuild reproducing it;
 *   byte identity — a turn whose words read no time at all asks nothing new and runs the default;
 *                 `.time()` with no control window serves no line, the same request bytes as an
 *                 agent without `.time()`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  Agent,
  defineTool,
  englishTimeReader,
  isInputPause,
  type Tool,
} from '../../../src/index.js';
import type { LLMRequest, LLMResponse } from '../../../src/adapters/types.js';
import { TIME_LINE_SOURCE } from '../../../src/core/agent/arguments/serve.js';
import { servedAt } from '../../../src/lib/time-travel/servedView.js';

type Reply = { content: string; toolCalls?: { id: string; name: string; args: object }[] };

function scripted(script: readonly Reply[]) {
  let i = 0;
  const requests: LLMRequest[] = [];
  return {
    requests,
    provider: {
      name: 'time-gaps-mock',
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
const NOW = '2026-10-09T16:00:00Z'; // 09:00 PDT
const NOW_MS = Date.parse(NOW);

type Row = { kind: string } & Record<string, unknown>;
const ofKind = (agent: { findings(): unknown }, kind: string): Row[] =>
  ((agent.findings() as Row[] | undefined) ?? []).filter((r) => r.kind === kind);

function build(script: readonly Reply[], tools: readonly Tool[]) {
  const s = scripted(script);
  const agent = Agent.create({ provider: s.provider as never, model: 'mock', maxIterations: 6 })
    .tools(tools)
    .time({ zone: LA, reader: englishTimeReader() })
    .build();
  return { agent, requests: s.requests };
}

/** An ISO range or a signed look-back in ONE argument; the rule ASSUMES `-30m`. */
function rangeTool(seen: Record<string, unknown>[], rule: object = { assume: '-30m' }) {
  return defineTool({
    name: 'smb_records',
    description: 'SMB records for a server over a window.',
    inputSchema: {
      type: 'object',
      properties: { server: { type: 'string' }, window: { type: 'string' } },
    },
    askOrAssume: { window: rule } as never,
    period: { argument: 'window', accepts: ['iso-range', 'signed-lookback'], direction: 'past' },
    execute: (args) => {
      seen.push({ ...args });
      return '{"rows":[]}';
    },
  });
}

/** A look-back-only tool in `smhdw`; the rule ASSUMES `1h`. */
function lookbackTool(seen: Record<string, unknown>[]) {
  return defineTool({
    name: 'client_activity',
    description: 'Clients that talked to a cluster over a look-back.',
    inputSchema: {
      type: 'object',
      properties: { cluster: { type: 'string' }, window: { type: 'string' } },
    },
    askOrAssume: { window: { assume: '1h' } },
    period: {
      forms: [{ kind: 'lookback', argument: 'window', signed: false, units: 'smhdw' }],
      direction: 'past',
    },
    execute: (args) => {
      seen.push({ ...args });
      return '{"rows":[]}';
    },
  });
}

type Field = { id: string; format?: string; description?: string; enum?: readonly string[] };
function paused(result: unknown) {
  if (!isInputPause(result)) throw new Error('expected an input pause');
  return result as never as {
    checkpoint: unknown;
    awaitingInput: {
      requestId: string;
      fields: readonly Field[];
      refused?: { reason: string };
    };
  };
}

function timeLineOf(req: LLMRequest | undefined): string | undefined {
  const last = req?.messages[req.messages.length - 1];
  if (last?.role !== 'user' || typeof last.content !== 'string') return undefined;
  return last.content.startsWith(TIME_LINE_SOURCE) ? last.content : undefined;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW_MS + 5_000);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('G1 — a reading waiting on its ZONE is open: an assume rule is asked, never defaulted', () => {
  it('"… 8 AM to 8:40 AM PST" → zone ask, then the readings, then the person’s window runs', async () => {
    const seen: Record<string, unknown>[] = [];
    const { agent } = build(
      [call('c1', 'smb_records', { server: '10.0.0.1' }), answer('done')],
      [rangeTool(seen)],
    );
    const zone = paused(
      await agent.run({
        message: 'what SMB on 10.0.0.1 10/09/26 8 AM to 8:40 AM PST',
        time: { now: NOW },
      }),
    );
    expect(seen).toEqual([]); // the default `-30m` never ran
    expect(zone.awaitingInput.fields).toHaveLength(1);
    expect(zone.awaitingInput.fields[0]).toMatchObject({ format: 'zone' });
    const which = paused(
      await agent.resume(zone.checkpoint as never, {
        requestId: zone.awaitingInput.requestId,
        values: { f1: LA },
      }),
    );
    const field = which.awaitingInput.fields[0]!;
    expect(field.format).toBe('time-range');
    const done = await agent.resume(which.checkpoint as never, {
      requestId: which.awaitingInput.requestId,
      values: { f1: field.enum![0]! },
    });
    expect(isInputPause(done)).toBe(false);
    expect(seen).toEqual([
      { server: '10.0.0.1', window: '2026-10-09T08:00:00-07:00..2026-10-09T08:40:59-07:00' },
    ]);
    expect(ofKind(agent, 'argument').some((r) => r.source === 'default')).toBe(false);
  });
});

describe('G2 — words the reader could not read are asked, free entry, and converted', () => {
  it('"yesterday morning" to an ASSUME tool: asked which time, the answer runs in the tool’s form', async () => {
    const seen: Record<string, unknown>[] = [];
    const { agent, requests } = build(
      [call('c1', 'smb_records', { server: '10.0.0.1' }), answer('done')],
      [rangeTool(seen)],
    );
    const first = paused(
      await agent.run({ message: 'any SMB on 10.0.0.1 yesterday morning?', time: { now: NOW } }),
    );
    expect(seen).toEqual([]);
    expect(first.awaitingInput.fields).toEqual([
      expect.objectContaining({
        format: 'time-range',
        description: 'Which time did you mean by “yesterday morning”?',
      }),
    ]);
    expect(first.awaitingInput.fields[0]!.enum).toBeUndefined();
    // The model was told, late, what the form will do with the words.
    expect(timeLineOf(requests[0])).toContain(
      'The window for “yesterday morning” is not settled yet: the library could not read those ' +
        'words, so its own form asks the person which time they meant, with nothing filled in, ' +
        'and it opens when smb_records is called with window left out',
    );
    const done = await agent.resume(first.checkpoint as never, {
      requestId: first.awaitingInput.requestId,
      values: { f1: '2026-10-08T06:00:00-07:00/2026-10-08T12:00:00-07:00' },
    });
    expect(isInputPause(done)).toBe(false);
    // The tool's own spelling (`..`, inclusive end) — never the raw `/` interval.
    expect(seen).toEqual([
      { server: '10.0.0.1', window: '2026-10-08T06:00:00-07:00..2026-10-08T11:59:59-07:00' },
    ]);
    expect(ofKind(agent, 'time-answer')).toMatchObject([
      {
        mention: 0,
        from: '2026-10-08T06:00:00-07:00',
        to: '2026-10-08T12:00:00-07:00',
        how: 'edited',
      },
    ]);
    expect(ofKind(agent, 'call-window').at(-1)).toMatchObject({
      how: 'filled',
      person: { source: 'answered', mention: 0 },
    });
    expect(timeLineOf(requests[1])).toContain(
      '“yesterday morning” is 2026-10-08 06:00–11:59 America/Los_Angeles (UTC-07:00), the window ' +
        'the person gave when asked what their words meant',
    );
  });

  it('a look-back-only ASSUME tool: the answer is read by the covering look-back, said so', async () => {
    const seen: Record<string, unknown>[] = [];
    const { agent } = build(
      [call('c1', 'client_activity', { cluster: '006' }), answer('done')],
      [lookbackTool(seen)],
    );
    const first = paused(
      await agent.run({ message: 'who talked to cluster 006 since 8 AM?', time: { now: NOW } }),
    );
    expect(first.awaitingInput.fields[0]).toMatchObject({ format: 'time-range' });
    await agent.resume(first.checkpoint as never, {
      requestId: first.awaitingInput.requestId,
      values: { f1: '2026-10-09T08:00:00-07:00/2026-10-09T09:00:00-07:00' },
    });
    expect(seen).toEqual([{ cluster: '006', window: '1h' }]);
    expect(ofKind(agent, 'argument').some((r) => r.source === 'default')).toBe(false);
  });

  it('an ASK-rule tool: one window field with a format, never the tool’s format-less ask', async () => {
    const seen: Record<string, unknown>[] = [];
    const { agent } = build(
      [call('c1', 'smb_records', { server: '10.0.0.1' }), answer('done')],
      [rangeTool(seen, { ask: 'Which window?' })],
    );
    const first = paused(
      await agent.run({ message: 'any SMB on 10.0.0.1 yesterday morning?', time: { now: NOW } }),
    );
    expect(first.awaitingInput.fields).toHaveLength(1);
    expect(first.awaitingInput.fields[0]).toMatchObject({ format: 'time-range' });
    // Not a time range → refused at the door, asked again; nothing ran.
    const again = paused(
      await agent.resume(first.checkpoint as never, {
        requestId: first.awaitingInput.requestId,
        values: { f1: 'the morning' },
      }),
    );
    expect(again.awaitingInput.refused).toBeDefined();
    expect(seen).toEqual([]);
    await agent.resume(again.checkpoint as never, {
      requestId: again.awaitingInput.requestId,
      values: { f1: '2026-10-08T06:00:00-07:00/2026-10-08T12:00:00-07:00' },
    });
    expect(seen).toEqual([
      { server: '10.0.0.1', window: '2026-10-08T06:00:00-07:00..2026-10-08T11:59:59-07:00' },
    ]);
  });

  it('byte identity — a message with no time words asks nothing new: the default runs', async () => {
    const seen: Record<string, unknown>[] = [];
    const { agent } = build(
      [call('c1', 'smb_records', { server: '10.0.0.1' }), answer('done')],
      [rangeTool(seen)],
    );
    const out = await agent.run({ message: 'any SMB on 10.0.0.1?', time: { now: NOW } });
    expect(isInputPause(out)).toBe(false);
    expect(seen).toEqual([{ server: '10.0.0.1', window: '-30m' }]);
  });
});

describe('G7 — the value served to the model is the value the tool is handed', () => {
  it('a confirmed look-back: the served line names exactly the window the call ran with', async () => {
    const seen: Record<string, unknown>[] = [];
    const { agent, requests } = build(
      [call('c1', 'smb_records', { server: '10.0.0.1' }), answer('done')],
      [rangeTool(seen)],
    );
    const first = paused(
      await agent.run({ message: 'any SMB on 10.0.0.1 in the last 2 hours?', time: { now: NOW } }),
    );
    await agent.resume(first.checkpoint as never, {
      requestId: first.awaitingInput.requestId,
      values: { f1: first.awaitingInput.fields[0]!.enum![0]! },
    });
    expect(seen).toHaveLength(1);
    const handed = seen[0]!.window as string;
    // One spelling (`windows.ts` · `windowToConvert` → `convertForTool`): `[now − 2h, now)`.
    expect(handed).toBe('2026-10-09T14:00:00Z..2026-10-09T15:59:59Z');
    expect(timeLineOf(requests[1])).toContain(`smb_records window "${handed}"`);
  });
});

describe('G9 — the window set in the app’s time control is served by the library', () => {
  const WINDOW = { from: '2026-10-09T08:00:00-07:00', to: '2026-10-09T08:40:00-07:00' };
  const CONTROL_LINE =
    'The window the person set in the app’s time control is 2026-10-09 08:00–08:39 ' +
    'America/Los_Angeles (UTC-07:00) — smb_records window ' +
    '"2026-10-09T08:00:00-07:00..2026-10-09T08:39:59-07:00". A call may pass these values as ' +
    'written; an answer built on them states that window.';

  for (const withReader of [true, false]) {
    it(`${
      withReader ? 'with' : 'without'
    } a reader: the first request names it, and the call is filled from it`, async () => {
      const seen: Record<string, unknown>[] = [];
      const s = scripted([call('c1', 'smb_records', { server: '10.0.0.1' }), answer('done')]);
      const agent = Agent.create({ provider: s.provider as never, model: 'mock', maxIterations: 6 })
        .tools([rangeTool(seen)])
        .time({ zone: LA, ...(withReader && { reader: englishTimeReader() }) })
        .build();
      const out = await agent.run({
        message: 'any SMB on 10.0.0.1?',
        time: { now: NOW, window: WINDOW },
      });
      expect(isInputPause(out)).toBe(false);
      expect(timeLineOf(s.requests[0])).toBe(
        `${TIME_LINE_SOURCE} ${CONTROL_LINE.replace('’', "'")}`,
      );
      expect(seen).toEqual([
        { server: '10.0.0.1', window: '2026-10-09T08:00:00-07:00..2026-10-09T08:39:59-07:00' },
      ]);
    });
  }

  it('byte identity — `.time()` with no reader and no control window serves no line', async () => {
    const s = scripted([call('c1', 'smb_records', { server: '10.0.0.1' }), answer('done')]);
    const agent = Agent.create({ provider: s.provider as never, model: 'mock', maxIterations: 6 })
      .tools([rangeTool([])])
      .time({ zone: LA })
      .build();
    await agent.run({ message: 'any SMB on 10.0.0.1?', time: { now: NOW } });
    expect(s.requests.every((r) => timeLineOf(r) === undefined)).toBe(true);
  });
});

describe('G14 — the control window is a fact about the person’s turn: served on every request, period tool or not', () => {
  const WINDOW = { from: '2026-10-09T08:00:00-07:00', to: '2026-10-09T08:40:00-07:00' };
  /** The control half with no tool values — the window alone (`serve.ts` · `controlSentence`). */
  const BARE_LINE =
    `${TIME_LINE_SOURCE} The window the person set in the app's time control is 2026-10-09 ` +
    '08:00–08:39 America/Los_Angeles (UTC-07:00). An answer built on it states that window.';

  /** A tool that declares no period — with an `askOrAssume` rule (arms the inputs layer) or none. */
  function noPeriodTool(ruled: boolean) {
    return defineTool({
      name: 'smb_sessions',
      description: 'Open SMB sessions on a server.',
      inputSchema: {
        type: 'object',
        properties: { server: { type: 'string' }, limit: { type: 'integer' } },
      },
      ...(ruled && { askOrAssume: { limit: { assume: 50 } } }),
      execute: () => '{"sessions":[]}',
    } as never);
  }

  function run(
    tools: readonly Tool[],
    opts: { time?: boolean; mode?: 'dynamic' | 'dynamic-grouped' } = {},
  ) {
    const s = scripted([call('c1', 'smb_sessions', { server: '10.0.0.1' }), answer('done')]);
    let b = Agent.create({
      provider: s.provider as never,
      model: 'mock',
      maxIterations: 6,
      ...(opts.mode !== undefined && { reactMode: opts.mode }),
    }).tools(tools);
    if (opts.time !== false) b = b.time({ zone: LA });
    return { agent: b.build(), requests: s.requests };
  }

  for (const [ruled, mode] of [
    [true, 'dynamic'],
    [false, 'dynamic'],
    [false, 'dynamic-grouped'],
  ] as const) {
    it(`a turn whose tools declare no period (${
      ruled ? 'inputs layer armed' : 'no inputs layer'
    }, ${mode}) names the window on EVERY request, without tool values`, async () => {
      const { agent, requests } = run([noPeriodTool(ruled)], { mode });
      const out = await agent.run({
        message: 'any open SMB sessions on 10.0.0.1?',
        time: { now: NOW, window: WINDOW },
      });
      expect(isInputPause(out)).toBe(false);
      expect(requests).toHaveLength(2);
      for (const req of requests) expect(timeLineOf(req)).toBe(BARE_LINE);
      // The served-request rebuild reproduces it byte for byte, last and request-only.
      for (const epoch of [1, 2]) {
        const view = servedAt(agent.getSnapshot(), epoch)!;
        expect(view.messages.requestOnly).toEqual([
          { role: 'user', text: BARE_LINE, reason: 'time-window-line' },
        ]);
      }
    });
  }

  it('beside a period tool the line keeps that tool’s values — on every request, the second one too', async () => {
    const { agent, requests } = run([noPeriodTool(true), rangeTool([])]);
    await agent.run({ message: 'any open SMB sessions?', time: { now: NOW, window: WINDOW } });
    expect(requests).toHaveLength(2);
    for (const req of requests) {
      expect(timeLineOf(req)).toContain('— smb_records window "2026-10-09T08:00:00-07:00..');
      expect(timeLineOf(req)).toContain('A call may pass these values as written');
    }
  });

  it('a period tool that cannot read the window gives no values — the window alone is still named', async () => {
    // `direction: 'past'` + a window in the future: the tool refuses it, so no value is a permission.
    const future = { from: '2026-10-10T08:00:00-07:00', to: '2026-10-10T09:00:00-07:00' };
    const { agent, requests } = run([rangeTool([])]);
    await agent.run({ message: 'any SMB?', time: { now: NOW, window: future } });
    expect(timeLineOf(requests[0])).toBe(
      `${TIME_LINE_SOURCE} The window the person set in the app's time control is 2026-10-10 ` +
        '08:00–08:59 America/Los_Angeles (UTC-07:00). An answer built on it states that window.',
    );
  });

  it('byte identity — `.time()` with no control window serves no line; without `.time()` the requests are the same bytes', async () => {
    const timed = run([noPeriodTool(false)]);
    await timed.agent.run({ message: 'any open SMB sessions?', time: { now: NOW } });
    expect(timed.requests.every((r) => timeLineOf(r) === undefined)).toBe(true);
    const plain = run([noPeriodTool(false)], { time: false });
    await plain.agent.run({ message: 'any open SMB sessions?' });
    expect(plain.requests.every((r) => timeLineOf(r) === undefined)).toBe(true);
    expect(JSON.stringify(timed.requests.map((r) => r.messages))).toBe(
      JSON.stringify(plain.requests.map((r) => r.messages)),
    );
  });
});

describe('review of packet "gaps" — what G2 must not ask, and what its refusal names', () => {
  it('a greeting names no time: "Good morning, …" asks nothing, serves no line, the default runs', async () => {
    const seen: Record<string, unknown>[] = [];
    const { agent, requests } = build(
      [call('c1', 'smb_records', { server: '10.0.0.1' }), answer('done')],
      [rangeTool(seen)],
    );
    const out = await agent.run({
      message: 'Good morning, any SMB on 10.0.0.1?',
      time: { now: NOW },
    });
    expect(isInputPause(out)).toBe(false);
    expect(seen).toEqual([{ server: '10.0.0.1', window: '-30m' }]);
    expect(requests.every((r) => timeLineOf(r) === undefined)).toBe(true);
    expect(ofKind(agent, 'time-reading').some((r) => r.quote !== undefined)).toBe(false);
  });

  it('a free answer no form can read is refused naming the WIDEST form cap, not the period’s', async () => {
    // period maxRange 7d; the bounds form reads up to 30d on its own; the look-back keeps 7d. The
    // tool reads at most 30d (`toolFacts`), so a 40-day answer is refused "no wider than 30d".
    const seen: Record<string, unknown>[] = [];
    const tool = defineTool({
      name: 'flows',
      description: 'Network flows.',
      inputSchema: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
          window: { type: 'string' },
        },
      },
      askOrAssume: { from: { ask: 'From?' }, to: { ask: 'To?' }, window: { assume: '1h' } },
      period: {
        forms: [
          {
            kind: 'bounds',
            from: { argument: 'from', as: 'iso' },
            to: { argument: 'to', as: 'iso', edge: 'exclusive' },
            maxRange: '30d',
          },
          { kind: 'lookback', argument: 'window', signed: false },
        ],
        direction: 'past',
        maxRange: '7d',
      },
      execute: (a) => {
        seen.push({ ...a });
        return 'ok';
      },
    });
    const { agent, requests } = build([call('c1', 'flows', {}), answer('done')], [tool]);
    let out = await agent.run({ message: 'any flows yesterday morning?', time: { now: NOW } });
    const forty = '2026-08-01T00:00:00-07:00/2026-09-10T00:00:00-07:00';
    for (let i = 0; i < 5 && isInputPause(out); i++) {
      const p = paused(out);
      out = await agent.resume(p.checkpoint as never, {
        requestId: p.awaitingInput.requestId,
        values: { f1: forty },
      });
    }
    expect(isInputPause(out)).toBe(false);
    expect(seen).toEqual([]);
    const result = requests
      .flatMap((r) => r.messages)
      .find((m) => m.role === 'tool' && typeof m.content === 'string')?.content as string;
    expect(result).toContain('no wider than 30d');
    expect(result).not.toContain('no wider than 7d');
  });
});

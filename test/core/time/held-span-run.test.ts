/**
 * A source that holds none of the asked time — its held span is served to the
 * model IN THE PERSON'S ZONE, and the evidence gate knows those spellings
 * (take 3 of the demo video, agentfootprint 9.134.4).
 *
 * The field case: the person asked about "yesterday morning" (America/Los_Angeles);
 * `pscale_client_health` declared `absent()` with `period.held` = the store's span,
 * 2026-10-01T16:22:44.3Z – 17:02:44.3Z — 9:22–10:02 AM PDT. The model converted the
 * UTC instants itself and wrote "the available window is October 1, 9:22 AM–5:02 PM
 * Pacific": the end was never converted. The gate then flagged `9:22`, `4:22` and `5:02`
 * ("3 values not traced") — it knew none of the spellings.
 *
 * Layer by layer: the tool returned the held span as UTC instants (right — a zoned
 * instant is unambiguous); the results layer filed the `period` row, verdict
 * `not-held` (right); what the library SERVED was the static `not-held` clause pointing
 * at `period.held` — the span in UTC only, the person's zone nowhere, so the zone
 * arithmetic was left to the model. That is the first wrong layer. The library knows
 * the person's zone (`.time()`), so it serves the conclusion: what the call asked about
 * and what the source holds, both in the person's zone (`coverage/timeLimits.ts`
 * · `heldLine`, in the ONE served time line), and the gate's derived spellings
 * (`core/time/forms.ts` · `timeFormsOf`, its `held` source) list exactly those spellings.
 *
 * Test types:
 *   functional  — a real paused-and-resumed `.time()` run: the request after the absent result
 *                 carries the held span in the person's zone, once, in the library's note;
 *   integration — the answer that repeats the served span ("9:22–10:02 AM PDT") is not flagged;
 *                 its spellings are filed `time-derived` (the library converted them);
 *   negative    — the take-3 answer's unconverted end ("5:02") is still flagged; a covered read
 *                 serves no held line and files no `held`;
 *   byte identity — without `.time()` the row carries no `held` and nothing is served.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  absent,
  Agent,
  defineTool,
  englishTimeReader,
  isInputPause,
  type Tool,
} from '../../../src/index.js';
import type { LLMMessage, LLMRequest, LLMResponse } from '../../../src/adapters/types.js';

const LA = 'America/Los_Angeles';
const NOW = '2026-10-01T17:17:10Z';
const QUESTION =
  'which clients on SHISOLPLPAP006 had slow operations from 6:00 AM to 12:00 PM on September 30';
const HELD = { from: '2026-10-01T16:22:44.300882944Z', to: '2026-10-01T17:02:44.300882944Z' };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse(NOW) + 5_000);
});
afterEach(() => {
  vi.useRealTimers();
});

type Reply = { content: string; toolCalls?: { id: string; name: string; args: object }[] };

/** A scripted provider that keeps every request it was sent. */
function scripted(script: readonly Reply[]) {
  let i = 0;
  const requests: LLMRequest[] = [];
  return {
    requests,
    provider: {
      name: 'held-span-mock',
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

/** The take-3 tool: bounds asked by its own rule; nothing in the asked window — the store's span declared. */
function clientHealth(held: 'none' | 'all' = 'none'): Tool {
  return defineTool({
    name: 'pscale_client_health',
    description: 'Clients with slow operations on a cluster over a window.',
    inputSchema: {
      type: 'object',
      properties: {
        cluster: { type: 'string' },
        start: { type: 'string' },
        stop: { type: 'string' },
      },
    },
    askOrAssume: { start: { ask: 'From when?' }, stop: { ask: 'Until when?' } },
    period: {
      forms: [
        {
          kind: 'bounds',
          from: { argument: 'start', as: 'iso' },
          to: { argument: 'stop', as: 'iso', edge: 'exclusive' },
        },
      ],
    } as never,
    execute: () =>
      absent({
        what: 'client conversation samples for that cluster in the window',
        checked: [{ what: 'ps_client over 2026-09-30T13:00:00Z to 2026-09-30T19:00:00Z' }],
        tryInstead:
          'The store holds no ps_client samples for this cluster in that window: its samples ' +
          'start at 2026-10-01T16:22:44.300882944Z. Ask about a window inside that span.',
        period: {
          queried: { from: '2026-09-30T13:00:00Z', to: '2026-09-30T18:59:50Z' },
          held:
            held === 'none'
              ? HELD
              : { from: '2026-09-29T00:00:00Z', to: '2026-10-01T17:02:44.300882944Z' },
          readAt: '2026-10-01T17:17:27Z',
        },
      }),
  }) as Tool;
}

interface Paused {
  checkpoint: unknown;
  awaitingInput: { requestId: string; fields: { id: string; enum?: string[] }[] };
}

/** The take-3 turn to its answer: the reading is offered, the person confirms it. */
async function heldRun(
  answerText: string,
  options: { time?: boolean; held?: 'none' | 'all' } = {},
) {
  const time = options.time ?? true;
  const script = scripted([
    {
      content: '',
      toolCalls: [{ id: 'c1', name: 'pscale_client_health', args: { cluster: 'SHISOLPLPAP006' } }],
    },
    { content: answerText },
  ]);
  const builder = Agent.create({
    provider: script.provider as never,
    model: 'mock',
    maxIterations: 6,
  })
    .tools([clientHealth(options.held)])
    .namesAndNumbersFromEvidence({ posture: 'assist' });
  const agent = (time ? builder.time({ zone: LA, reader: englishTimeReader() }) : builder).build();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    let result: unknown = await agent.run({
      message: QUESTION,
      ...(time && { time: { now: NOW } }),
    } as never);
    // The time ask offers the reading and the person confirms it; unarmed, the arguments ask
    // asks each bound and the person types it.
    const typed = ['2026-09-30T06:00:00-07:00', '2026-09-30T12:00:00-07:00'];
    for (let i = 0; i < 3 && isInputPause(result); i += 1) {
      const p = result as unknown as Paused;
      result = await agent.resume(p.checkpoint as never, {
        requestId: p.awaitingInput.requestId,
        values: Object.fromEntries(
          p.awaitingInput.fields.map((f, k) => [f.id, f.enum?.[0] ?? typed[k] ?? typed[0]!]),
        ),
      });
    }
    expect(isInputPause(result)).toBe(false);
  } finally {
    warn.mockRestore();
  }
  const rows =
    (agent.findings() as ({ kind: string } & Record<string, unknown>)[] | undefined) ?? [];
  return {
    agent,
    requests: script.requests,
    flagged: agent.unsupportedValues()?.values.map((v) => v.value) ?? [],
    rows,
  };
}

/** The library's served time line on the request that answered (the last request). */
function servedTimeLine(requests: readonly LLMRequest[]): string | undefined {
  const last = requests[requests.length - 1];
  const messages = (last?.messages ?? []) as readonly LLMMessage[];
  return messages
    .filter((m) => m.role === 'user' && m.content.startsWith('[A note from the library'))
    .map((m) => m.content)
    .pop();
}

describe('a source that holds none of the asked time — the held span in the person’s zone', () => {
  it('files the held span on the `period` row under `.time()`', async () => {
    const run = await heldRun('No samples.');
    const period = run.rows.filter((r) => r.kind === 'period');
    expect(period).toHaveLength(1);
    expect(period[0]).toMatchObject({
      verdict: 'not-held',
      held: {
        queried: { from: '2026-09-30T13:00:00Z', to: '2026-09-30T18:59:50Z' },
        held: HELD,
      },
    });
  });

  it('serves the conclusion: what the call asked about and what the source holds, both in the person’s zone', async () => {
    const run = await heldRun('No samples.');
    const line = servedTimeLine(run.requests);
    expect(line).toBeDefined();
    expect(line).toContain(
      'What the sources hold is not all of the time asked about — pscale_client_health asked ' +
        'about 2026-09-30 06:00:00–11:59:50 America/Los_Angeles (UTC-07:00); its source holds ' +
        '2026-10-01 09:22:44.300–10:02:44.300 America/Los_Angeles (UTC-07:00), which covers none of that time. ' +
        'So the answer to the person states what each source holds and claims nothing about the ' +
        'time it does not hold.',
    );
    // The conversion is the library's: no UTC instant of the held span is left for the model to convert in the line.
    expect(line).not.toContain('16:22');
  });

  it('an answer that repeats the served span is not flagged — its spellings are the library’s (time-derived)', async () => {
    const run = await heldRun(
      'The store holds no samples for SHISOLPLPAP006 on September 30 from 6:00 AM to noon. ' +
        "This source's samples cover October 1, 9:22 AM–10:02 AM PDT.",
    );
    expect(run.flagged).toEqual([]);
    const derived = run.rows.filter((r) => r.kind === 'time-derived');
    expect(JSON.stringify(derived)).toContain('9:22');
    expect(JSON.stringify(derived)).toContain('10:02');
  });

  it('NEGATIVE: the take-3 answer’s unconverted end is still flagged — only the served spellings are derived', async () => {
    const run = await heldRun(
      'The store holds no samples for SHISOLPLPAP006 on September 30 from 6:00 AM to noon. ' +
        'The available window is October 1, 9:22 AM–5:02 PM Pacific.',
    );
    expect(run.flagged).toContain('5:02');
    expect(run.flagged).not.toContain('9:22');
  });

  it('NEGATIVE: a covered read serves no held line and files no `held`', async () => {
    const run = await heldRun('No samples.', { held: 'all' });
    const period = run.rows.filter((r) => r.kind === 'period');
    expect(period[0]).toMatchObject({ verdict: 'covered' });
    expect(period[0]).not.toHaveProperty('held');
    expect(servedTimeLine(run.requests) ?? '').not.toContain('its source holds');
  });

  it('BYTE IDENTITY: without `.time()` the row carries no `held` and no time line is served', async () => {
    const run = await heldRun('No samples.', { time: false });
    const period = run.rows.filter((r) => r.kind === 'period');
    expect(period[0]).toMatchObject({ verdict: 'not-held' });
    expect(period[0]).not.toHaveProperty('held');
    expect(servedTimeLine(run.requests)).toBeUndefined();
  });
});

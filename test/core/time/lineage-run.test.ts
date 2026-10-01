/**
 * Evidence lineage at grain, through real agents (time design § 9.5, step T7):
 * `.time({ reader })` beside `.namesAndNumbersFromEvidence()`. A scripted
 * provider and the wall clock pinned with fake `Date` — no model is called.
 *
 * Law: the gate asks ONE owner (`core/time/forms.ts` · `timeFormsOf`) which
 * spellings of a time are the person's (`said` — exempt, like their words) and
 * which the library produced from a reading (`derived` — filed as a
 * `time-derived` row, folded "not sure", never "known", never called
 * invented). A time no reading produced still fails.
 *
 * Test types:
 *   functional   — the field run ("10/09/26 8 AM to 8:40 AM PST", zone answered, reading confirmed):
 *                  the person's parts at grain (`8:00`, `08:40`, `2026-10-09`) are clean and file
 *                  nothing; the library's (`08:41`, `15:00Z`, `-07:00`, the epoch the call ran
 *                  with) are filed `time-derived` and fold "not sure" with `derived-from-reading`;
 *   negative     — an invented time and year are still flagged, beside the derived row;
 *   regression   — the landed fix's field case (their "8 Am", a chosen date) stays unflagged;
 *                  the take-2 video's answer ("that 20-minute window" for a confirmed "6:25 to
 *                  6:45 AM") is derived, never flagged, and an invented "45-minute" still is;
 *   byte identity — without `.time()` the gate files no `time-derived` row and its verdict is the
 *                  one it always was (`test/core/time/forms.test.ts` pins the text rule).
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
import { assessAnswer } from '../../../src/core/agent/assessment/assess.js';

type Reply = { content: string; toolCalls?: { id: string; name: string; args: object }[] };

function scripted(script: readonly Reply[]) {
  let i = 0;
  return {
    name: 'time-lineage-mock',
    complete: async (_req: LLMRequest): Promise<LLMResponse> => {
      const reply = script[Math.min(i, script.length - 1)] ?? { content: 'done' };
      i += 1;
      return {
        content: reply.content,
        toolCalls: reply.toolCalls ?? [],
        usage: { input: 0, output: 0 },
      };
    },
  };
}

const LA = 'America/Los_Angeles';
const NOW = '2026-10-09T15:40:00Z';
const NOW_MS = Date.parse(NOW);
const FIELD = 'Show client activity 10/09/26 8 AM to 8:40 AM PST';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW_MS + 5_000);
});
afterEach(() => {
  vi.useRealTimers();
});

/** Two epoch-ms arguments, asked by the tool's own rule — an absolute form. */
function epochTool(): Tool {
  return defineTool({
    name: 'client_activity',
    description: 'Client operations over a window.',
    inputSchema: {
      type: 'object',
      properties: { start_time: { type: 'integer' }, end_time: { type: 'integer' } },
    },
    askOrAssume: { start_time: { ask: 'From when?' }, end_time: { ask: 'Until when?' } },
    period: {
      forms: [
        {
          kind: 'bounds',
          from: { argument: 'start_time', as: 'epoch-ms' },
          to: { argument: 'end_time', as: 'epoch-ms', edge: 'exclusive' },
        },
      ],
    } as never,
    execute: () => '{"ops":42}',
  }) as Tool;
}

type Row = { kind: string } & Record<string, unknown>;
const ofKind = (agent: { findings(): unknown }, kind: string): Row[] =>
  ((agent.findings() as Row[] | undefined) ?? []).filter((r) => r.kind === kind);

interface Paused {
  checkpoint: unknown;
  awaitingInput: { requestId: string; fields: { enum?: string[] }[] };
}
function paused(result: unknown): Paused {
  if (!isInputPause(result)) throw new Error('expected an input pause');
  return result as never as Paused;
}

/** The field run to its answer: the zone is answered, the first reading confirmed. */
async function fieldRun(answerText: string, time = true) {
  const agent = (() => {
    const b = Agent.create({
      provider: scripted([
        { content: '', toolCalls: [{ id: 'c1', name: 'client_activity', args: {} }] },
        { content: answerText },
      ]) as never,
      model: 'mock',
      maxIterations: 6,
    })
      .tools([epochTool()])
      .namesAndNumbersFromEvidence({ posture: 'assist' });
    return (time ? b.time({ zone: LA, reader: englishTimeReader() }) : b).build();
  })();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    const first = paused(await agent.run({ message: FIELD, time: { now: NOW } }));
    const second = paused(
      await agent.resume(first.checkpoint as never, {
        requestId: first.awaitingInput.requestId,
        values: { f1: LA },
      }),
    );
    const done = await agent.resume(second.checkpoint as never, {
      requestId: second.awaitingInput.requestId,
      values: { f1: second.awaitingInput.fields[0]!.enum![0]! },
    });
    expect(isInputPause(done)).toBe(false);
  } finally {
    warn.mockRestore();
  }
  const standing = assessAnswer({ snapshot: agent.getLastSnapshot() });
  return {
    agent,
    flagged: agent.unsupportedValues()?.values.map((v) => v.value) ?? [],
    derived: ofKind(agent, 'time-derived'),
    standing,
  };
}

describe('the field run — the person’s parts at grain, the library’s spellings', () => {
  it('the person’s parts at grain are clean: nothing flagged, nothing filed as derived', async () => {
    const run = await fieldRun('Between 8:00 and 08:40 on 2026-10-09 there were 42 operations.');
    expect(run.flagged).toEqual([]);
    expect(run.derived).toEqual([]);
    expect(run.standing.reasons.map((r) => r.reason)).not.toContain('derived-from-reading');
  });

  it('the library’s spellings are filed `time-derived` and fold "not sure" — never invented, never known', async () => {
    const run = await fieldRun(
      'From 15:00Z (-07:00) to 08:41, start_time 1791558000000: 42 operations.',
    );
    expect(run.flagged).toEqual([]);
    expect(run.derived).toHaveLength(1);
    expect(run.derived[0]).toMatchObject({ kind: 'time-derived', turn: 1 });
    expect(run.derived[0]!.values).toEqual(expect.arrayContaining(['08:41', '1791558000000']));
    expect(run.standing.standing).toBe('not-sure');
    expect(run.standing.reasons.map((r) => r.reason)).toContain('derived-from-reading');
  });

  it('a time no reading produced still fails, beside the derived row', async () => {
    const run = await fieldRun(
      'At 09:15 in 2031 there were 42 operations; the window ended 08:41.',
    );
    expect(run.flagged).toEqual(expect.arrayContaining(['09:15', '2031']));
    expect(run.derived[0]!.values).toEqual(['08:41']);
  });
});

describe('byte identity — without `.time()`', () => {
  it('no `time-derived` row: a derived-only spelling is flagged as it always was', async () => {
    const agent = Agent.create({
      provider: scripted([{ content: 'It ended at 08:41 on 2026-10-09.' }]) as never,
      model: 'mock',
    })
      .namesAndNumbersFromEvidence({ posture: 'assist' })
      .build();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await agent.run({ message: 'what happened 8 Am to 8:40 AM PST?' });
    warn.mockRestore();
    expect(agent.unsupportedValues()?.values.map((v) => v.value)).toEqual(['08:41', '2026-10-09']);
  });
});

// ─── The take-2 video: a duration the person's own window implies ──────────

/** The answer the run gave, byte for byte (vid2-events, run-1790863757220-6, iteration 5). */
const TAKE2_ANSWER =
  'Two clients on SHISOLPLPAP006 had create operations slower than 200 ms between 6:25–6:45 AM on October 1. Both clients in the window exceeded the threshold during that period.\n\nSee the table on the Data panel for the client names, interval counts, median/worst latencies, nodes and protocols involved. The result comes from the ps_client telemetry and covers what the collector observed during that 20-minute window.';
const TAKE2_NOW = '2026-10-01T14:08:49Z';
const TAKE2_QUESTION =
  'what clients on SHISOLPLPAP006 had operations slower than 200 ms from 6:25 to 6:45 AM on October 1';

/** An ISO bounds tool, both ends asked — the shape of the run's `pscale_client_health`. */
function boundsTool(): Tool {
  return defineTool({
    name: 'pscale_client_health',
    description: 'Clients over a window.',
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
      '{"clients":[{"client":"shsectraplw101","slow":2},{"client":"shsectraplw102","slow":1}]}',
  }) as Tool;
}

/** The take-2 run: the reading of "6:25 to 6:45 AM on October 1" confirmed, then `answerText`. */
async function take2Run(answerText: string) {
  vi.setSystemTime(Date.parse(TAKE2_NOW) + 5_000);
  const agent = Agent.create({
    provider: scripted([
      {
        content: '',
        toolCalls: [
          { id: 'c1', name: 'pscale_client_health', args: { cluster: 'SHISOLPLPAP006' } },
        ],
      },
      { content: answerText },
    ]) as never,
    model: 'mock',
    maxIterations: 6,
  })
    .tools([boundsTool()])
    .namesAndNumbersFromEvidence({ posture: 'assist' })
    .time({ zone: LA, reader: englishTimeReader() })
    .build();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    const asked = paused(await agent.run({ message: TAKE2_QUESTION, time: { now: TAKE2_NOW } }));
    // The person confirms the offered reading — the window [06:25, 06:46) PDT.
    const offered = asked.awaitingInput.fields[0]!.enum![0]!;
    expect(offered).toBe('2026-10-01T06:25:00-07:00/2026-10-01T06:46:00-07:00');
    const done = await agent.resume(asked.checkpoint as never, {
      requestId: asked.awaitingInput.requestId,
      values: { f1: offered },
    });
    expect(isInputPause(done)).toBe(false);
  } finally {
    warn.mockRestore();
  }
  return {
    flagged: agent.unsupportedValues()?.values.map((v) => v.value) ?? [],
    derived: ofKind(agent, 'time-derived'),
    standing: assessAnswer({ snapshot: agent.getLastSnapshot() }),
  };
}

describe('the take-2 video — the window’s length is derived from the reading, never invented', () => {
  it('the exact answer text from the run: "20-minute" is filed derived, nothing flagged', async () => {
    const run = await take2Run(TAKE2_ANSWER);
    expect(run.flagged).toEqual([]);
    expect(run.derived).toHaveLength(1);
    expect(run.derived[0]!.values).toEqual(['20-minute']);
    expect(run.standing.reasons.map((r) => r.reason)).toContain('derived-from-reading');
    expect(run.standing.reasons.map((r) => r.reason)).not.toContain('value-unsupported');
  });

  it('the end-of-grain length is the library’s reading too: "21-minute" is derived', async () => {
    const run = await take2Run('Two clients were slow in that 21-minute window.');
    expect(run.flagged).toEqual([]);
    expect(run.derived[0]!.values).toEqual(['21-minute']);
  });

  it('NEGATIVE: an invented duration ("45-minute") is still flagged', async () => {
    const run = await take2Run('Two clients were slow in that 45-minute window.');
    expect(run.flagged).toEqual(['45-minute']);
    expect(run.derived).toEqual([]);
  });
});

/**
 * G16 — the current date and time, served by the library. Apps used to serve
 * their own "application clock" block; with the time layer armed the model got
 * NO current date on any turn, so "today" and "this morning" were answered
 * from its training date.
 *
 * Law: under `.time()` the run clock is the first sentence of the ONE served
 * time line on every request (`agent/arguments/serve.ts` · `clockSentence`) —
 * the library's conclusion, late, one line: the turn's `now` to the minute,
 * its weekday and date in the person's zone, the zone named (under an unknown
 * zone, G15: UTC, named as not known). Never without `.time()`. The line is
 * request-only (never history) and the served-request rebuild reproduces it.
 *
 * Test types:
 *   unit        — the sentence: the person's zone and offset, the weekday IN that zone (UTC's
 *                 Friday is Los Angeles's Thursday evening), cut to the minute, a DST change, the
 *                 unknown zone; no clock → no sentence;
 *   functional  — every request of a three-request turn carries it, last, in both dynamic chart
 *                 shapes; the classic mode's cached slot serves it on its first request (the
 *                 known limit, english-run.test.ts);
 *   integration — the served-request rebuild (`servedAt`) reproduces it byte for byte;
 *   performance — the token ceiling (the T6b rule's spirit: an added line is measured, not
 *                 assumed): the sentence alone costs ≤ 20 tokens and the whole line, when it is
 *                 the only one, ≤ 75 tokens per call (chars ÷ 4, the repo's estimate);
 *   byte identity — without `.time()` no request carries it.
 */

import { describe, expect, it } from 'vitest';

import { Agent, defineTool } from '../../../src/index.js';
import type { LLMRequest, LLMResponse } from '../../../src/adapters/types.js';
import {
  clockSentence,
  timeLine,
  TIME_LINE_SOURCE,
} from '../../../src/core/agent/arguments/serve.js';
import { servedAt } from '../../../src/lib/time-travel/servedView.js';

type Reply = { content: string; toolCalls?: { id: string; name: string; args: object }[] };

function scripted(script: readonly Reply[]) {
  let i = 0;
  const requests: LLMRequest[] = [];
  return {
    requests,
    provider: {
      name: 'time-clock-mock',
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

const call = (id: string): Reply => ({
  content: '',
  toolCalls: [{ id, name: 'list_jobs', args: {} }],
});

const LA = 'America/Los_Angeles';
const NOW = '2026-10-09T15:40:00Z';
const CLOCK = "This turn's time: Friday 2026-10-09 08:40 America/Los_Angeles (UTC-07:00).";
/** The repo's token estimate (`lib/context-ledger/contextLedger.ts` · `approxTokens`): chars ÷ 4. */
const approxTokens = (value: unknown): number => Math.ceil(JSON.stringify(value).length / 4);

const listJobs = () =>
  defineTool({
    name: 'list_jobs',
    description: 'The backup jobs.',
    inputSchema: { type: 'object', properties: {} },
    execute: () => '{"jobs":[]}',
  });

function run(mode: 'dynamic' | 'dynamic-grouped', time: boolean) {
  const s = scripted([call('c1'), call('c2'), { content: 'done' }]);
  let b = Agent.create({
    provider: s.provider as never,
    model: 'mock',
    maxIterations: 6,
    reactMode: mode,
  }).tool(listJobs());
  if (time) b = b.time({ zone: LA });
  return { agent: b.build(), requests: s.requests };
}

describe('G16 — the run clock sentence', () => {
  it('names the time to the minute, the weekday and date in the person’s zone, and the zone', () => {
    expect(clockSentence({ now: NOW, zone: LA })).toBe(CLOCK);
    // Cut to the minute — never seconds the model would echo as precision.
    expect(clockSentence({ now: '2026-10-09T15:40:59.999Z', zone: LA })).toBe(CLOCK);
    // The weekday is the PERSON's: 03:00 UTC on Friday is Thursday evening in Los Angeles.
    expect(clockSentence({ now: '2026-10-09T03:00:00Z', zone: LA })).toBe(
      "This turn's time: Thursday 2026-10-08 20:00 America/Los_Angeles (UTC-07:00).",
    );
    // Across a DST change the offset is the one in effect.
    expect(clockSentence({ now: '2026-11-02T17:00:00Z', zone: LA })).toBe(
      "This turn's time: Monday 2026-11-02 09:00 America/Los_Angeles (UTC-08:00).",
    );
    expect(clockSentence({ now: NOW, zone: 'Asia/Kolkata' })).toBe(
      "This turn's time: Friday 2026-10-09 21:10 Asia/Kolkata (UTC+05:30).",
    );
  });

  it('under an unknown zone (G15): UTC, named as not known — never a guessed zone', () => {
    expect(clockSentence({ now: NOW, zone: 'UTC', zoneUnknown: true })).toBe(
      "This turn's time: Friday 2026-10-09 15:40 UTC (the person's time zone is not known).",
    );
  });

  it('no clock, or one that cannot be spelled → no sentence', () => {
    expect(clockSentence(undefined)).toBeUndefined();
    expect(clockSentence({ now: 'not an instant', zone: LA } as never)).toBeUndefined();
  });

  it('PERFORMANCE: the token ceiling — the sentence ≤ 20 tokens; the line alone ≤ 75 per call', () => {
    const sentence = clockSentence({ now: NOW, zone: LA })!;
    const line = timeLine([sentence])!;
    const added = approxTokens({ role: 'user', content: line });
    // Measured (chars ÷ 4): the sentence 19, the clock-only line as sent 73 — the opening that
    // says who speaks is most of it, and it is said once whatever else the line holds.
    expect(approxTokens(sentence)).toBeLessThanOrEqual(20);
    expect(added).toBeLessThanOrEqual(75);
  });
});

describe('G16 — served on every request under `.time()`, never without', () => {
  for (const mode of ['dynamic', 'dynamic-grouped'] as const) {
    it(`every request of the turn ends with it, and the rebuild reproduces it (${mode})`, async () => {
      const { agent, requests } = run(mode, true);
      await agent.run({ message: 'which jobs ran?', time: { now: NOW } });
      expect(requests).toHaveLength(3);
      const line = `${TIME_LINE_SOURCE} ${CLOCK}`;
      for (const req of requests) {
        expect(req.messages[req.messages.length - 1]).toEqual({ role: 'user', content: line });
      }
      // Request-only: the conversation the next request carries never holds it.
      const history = requests[2]!.messages.slice(0, -1);
      expect(history.some((m) => m.content === line)).toBe(false);
      for (const epoch of [1, 2, 3]) {
        expect(servedAt(agent.getSnapshot(), epoch)!.messages.requestOnly).toEqual([
          { role: 'user', text: line, reason: 'time-window-line' },
        ]);
      }
    });
  }

  it('byte identity — without `.time()` no request carries it', async () => {
    const { agent, requests } = run('dynamic', false);
    await agent.run({ message: 'which jobs ran?' });
    expect(requests).toHaveLength(3);
    for (const req of requests) {
      expect(
        req.messages.some(
          (m) => typeof m.content === 'string' && m.content.startsWith(TIME_LINE_SOURCE),
        ),
      ).toBe(false);
    }
    expect(servedAt(agent.getSnapshot(), 1)!.messages.requestOnly).toEqual([]);
  });
});

/**
 * Public Agent/native pause coverage for the additive time correction sibling.
 * The provider is scripted; the actual English reader, input door, checkpoint,
 * native resume, time binding and tool dispatcher remain in the path.
 * Published old-pause/field-byte fixtures have their separate owner.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Agent,
  InputRequestError,
  defineTool,
  englishTimeReader,
  isInputPause,
  type InputValue,
} from '../../src/index.js';
import { recordRun } from '../../src/observe.js';
import { SHOWN_ARGS } from '../../src/core/toolShownArgs.js';
import {
  answer,
  batch,
  events,
  scripted,
  stored,
  type Reply,
} from '../core/agent/arguments/askReviewHarness.js';

const NOW = '2026-11-06T18:01:00Z';
const FROM = Date.parse('2026-11-06T17:01:00Z');
const TO = Date.parse('2026-11-06T18:01:00.001Z');
const LA = 'America/Los_Angeles';
const NY = 'America/New_York';
const MESSAGE = 'Show activity for last 1 hour in America/Los_Angeles';
const SECRET = 'PRIVATE-TIME-ACCOUNT-42738';
const live: Agent[] = [];
type Mode = 'dynamic' | 'dynamic-grouped';

function make(
  options: {
    mode?: Mode;
    privateAccount?: boolean;
    seen?: Record<string, unknown>[];
    script?: readonly Reply[];
  } = {},
) {
  const seen = options.seen ?? [];
  const provider = scripted(
    options.script ?? [batch({ id: 'query-one', name: 'activity', args: {} }), answer('Done.')],
  );
  const tool = defineTool({
    name: 'activity',
    description: 'Read activity over the confirmed interval.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'integer' },
        to: { type: 'integer' },
        ...(options.privateAccount && { account: { type: 'string' } }),
      },
    },
    askOrAssume: {
      from: { ask: 'From when?' },
      to: { ask: 'Until when?' },
      ...(options.privateAccount && { account: { ask: 'Account?' } }),
    },
    period: {
      forms: [
        {
          kind: 'bounds',
          from: { argument: 'from', as: 'epoch-ms' },
          to: { argument: 'to', as: 'epoch-ms', edge: 'exclusive' },
        },
      ],
    },
    execute: (args) => {
      seen.push({ ...args });
      return 'Activity read.';
    },
  });
  const actualTool = options.privateAccount
    ? {
        ...tool,
        [SHOWN_ARGS]: (args: Record<string, unknown>) =>
          Object.hasOwn(args, 'account') ? { ...args, account: 'REDACTED' } : args,
      }
    : tool;
  const agent = Agent.create({
    provider: provider.provider as never,
    model: 'mock',
    maxIterations: 5,
    reactMode: options.mode ?? 'dynamic',
  })
    .tool(actualTool)
    .time({
      zone: LA,
      reader: englishTimeReader(),
      // A caller's explicit map, rather than a library guess about EST.
      policy: { abbreviations: { EST: { zone: NY, offset: '-05:00' } } },
    })
    .build();
  live.push(agent);
  return { agent, seen, requests: provider.requests };
}

function paused(value: unknown) {
  if (!isInputPause(value)) throw new Error('Expected a real native input pause');
  return value;
}
function pair(outcome: ReturnType<typeof paused>) {
  const range = outcome.awaitingInput.fields.find((field) => field.format === 'time-range');
  if (range === undefined) throw new Error('Expected the retained time-range field');
  const correction = outcome.awaitingInput.fields.find(
    (field) => field.id === `${range.id}-correction`,
  );
  if (correction === undefined) throw new Error('Expected the declared correction sibling');
  expect(range.required).toBe(false);
  expect(correction).toMatchObject({ type: 'string', required: false });
  expect(correction.format).toBeUndefined();
  expect(correction.enum).toBeUndefined();
  return { range, correction };
}
function choice(outcome: ReturnType<typeof paused>): string {
  const { range } = pair(outcome);
  expect(range.enum).toHaveLength(1);
  const value = range.enum?.[0];
  if (typeof value !== 'string') throw new Error('Expected one existing ISO range choice');
  return value;
}
function bounds(value: string): number[] {
  return value.split('/').map((endpoint) => Date.parse(endpoint));
}
function replies(agent: Agent) {
  return (agent.findings() ?? []).filter((row) => row.kind === 'time-reply');
}
async function reply(
  agent: Agent,
  pause: ReturnType<typeof paused>,
  values: Record<string, InputValue>,
) {
  return agent.resume(stored(pause), { requestId: pause.awaitingInput.requestId, values });
}
async function start(made: ReturnType<typeof make>) {
  const first = paused(await made.agent.run({ message: MESSAGE, time: { now: NOW } }));
  expect(pair(first).range.id).toBe('f1');
  expect(bounds(choice(first))).toEqual([FROM, TO]);
  expect(made.seen).toEqual([]);
  expect(made.requests).toHaveLength(1);
  return first;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse(NOW));
});
afterEach(async () => {
  try {
    for (const agent of live.splice(0)) await agent.shutdown();
  } finally {
    vi.useRealTimers();
  }
});

describe.each(['dynamic', 'dynamic-grouped'] as const)('%s native time reply', (mode) => {
  it.each(['same', 'fresh'] as const)(
    '%s: correction reasks before one range confirmation, with the original elapsed anchor',
    async (shape) => {
      const firstRun = make({ mode });
      const first = await start(firstRun);
      const original = pair(first).range;
      vi.setSystemTime(Date.parse(NOW) + 6 * 60 * 60 * 1000);
      const resumed =
        shape === 'same'
          ? firstRun
          : make({
              mode,
              seen: firstRun.seen,
              script: [answer('Done.')],
            });
      const second = paused(
        await reply(resumed.agent, first, {
          [pair(first).correction.id]: NY,
        }),
      );
      const corrected = pair(second).range;
      expect(corrected.id).toBe(original.id);
      expect(corrected.format).toBe(original.format);
      expect(corrected.enum).toEqual(original.enum);
      expect(corrected.labels?.join(' ')).toContain(NY);
      expect(corrected.labels?.join(' ')).not.toContain(LA);
      expect(bounds(choice(second))).toEqual([FROM, TO]);
      expect(firstRun.seen).toEqual([]);
      expect(resumed.requests).toHaveLength(shape === 'same' ? 1 : 0);
      expect(replies(resumed.agent).at(-1)).toMatchObject({
        decision: 'reask',
        rule: 'zone-corrected',
      });
      const done = await reply(resumed.agent, second, { [corrected.id]: choice(second) });
      expect(done).toBe('Done.');
      expect(firstRun.seen).toEqual([{ from: FROM, to: TO }]);
      expect(replies(resumed.agent).at(-1)).toMatchObject({
        decision: 'range',
        rule: 'range-confirmed',
      });
      expect(
        (resumed.agent.findings() ?? []).find((row) => row.kind === 'time-answer'),
      ).toMatchObject({ zone: NY, how: 'confirmed' });
      expect((resumed.agent.findings() ?? []).find((row) => row.kind === 'clock')).toMatchObject({
        now: NOW,
      });
    },
  );
});

describe('native correction meanings', () => {
  it('reads the caller-mapped EST correction as a new proposal, never a strict-range error', async () => {
    const made = make();
    const first = await start(made);
    const second = paused(
      await reply(made.agent, first, {
        [pair(first).correction.id]: 'EST time zone',
      }),
    );
    expect(pair(second).range.labels?.join(' ')).toContain(NY);
    expect(bounds(choice(second))).toEqual([FROM, TO]);
    expect(second.awaitingInput.refused).toBeUndefined();
    expect(made.seen).toEqual([]);
    expect(made.requests).toHaveLength(1);
    await reply(made.agent, second, { [pair(second).range.id]: choice(second) });
    expect(made.seen).toEqual([{ from: FROM, to: TO }]);
  });

  it('re-resolves time words at the saved clock, then asks to confirm the changed interval', async () => {
    const made = make();
    const first = await start(made);
    vi.setSystemTime(Date.parse(NOW) + 24 * 60 * 60 * 1000);
    const second = paused(
      await reply(made.agent, first, {
        [pair(first).correction.id]: 'last 2 hours in America/New_York',
      }),
    );
    expect(bounds(choice(second))).toEqual([FROM - 60 * 60 * 1000, TO]);
    expect(pair(second).range.labels?.join(' ')).toContain(NY);
    expect(made.seen).toEqual([]);
    expect(made.requests).toHaveLength(1);
    expect(replies(made.agent).at(-1)).toMatchObject({
      decision: 'reask',
      rule: 'time-words-corrected',
    });
    await reply(made.agent, second, { [pair(second).range.id]: choice(second) });
    expect(made.seen).toEqual([{ from: FROM - 60 * 60 * 1000, to: TO }]);
  });
});

describe('pending and strict native reply boundaries', () => {
  it.each(['neither', 'both', 'unreadable'] as const)(
    '%s remains pending without dispatch',
    async (kind) => {
      const made = make();
      const first = await start(made);
      const { range, correction } = pair(first);
      const values: Record<string, InputValue> =
        kind === 'neither'
          ? {}
          : kind === 'both'
          ? { [range.id]: choice(first), [correction.id]: NY }
          : { [correction.id]: 'no' };
      const second = paused(await reply(made.agent, first, values));
      expect(choice(second)).toBe(choice(first));
      expect(made.seen).toEqual([]);
      expect(made.requests).toHaveLength(1);
      expect(replies(made.agent).at(-1)).toMatchObject({
        decision: 'hold',
        rule: kind === 'unreadable' ? 'unreadable-correction' : `${kind}-filled`,
      });
      const wording = pair(second).range.description ?? second.awaitingInput.question;
      expect(wording).toMatch(/range|change|correction/i);
      expect(wording).not.toMatch(/not a start and an end|offset on both ends/i);
      await reply(made.agent, second, { [pair(second).range.id]: choice(second) });
      expect(made.seen).toEqual([{ from: FROM, to: TO }]);
    },
  );

  it('keeps prose strict in the range field even when a correction sibling exists', async () => {
    const made = make();
    const first = await start(made);
    const second = paused(
      await reply(made.agent, first, {
        [pair(first).range.id]: 'EST time zone',
      }),
    );
    expect(second.awaitingInput.refused?.reason).toMatch(/not a start and an end/);
    expect(replies(made.agent)).toEqual([]);
    expect(made.seen).toEqual([]);
    expect(made.requests).toHaveLength(1);
    await reply(made.agent, second, { [pair(second).range.id]: choice(second) });
    expect(made.seen).toEqual([{ from: FROM, to: TO }]);
  });

  it('rejects a foreign request, undeclared field and non-string correction before binding', async () => {
    const made = make();
    const first = await start(made);
    const cp = stored(first),
      before = JSON.stringify(cp);
    for (const response of [
      {
        requestId: `${first.awaitingInput.requestId}-foreign`,
        values: { [pair(first).correction.id]: NY },
      },
      { requestId: first.awaitingInput.requestId, values: { undeclared: NY } },
      { requestId: first.awaitingInput.requestId, values: { [pair(first).correction.id]: 42 } },
    ]) {
      await expect(made.agent.resume(cp, response)).rejects.toBeInstanceOf(InputRequestError);
      expect(JSON.stringify(cp)).toBe(before);
      expect(made.seen).toEqual([]);
      expect(made.requests).toHaveLength(1);
    }
    await reply(made.agent, first, { [pair(first).range.id]: choice(first) });
    expect(made.seen).toEqual([{ from: FROM, to: TO }]);
  });

  it('retains direct cancellation refusal and rejects cancellation carrying values', async () => {
    const made = make();
    const first = await start(made);
    await expect(
      made.agent.resume(stored(first), {
        requestId: first.awaitingInput.requestId,
        cancel: true,
        values: { [pair(first).correction.id]: NY },
      }),
    ).rejects.toBeInstanceOf(InputRequestError);
    await expect(
      made.agent.resume(stored(first), {
        requestId: first.awaitingInput.requestId,
        cancel: true,
      }),
    ).rejects.toThrow(/Cancel a hosted request through its host/);
    expect(made.seen).toEqual([]);
    expect(made.requests).toHaveLength(1);
    await reply(made.agent, first, { [pair(first).range.id]: choice(first) });
    expect(made.seen).toEqual([{ from: FROM, to: TO }]);
  });
});

it('keeps a private sibling raw only in the returned checkpoint across time correction', async () => {
  const made = make({ privateAccount: true });
  const seen = events(made.agent),
    recording = recordRun(made.agent);
  try {
    const first = await start(made);
    const account = first.awaitingInput.fields.find((field) => field.description === 'Account?');
    if (account === undefined) throw new Error('Expected the real private account question');
    const second = paused(
      await reply(made.agent, first, {
        [account.id]: SECRET,
        [pair(first).correction.id]: NY,
      }),
    );
    expect(JSON.stringify(second.checkpoint)).toContain(SECRET);
    expect(made.seen).toEqual([]);
    for (const [name, surface] of Object.entries({
      snapshot: made.agent.getSnapshot(),
      events: seen,
      recording: recording.toRecording(),
      narrative: made.agent.getLastNarrativeEntries(),
      rows: made.agent.findings(),
      question: second.awaitingInput,
      pauseData: second.pauseData,
    }))
      expect(JSON.stringify(surface), name).not.toContain(SECRET);
    expect(JSON.stringify(made.agent.getSnapshot())).toContain('activity');
    expect(pair(second).range.labels?.join(' ')).toContain(NY);
    await reply(made.agent, second, { [pair(second).range.id]: choice(second) });
    expect(made.seen).toEqual([{ from: FROM, to: TO, account: SECRET }]);
    for (const [name, surface] of Object.entries({
      snapshot: made.agent.getSnapshot(),
      events: seen,
      recording: recording.toRecording(),
      narrative: made.agent.getLastNarrativeEntries(),
      rows: made.agent.findings(),
      served: made.requests,
    }))
      expect(JSON.stringify(surface), name).not.toContain(SECRET);
    expect(JSON.stringify(seen)).toContain('activity');
  } finally {
    recording.stop();
  }
});

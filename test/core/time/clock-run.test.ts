/**
 * The run clock end to end — `.time()`, the run's `time`, the `clock`,
 * `call` and `clock-on-resume` rows, the checkpoint door, and the limits line
 * in the presentation zone (the time design § 4, § 10.2, step T3), through
 * real agents on a scripted provider.
 *
 * Law: the clock is a declared, recorded input — never a hidden read. The
 * zone is per run with a builder fallback, and a run with neither is refused;
 * the clock is frozen across a pause, and a resume's differing `time` is
 * recorded, not applied.
 *
 * Test types:
 *   functional  — one clock row per turn (`nowSource: 'default'` recorded; `'app'` when passed;
 *                 `zoneSource` run vs builder); a control window recorded `source: 'control'`;
 *                 no zone anywhere → refused before the provider is called; `time` on an agent
 *                 without `.time()` → refused; malformed → refused;
 *   integration — pause/resume: the clock survives unchanged, a resume passing a new `time` files
 *                 `clock-on-resume` and keeps the clock, the same `time` files nothing, and a
 *                 call dispatched after the resume carries the RESUME's `dispatchedAt`; the
 *                 limits block renders in the run's zone (golden-file line); `followUp` and a
 *                 continued conversation carry the rows through the checkpoint door; both chart
 *                 shapes; the answer layer's `.limitsTravelWithTheAnswer()` variant (the
 *                 inputs layer's variant, seed's other paths, the argument ask's resume,
 *                 the check-in door and a composition: clock-run-doors.test.ts);
 *   security    — the model is served nothing new (the request bytes of an armed and an
 *                 unarmed run are equal); the rows carry no message text;
 *   byte identity — without `.time()` nothing is filed and the answer is the declared instants
 *                 (the unarmed references in test/core/tools/reference/ stay green; the armed
 *                 case is the `agent-time-clock` reference there);
 *   load        — 200 calls in one run file 200 call rows, in order, inside a budget.
 * Unit, property, performance: clock.test.ts and present.test.ts.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  Agent,
  absent,
  defineTool,
  InvalidRunInputError,
  isPaused,
  pauseHere,
  type CallRow,
  type ClockOnResumeRow,
  type ClockRow,
  type Tool,
} from '../../../src/index.js';
import type { LLMRequest, LLMResponse } from '../../../src/adapters/types.js';
import { validateCheckpoint } from '../../../src/core/runCheckpoint.js';

// ─── the harness ─────────────────────────────────────────────────────

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

const call = (id: string, name: string, args: object = {}): Reply => ({
  content: '',
  toolCalls: [{ id, name, args }],
});
const answer = (content: string): Reply => ({ content });

const LA = 'America/Los_Angeles';
const NOW = '2026-10-09T15:40:00Z';

/** A backup search whose result declares the period it read. */
const backupRuns = (): Tool =>
  defineTool({
    name: 'backup_runs',
    description: 'Failed backup runs for one host.',
    inputSchema: { type: 'object', properties: { host: { type: 'string' } } },
    execute: async () =>
      absent({
        what: 'failed backup runs',
        checked: ['every job in the 02:00 export'],
        period: {
          queried: { from: '2026-10-09T15:00:00Z', to: '2026-10-09T15:40:00Z' },
          held: { from: '2026-09-09T02:00:00Z', to: '2026-10-09T02:00:00Z' },
          readAt: '2026-10-09T15:40:03Z',
        },
      }),
  });

/** A tool that stops for a person. */
const confirm = (): Tool =>
  defineTool({
    name: 'confirm',
    description: 'Ask the person to confirm.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => pauseHere({ question: 'Go ahead?' }),
  });

type Mode = 'dynamic' | 'dynamic-grouped';

function agentWith(
  script: readonly Reply[],
  arm: (b: ReturnType<typeof Agent.create>) => ReturnType<typeof Agent.create>,
  reactMode: Mode = 'dynamic',
) {
  const s = scripted(script);
  const agent = arm(
    Agent.create({ provider: s.provider as never, model: 'mock', maxIterations: 8, reactMode }),
  ).build();
  return { agent, requests: s.requests };
}

const rows = (agent: { findings(): unknown }): readonly { kind: string }[] =>
  (agent.findings() as readonly { kind: string }[] | undefined) ?? [];
const ofKind = <T>(agent: { findings(): unknown }, kind: string): T[] =>
  rows(agent).filter((r) => r.kind === kind) as T[];

afterEach(() => vi.restoreAllMocks());

// ─── the clock stamp ─────────────────────────────────────────────────

describe('one clock row per turn', () => {
  for (const mode of ['dynamic', 'dynamic-grouped'] as const) {
    it(`no now passed → the turn's start, recorded as a default (${mode})`, async () => {
      const before = Date.now();
      const { agent } = agentWith([answer('hi')], (b) => b.time({ zone: LA }), mode);
      await agent.run({ message: 'hello' });
      const after = Date.now();
      const clocks = ofKind<ClockRow>(agent, 'clock');
      expect(clocks).toHaveLength(1);
      const [clock] = clocks;
      expect(clock).toMatchObject({
        kind: 'clock',
        turn: 1,
        iteration: 1,
        nowSource: 'default',
        zone: LA,
        zoneSource: 'builder',
      });
      const at = Date.parse(clock!.now);
      expect(at).toBeGreaterThanOrEqual(before);
      expect(at).toBeLessThanOrEqual(after);
    });
  }

  it("the run's now and zone win; the zone is kept as written", async () => {
    const { agent } = agentWith([answer('hi')], (b) => b.time({ zone: LA }));
    await agent.run({ message: 'hello', time: { now: NOW, zone: 'Asia/Kolkata' } });
    expect(ofKind<ClockRow>(agent, 'clock')).toEqual([
      {
        kind: 'clock',
        turn: 1,
        iteration: 1,
        now: NOW,
        nowSource: 'app',
        zone: 'Asia/Kolkata',
        zoneSource: 'run',
      },
    ]);
  });

  it('the options bag is a second spelling; the input wins', async () => {
    const { agent } = agentWith([answer('hi')], (b) => b.time());
    await agent.run(
      { message: 'hello', time: { zone: 'Europe/Paris' } },
      { time: { zone: 'Asia/Tokyo', now: NOW } },
    );
    expect(ofKind<ClockRow>(agent, 'clock')[0]).toMatchObject({
      zone: 'Europe/Paris',
      nowSource: 'default',
    });
  });

  it('a window set in a UI is recorded as a control window', async () => {
    const window = { from: '2026-10-09T08:00:00-07:00', to: '2026-10-09T08:41:00-07:00' };
    const { agent } = agentWith([answer('hi')], (b) => b.time({ zone: LA }));
    await agent.run({ message: 'errors in this range?', time: { window } });
    expect(ofKind<ClockRow>(agent, 'clock')[0]?.window).toEqual({ ...window, source: 'control' });
  });

  it('AgentOptions.time is the same door', async () => {
    const s = scripted([answer('hi')]);
    const agent = Agent.create({
      provider: s.provider as never,
      model: 'mock',
      time: true,
    }).build();
    await agent.run({ message: 'hello', time: { zone: 'UTC' } });
    expect(ofKind<ClockRow>(agent, 'clock')[0]).toMatchObject({ zone: 'UTC', zoneSource: 'run' });
  });
});

// ─── refusals ────────────────────────────────────────────────────────

describe('refused before the turn starts', () => {
  it('no zone anywhere — never the server’s zone', async () => {
    const { agent, requests } = agentWith([answer('hi')], (b) => b.time());
    await expect(agent.run({ message: 'hello', time: { now: NOW } })).rejects.toThrow(
      /needs the person's zone/,
    );
    await expect(agent.run('hello')).rejects.toBeInstanceOf(InvalidRunInputError);
    expect(requests).toHaveLength(0);
    expect(agent.findings()).toBeUndefined();
  });

  it('time on an agent without .time()', async () => {
    const { agent, requests } = agentWith([answer('hi')], (b) => b);
    await expect(agent.run({ message: 'hello', time: { zone: LA } })).rejects.toThrow(
      /reads no clock/,
    );
    await expect(agent.run('hello', { time: { zone: LA } })).rejects.toThrow(/reads no clock/);
    expect(requests).toHaveLength(0);
  });

  it('a malformed time, by name', async () => {
    const { agent } = agentWith([answer('hi')], (b) => b.time({ zone: LA }));
    await expect(agent.run({ message: 'x', time: { zone: 'PST' } })).rejects.toThrow(/IANA/);
    await expect(agent.run({ message: 'x', time: { now: '2026-10-09 08:00' } })).rejects.toThrow(
      /now must be/,
    );
    await expect(agent.run({ message: 'x', time: { when: NOW } as never })).rejects.toThrow(
      /unknown key 'when'/,
    );
  });

  it('the builder refuses a malformed fallback and a second call', () => {
    expect(() => Agent.create({ provider: {} as never, model: 'm' }).time({ zone: 'PST' })).toThrow(
      /AgentBuilder\.time: zone must be an IANA/,
    );
    expect(() =>
      Agent.create({ provider: {} as never, model: 'm' })
        .time()
        .time({ zone: LA }),
    ).toThrow(/already set/);
    const s = scripted([answer('hi')]);
    expect(() =>
      Agent.create({ provider: s.provider as never, model: 'm', time: { zone: 'EST' } }).build(),
    ).toThrow(/Agent: time zone must be an IANA/);
  });
});

// ─── call rows ───────────────────────────────────────────────────────

describe('a call row per dispatched call', () => {
  it('dispatchedAt is the wall clock at dispatch, one row per call, in order', async () => {
    const { agent } = agentWith(
      [call('c1', 'backup_runs'), call('c2', 'backup_runs'), answer('done')],
      (b) => b.tool(backupRuns()).time({ zone: LA }),
    );
    let tick = Date.UTC(2026, 9, 9, 15, 41);
    vi.spyOn(Date, 'now').mockImplementation(() => (tick += 1000));
    await agent.run({ message: 'go', time: { now: NOW } });
    const calls = ofKind<CallRow>(agent, 'call');
    expect(calls.map((c) => [c.toolCallId, c.toolName, c.iteration, c.turn])).toEqual([
      ['c1', 'backup_runs', 1, 1],
      ['c2', 'backup_runs', 2, 1],
    ]);
    for (const c of calls) expect(Date.parse(c.dispatchedAt)).toBeGreaterThan(Date.parse(NOW));
    expect(Date.parse(calls[1]!.dispatchedAt)).toBeGreaterThan(Date.parse(calls[0]!.dispatchedAt));
  });

  it('a call that never reached a tool files no row', async () => {
    const { agent } = agentWith([call('c1', 'nope'), answer('done')], (b) =>
      b.tool(backupRuns()).time({ zone: LA }),
    );
    await agent.run('go');
    expect(ofKind<CallRow>(agent, 'call')).toEqual([]);
  });
});

// ─── pause and resume ────────────────────────────────────────────────

describe('frozen across a pause', () => {
  const script = [call('c1', 'confirm'), call('c2', 'backup_runs'), answer('done')];
  const PAUSE_AT = Date.UTC(2026, 9, 9, 15, 41);
  const RESUME_AT = Date.UTC(2026, 9, 9, 16, 11); // thirty minutes later

  async function pausedThenResumed(resumeTime?: { now?: string; zone?: string }) {
    const { agent } = agentWith(script, (b) =>
      b.tool(confirm()).tool(backupRuns()).time({ zone: LA }),
    );
    const clock = vi.spyOn(Date, 'now').mockReturnValue(PAUSE_AT);
    const paused = await agent.run({ message: 'go', time: { now: NOW } });
    if (!isPaused(paused)) throw new Error('expected a pause');
    const clockAtPause = ofKind<ClockRow>(agent, 'clock');
    clock.mockReturnValue(RESUME_AT);
    // A fresh process: the checkpoint is plain JSON.
    const cp = JSON.parse(JSON.stringify(paused.checkpoint));
    await agent.resume(cp, 'yes', resumeTime === undefined ? undefined : { time: resumeTime });
    return { agent, clockAtPause };
  }

  it('the clock survives the pause unchanged; the resumed call is dispatched at the resume', async () => {
    const { agent, clockAtPause } = await pausedThenResumed();
    expect(ofKind<ClockRow>(agent, 'clock')).toEqual(clockAtPause);
    expect(ofKind<ClockOnResumeRow>(agent, 'clock-on-resume')).toEqual([]);
    const calls = ofKind<CallRow>(agent, 'call');
    expect(calls.map((c) => [c.toolCallId, c.dispatchedAt])).toEqual([
      ['c1', new Date(PAUSE_AT).toISOString()],
      ['c2', new Date(RESUME_AT).toISOString()],
    ]);
  });

  it('a resume passing a new time is recorded, not applied', async () => {
    const later = '2026-10-09T16:11:00Z';
    const { agent, clockAtPause } = await pausedThenResumed({ now: later, zone: 'Europe/Paris' });
    expect(ofKind<ClockRow>(agent, 'clock')).toEqual(clockAtPause);
    expect(ofKind<ClockOnResumeRow>(agent, 'clock-on-resume')).toEqual([
      {
        kind: 'clock-on-resume',
        turn: 1,
        iteration: 1,
        passed: { now: later, zone: 'Europe/Paris' },
        kept: { now: NOW, zone: LA },
      },
    ]);
  });

  it('a resume passing the SAME time files nothing', async () => {
    const { agent } = await pausedThenResumed({ now: NOW, zone: LA });
    expect(ofKind<ClockOnResumeRow>(agent, 'clock-on-resume')).toEqual([]);
  });

  it('a resume passing time to an agent without .time() is refused before anything moves', async () => {
    const { agent } = agentWith(script, (b) => b.tool(confirm()).tool(backupRuns()));
    const paused = await agent.run('go');
    if (!isPaused(paused)) throw new Error('expected a pause');
    await expect(agent.resume(paused.checkpoint, 'yes', { time: { now: NOW } })).rejects.toThrow(
      /reads no clock/,
    );
    await expect(agent.resume(paused.checkpoint, 'yes')).resolves.toBe('done');
  });
});

// ─── the limits line in the zone ─────────────────────────────────────

describe('the limits block in the run’s zone', () => {
  const LINE =
    '- backup_runs queried 2026-10-09 08:00–08:40 America/Los_Angeles (UTC-07:00); the store ' +
    'holds 2026-09-08 19:00 – 2026-10-08 19:00 America/Los_Angeles (UTC-07:00); read at ' +
    '2026-10-09 08:40:03 America/Los_Angeles (UTC-07:00)';

  for (const mode of ['dynamic', 'dynamic-grouped'] as const) {
    it(`"to 8:40" shown as 08:40, the zone named (${mode})`, async () => {
      const { agent } = agentWith(
        [call('c1', 'backup_runs'), answer('None found.')],
        (b) => b.tool(backupRuns()).time().limitsTravelWithTheAnswer(),
        mode,
      );
      const out = await agent.run({ message: 'go', time: { zone: LA } });
      expect(out).toContain(LINE);
    });
  }

  it('each run renders in its own zone', async () => {
    const { agent } = agentWith([call('c1', 'backup_runs'), answer('None found.')], (b) =>
      b.tool(backupRuns()).time({ zone: LA }).limitsTravelWithTheAnswer(),
    );
    const out = await agent.run({ message: 'go', time: { zone: 'Asia/Kolkata' } });
    expect(out).toContain('- backup_runs queried 2026-10-09 20:30–21:10 Asia/Kolkata (UTC+05:30)');
  });

  it('the answer layer’s variant renders in the zone too', async () => {
    const { agent } = agentWith([call('c1', 'backup_runs'), answer('None found.')], (b) =>
      b.tool(backupRuns()).time({ zone: LA }).limitsTravelWithTheAnswer().answerLayer(),
    );
    expect(await agent.run('go')).toContain(LINE);
  });

  it('without .time() the line is the declared instants, byte for byte', async () => {
    const { agent } = agentWith([call('c1', 'backup_runs'), answer('None found.')], (b) =>
      b.tool(backupRuns()).limitsTravelWithTheAnswer(),
    );
    const out = await agent.run('go');
    expect(out).toContain(
      '- backup_runs queried 2026-10-09T15:00:00Z to 2026-10-09T15:40:00Z; the store holds ' +
        '2026-09-09T02:00:00Z to 2026-10-09T02:00:00Z (read at 2026-10-09T15:40:03Z)',
    );
    expect(agent.findings()).toBeUndefined();
  });
});

// ─── the checkpoint door ─────────────────────────────────────────────

describe('the rows cross the checkpoint door', () => {
  it('a continued conversation keeps each turn’s clock; followUp takes a time', async () => {
    const { agent } = agentWith([call('c1', 'backup_runs'), answer('one'), answer('two')], (b) =>
      b.tool(backupRuns()).time({ zone: LA }),
    );
    await agent.run({ message: 'first', time: { now: NOW } });
    const cp = agent.checkpoint();
    expect(() => validateCheckpoint(JSON.parse(JSON.stringify(cp)))).not.toThrow();
    await agent.followUp('second', { time: { now: '2026-10-09T15:45:00Z', zone: 'UTC' } });
    const clocks = ofKind<ClockRow>(agent, 'clock');
    expect(clocks.map((c) => [c.turn, c.now, c.zone])).toEqual([
      [1, NOW, LA],
      [2, '2026-10-09T15:45:00Z', 'UTC'],
    ]);
    expect(ofKind<CallRow>(agent, 'call')).toHaveLength(1);
  });

  it('a malformed time row in a stored conversation is refused at the door', () => {
    const base = {
      version: 1,
      runId: 'r',
      history: [{ role: 'user', content: 'x' }],
      lastCompletedIteration: 1,
      originalInput: { message: 'x' },
      checkpointedAt: 0,
    };
    const good = {
      kind: 'clock',
      turn: 1,
      iteration: 1,
      now: NOW,
      nowSource: 'app',
      zone: LA,
      zoneSource: 'run',
    };
    expect(() => validateCheckpoint({ ...base, findingsLedger: [good] })).not.toThrow();
    for (const bad of [
      { ...good, zone: 'PST' },
      { ...good, nowSource: 'server' },
      { kind: 'call', turn: 1, iteration: 1, toolCallId: 'c1', toolName: 't', dispatchedAt: 'now' },
      { kind: 'clock-on-resume', turn: 1, iteration: 1, passed: {}, kept: { now: NOW, zone: LA } },
    ]) {
      expect(() => validateCheckpoint({ ...base, findingsLedger: [bad] })).toThrow(/'clock'/);
    }
  });
});

// ─── security + byte identity ───────────────────────────────────────

describe('the model is served nothing new', () => {
  it('an armed and an unarmed run send the same request bytes', async () => {
    const script = [call('c1', 'backup_runs'), answer('done')];
    const armed = agentWith(script, (b) => b.system('bot').tool(backupRuns()).time({ zone: LA }));
    const plain = agentWith(script, (b) => b.system('bot').tool(backupRuns()));
    await armed.agent.run({ message: 'go', time: { now: NOW } });
    await plain.agent.run({ message: 'go' });
    const strip = (reqs: LLMRequest[]) =>
      JSON.stringify(
        reqs.map((r) => ({ system: r.systemPrompt, messages: r.messages, tools: r.tools })),
      );
    expect(strip(armed.requests)).toBe(strip(plain.requests));
  });

  it('no row carries the message', async () => {
    const secret = 'my card is 4111 1111 1111 1111';
    const { agent } = agentWith([call('c1', 'backup_runs'), answer('done')], (b) =>
      b.tool(backupRuns()).time({ zone: LA }),
    );
    await agent.run({ message: secret, time: { now: NOW } });
    expect(JSON.stringify(agent.findings())).not.toContain('4111');
  });
});

// ─── load ────────────────────────────────────────────────────────────

describe('load', () => {
  it('200 calls in one run file 200 call rows, in order, inside 10 s', async () => {
    const N = 200;
    const script: Reply[] = [];
    for (let i = 0; i < N; i++) script.push(call(`c${i}`, 'backup_runs'));
    script.push(answer('done'));
    const s = scripted(script);
    const agent = Agent.create({
      provider: s.provider as never,
      model: 'mock',
      maxIterations: N + 5,
    })
      .tool(backupRuns())
      .time({ zone: LA })
      .build();
    const t0 = performance.now();
    await agent.run({ message: 'go', time: { now: NOW } });
    expect(performance.now() - t0).toBeLessThan(10_000);
    const calls = ofKind<CallRow>(agent, 'call');
    expect(calls.map((c) => c.toolCallId)).toEqual(Array.from({ length: N }, (_, i) => `c${i}`));
    expect(ofKind<ClockRow>(agent, 'clock')).toHaveLength(1);
  }, 20_000);
});

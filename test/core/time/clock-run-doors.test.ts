/**
 * The run clock through every door a turn can enter by — the T3 review's
 * three findings, each pinned by a test that fails without its fix:
 *
 *   1. both pause shapes record a resume's differing `time`: the pausable
 *      resume door AND the stage re-run the inputs layer's argument ask makes
 *      (it pauses through footprintjs's `interrupt()`, so its resume never
 *      reaches the resume door) — once per resumed leg, whichever door;
 *   2. an agent's chart mounted in a composition never stamps a clock the app
 *      declared for an EARLIER direct run: the draft ends with `run()`; the
 *      mounted turn stamps the builder's fallback as a default, or is refused
 *      when there is none;
 *   3. every wired site files its row: seed's five paths (sync, the ruled
 *      tools' async decoration, the conversation stores, a message chain
 *      that allows, one that denies), the check-in resume door's `call` row,
 *      and the limits block in the zone beside the inputs layer.
 *
 * Law: the clock is a declared, recorded input — never a hidden read, never
 * a stale one. The rest of the layer's run tests: clock-run.test.ts.
 *
 * Test types: functional (each seed path, each door), integration (pause/
 * resume through both shapes, a Sequence mounting the agent, a stored
 * conversation), security (a stale app clock is never re-stamped).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  Agent,
  Sequence,
  absent,
  allow,
  checkInApproved,
  defineTool,
  deny,
  isInputPause,
  isPaused,
  MessageDeniedError,
  type CallRow,
  type ClockOnResumeRow,
  type ClockRow,
  type Tool,
} from '../../../src/index.js';
import type { LLMResponse } from '../../../src/adapters/types.js';
import { defineMemory, MEMORY_STRATEGIES, MEMORY_TYPES } from '../../../src/memory/index.js';
import { InMemoryStore } from '../../../src/memory/store/index.js';

// ─── the harness ─────────────────────────────────────────────────────

type Reply = { content: string; toolCalls?: { id: string; name: string; args: object }[] };

function scripted(script: readonly Reply[]) {
  let i = 0;
  return {
    name: 'time-doors-mock',
    complete: async (): Promise<LLMResponse> => {
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

const call = (id: string, name: string, args: object = {}): Reply => ({
  content: '',
  toolCalls: [{ id, name, args }],
});
const answer = (content: string): Reply => ({ content });

function agentWith(
  script: readonly Reply[],
  arm: (b: ReturnType<typeof Agent.create>) => ReturnType<typeof Agent.create>,
) {
  return arm(
    Agent.create({ provider: scripted(script) as never, model: 'mock', maxIterations: 8 }),
  ).build();
}

const ofKind = <T>(agent: { findings(): unknown }, kind: string): T[] =>
  ((agent.findings() as readonly { kind: string }[] | undefined) ?? []).filter(
    (r) => r.kind === kind,
  ) as T[];

/** Every row of `kind` anywhere in a (composition's) snapshot. */
function rowsIn<T>(value: unknown, kind: string, out: T[] = []): T[] {
  if (Array.isArray(value)) for (const v of value) rowsIn(v, kind, out);
  else if (value !== null && typeof value === 'object') {
    if ((value as { kind?: unknown }).kind === kind) out.push(value as T);
    else for (const v of Object.values(value)) rowsIn(v, kind, out);
  }
  return out;
}

const LA = 'America/Los_Angeles';
const NOW = '2026-10-09T15:40:00Z';

/** A log search whose look-back the inputs layer ASKS for when the model left it out. */
const searchLogs = (): Tool =>
  defineTool({
    name: 'search_logs',
    description: 'Error lines for one service over a look-back period.',
    inputSchema: {
      type: 'object',
      required: ['service', 'window'],
      properties: {
        service: { type: 'string' },
        window: { type: 'string', enum: ['1h', '24h'] },
      },
    },
    askOrAssume: { window: { ask: 'Which period?', choices: ['1h', '24h'] } },
    period: { argument: 'window', spelling: 'lookback' },
    execute: async (args) => ({ service: args.service, window: args.window, errors: 0 }),
  });

/** A backup search whose result declares the period it read. */
const backupRuns = (extra: Partial<Tool> = {}): Tool =>
  ({
    ...defineTool({
      name: 'backup_runs',
      description: 'Failed backup runs for one host.',
      inputSchema: { type: 'object', properties: {} },
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
    }),
    ...extra,
  } as Tool);

afterEach(() => vi.restoreAllMocks());

// ─── 1 · both pause shapes ──────────────────────────────────────────

describe("a resume's differing time is recorded through BOTH pause shapes", () => {
  const script = [
    call('c1', 'search_logs', { service: 'checkout' }),
    // A second ToolCalls pass in the resumed leg: the row must not repeat.
    call('c2', 'search_logs', { service: 'payments', window: '1h' }),
    answer('No errors.'),
  ];

  async function askedThenResumed(time?: { now?: string; zone?: string }) {
    const agent = agentWith(script, (b) =>
      b.tool(searchLogs()).inputsLayer().time({ zone: 'UTC' }),
    );
    const paused = await agent.run({ message: 'errors?', time: { now: NOW } });
    if (!isInputPause(paused)) throw new Error('expected the argument ask');
    const cp = JSON.parse(JSON.stringify(paused.checkpoint));
    const done = await agent.resume(
      cp,
      { requestId: paused.awaitingInput.requestId, values: { f1: '24h' } },
      time === undefined ? undefined : { time },
    );
    return { agent, done };
  }

  it('the argument ask (an interrupt() pause) files clock-on-resume, once, and keeps the clock', async () => {
    const later = '2026-10-09T16:40:00Z';
    const { agent, done } = await askedThenResumed({ now: later, zone: 'Asia/Tokyo' });
    expect(done).toBe('No errors.');
    expect(ofKind<ClockRow>(agent, 'clock')).toMatchObject([{ now: NOW, zone: 'UTC' }]);
    expect(ofKind<ClockOnResumeRow>(agent, 'clock-on-resume')).toEqual([
      {
        kind: 'clock-on-resume',
        turn: 1,
        iteration: 1,
        passed: { now: later, zone: 'Asia/Tokyo' },
        kept: { now: NOW, zone: 'UTC' },
      },
    ]);
  });

  it('the argument ask resumed with the same time, or none, files nothing', async () => {
    for (const time of [undefined, { now: NOW, zone: 'UTC' }]) {
      const { agent } = await askedThenResumed(time);
      expect(ofKind<ClockOnResumeRow>(agent, 'clock-on-resume')).toEqual([]);
    }
  });

  it('a fresh run after a resume that passed time files no clock-on-resume', async () => {
    const { agent } = await askedThenResumed({ now: '2026-10-09T16:40:00Z' });
    // A new turn whose ToolCalls runs: nothing was passed to IT.
    await agent.run({ message: 'again?', time: { now: NOW } });
    expect(ofKind<ClockOnResumeRow>(agent, 'clock-on-resume')).toEqual([]);
  });
});

// ─── 2 · a composition never stamps a stale clock ───────────────────

describe('an agent mounted in a composition', () => {
  it("stamps the builder's fallback as a default — never an earlier run's app clock", async () => {
    const agent = agentWith([answer('hi')], (b) => b.time({ zone: 'UTC' }));
    await agent.run({
      message: 'direct',
      time: { now: '2020-01-01T00:00:00Z', zone: 'Asia/Tokyo' },
    });
    const seq = Sequence.create().step('a', agent).build();
    const before = Date.now();
    await seq.run({ message: 'composed' });
    const after = Date.now();
    const clocks = rowsIn<ClockRow>(seq.getLastSnapshot(), 'clock');
    expect(clocks.length).toBeGreaterThan(0);
    for (const clock of clocks) {
      expect(clock).toMatchObject({ nowSource: 'default', zone: 'UTC', zoneSource: 'builder' });
      expect(Date.parse(clock.now)).toBeGreaterThanOrEqual(before);
      expect(Date.parse(clock.now)).toBeLessThanOrEqual(after);
    }
  });

  it('with no fallback zone the mounted turn is refused, never run on the server’s zone', async () => {
    const agent = agentWith([answer('hi')], (b) => b.time());
    const seq = Sequence.create().step('a', agent).build();
    await expect(seq.run({ message: 'composed' })).rejects.toThrow(/composition passes no time/);
  });
});

// ─── 3 · every seed path stamps the clock ───────────────────────────

describe('seed stamps one clock row on every path', () => {
  it('a ruled tool (the async rule-decoration path)', async () => {
    const agent = agentWith([answer('hi')], (b) => b.tool(searchLogs()).time({ zone: LA }));
    await agent.run({ message: 'hello', time: { now: NOW } });
    expect(ofKind<ClockRow>(agent, 'clock')).toMatchObject([{ now: NOW, zone: LA, turn: 1 }]);
  });

  it('a conversation store — stamped after the turn is anchored', async () => {
    const store = new InMemoryStore();
    const memory = () =>
      defineMemory({
        id: 'short-term',
        type: MEMORY_TYPES.EPISODIC,
        strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },
        store,
      });
    const identity = { conversationId: 'conv-1' };
    const first = agentWith([answer('one')], (b) => b.memory(memory()).time({ zone: LA }));
    await first.run({ message: 'first', identity, time: { now: NOW } });
    const second = agentWith([answer('two')], (b) => b.memory(memory()).time({ zone: LA }));
    await second.run({ message: 'second', identity, time: { now: NOW } });
    const clocks = ofKind<ClockRow>(second, 'clock');
    expect(clocks).toHaveLength(1);
    // The store's anchor raised the turn; the stamp names the final one.
    const turn = (second.getLastSnapshot()?.sharedState as { turnNumber: number }).turnNumber;
    expect(turn).toBeGreaterThan(1);
    expect(clocks[0]!.turn).toBe(turn);
  });

  it('a message chain that allows', async () => {
    const agent = agentWith([answer('hi')], (b) =>
      b.messageMiddleware({ name: 'pass', onMessage: () => allow() }).time({ zone: LA }),
    );
    await agent.run({ message: 'hello', time: { now: NOW } });
    expect(ofKind<ClockRow>(agent, 'clock')).toMatchObject([{ now: NOW, zone: LA }]);
  });

  it('a message chain that denies — the refused turn still carries its clock', async () => {
    const agent = agentWith([answer('hi')], (b) =>
      b.messageMiddleware({ name: 'no', onMessage: () => deny('refused') }).time({ zone: LA }),
    );
    await expect(agent.run({ message: 'hello', time: { now: NOW } })).rejects.toThrow(
      MessageDeniedError,
    );
    expect(ofKind<ClockRow>(agent, 'clock')).toMatchObject([{ now: NOW, zone: LA }]);
  });
});

// ─── 3 · the check-in door and the limits beside the inputs layer ────

describe('the other wired sites', () => {
  it('an approved check-in files its call row at the resume, dispatched then', async () => {
    const PAUSE_AT = Date.UTC(2026, 9, 9, 15, 41);
    const RESUME_AT = Date.UTC(2026, 9, 9, 16, 11);
    const agent = agentWith([call('c1', 'backup_runs'), answer('done')], (b) =>
      b.tool(backupRuns({ checkIn: 'always' } as Partial<Tool>)).time({ zone: LA }),
    );
    const clock = vi.spyOn(Date, 'now').mockReturnValue(PAUSE_AT);
    const paused = await agent.run({ message: 'go', time: { now: NOW } });
    if (!isPaused(paused)) throw new Error('expected the check-in pause');
    expect(ofKind<CallRow>(agent, 'call')).toEqual([]);
    clock.mockReturnValue(RESUME_AT);
    await agent.resume(paused.checkpoint, checkInApproved({ by: 'reviewer' }));
    expect(ofKind<CallRow>(agent, 'call').map((c) => [c.toolCallId, c.dispatchedAt])).toEqual([
      ['c1', new Date(RESUME_AT).toISOString()],
    ]);
  });

  it('the limits block beside the inputs layer renders in the zone', async () => {
    const agent = agentWith([call('c1', 'backup_runs'), answer('None found.')], (b) =>
      b.tool(backupRuns()).inputsLayer().time({ zone: LA }).limitsTravelWithTheAnswer(),
    );
    expect(await agent.run('go')).toContain(
      '- backup_runs queried 2026-10-09 08:00–08:40 America/Los_Angeles (UTC-07:00)',
    );
  });
});

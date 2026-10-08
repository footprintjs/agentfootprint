/**
 * No run's content reaches another run's records — across agents in one
 * process, an agent used as a tool by two parents, concurrent runs, and a
 * chart mounted beside another — and no registry the redaction keeps can
 * carry it there.
 *
 *   (a) delivery: an event of run X reaches only the listeners of the runner
 *       that ran X, served under X's own policy;
 *   (b) registries: every one the redaction keeps at module scope is a WEAK
 *       map keyed by identity (an executor, a scope, a runner) — never a list,
 *       never enumerated; `served.ts` keeps none at all;
 *   (c) a lookup that misses fails closed: a fact of a run the dispatcher holds
 *       no serving for is refused, never served under the run in force; a
 *       mounted chart is bound to ITS runner at build, by identity.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { FlowChartExecutor, flowChart } from 'footprintjs';
import type { CombinedRecorder, RedactionPolicy } from 'footprintjs';
import { describe, expect, it } from 'vitest';

import { Agent, defineTool, Sequence } from '../../src/index.js';
import type { LLMProvider, LLMResponse } from '../../src/adapters/types.js';
import { mock } from '../../src/doors/providers.js';
import { recordRun } from '../../src/doors/observe.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';
import { EventDispatcher } from '../../src/events/dispatcher.js';
import { retiredRule, servingAhead } from '../../src/redaction/runRedaction.js';
import { RedactionRule } from 'footprintjs/advanced';
import { carriedConversationPolicy, locationsOf } from './fixture.js';

/** An agent that calls `lookup` with `field: secret`, then answers. */
function agentWith(field: string, secret: string | number, redact?: RedactionPolicy) {
  return Agent.create({
    provider: mock({
      chunkDelayMs: 0,
      replies: [
        { toolCalls: [{ id: 'c1', name: 'lookup', args: { [field]: secret } }] },
        { content: 'Done.' },
      ],
    }),
    model: 'm',
    ...(redact !== undefined && { redact }),
  })
    .tool(
      defineTool<Record<string, unknown>, unknown>({
        name: 'lookup',
        description: 'Look it up.',
        inputSchema: { type: 'object', properties: { [field]: {} } },
        execute: (args) => ({ ...args, ok: true }),
      }),
    )
    .build();
}

const collect = (agent: { on: (t: '*', l: (e: AgentfootprintEvent) => void) => unknown }) => {
  const events: AgentfootprintEvent[] = [];
  agent.on('*', (e) => events.push(e));
  return events;
};

describe('(a) an event of one run reaches only its own runner’s listeners, under its own policy', () => {
  it('two agents in one process, running at once, with different policies', async () => {
    const a = agentWith('ssn', 'SSN-A-1000', carriedConversationPolicy());
    const b = agentWith('ssn', 'SSN-B-2000');
    const aEvents = collect(a);
    const bEvents = collect(b);
    await Promise.all([a.run({ message: 'a' }), b.run({ message: 'b' })]);
    // A's listeners never see B's run, and A's own value is kept out.
    expect(locationsOf(aEvents, 'SSN-B-2000')).toEqual([]);
    expect(
      locationsOf(
        aEvents.map((e) => e.payload),
        'SSN-A-1000',
      ),
    ).toEqual([]);
    // B (no policy) carries its own value — and never A's.
    expect(locationsOf(bEvents, 'SSN-B-2000').length).toBeGreaterThan(0);
    expect(locationsOf(bEvents, 'SSN-A-1000')).toEqual([]);
    // Every event a listener got belongs to that runner's own run.
    const aRuns = new Set(aEvents.map((e) => (e.meta as { runId?: string }).runId));
    const bRuns = new Set(bEvents.map((e) => (e.meta as { runId?: string }).runId));
    for (const run of aRuns) expect(bRuns.has(run)).toBe(false);
  });

  it('an agent used as a tool by two parents: each parent’s records hold only its own run', async () => {
    const specialist = Agent.create({
      provider: mock({ chunkDelayMs: 0, reply: 'specialist answer' }),
      model: 'm',
    }).build();
    const specialistEvents = collect(specialist);
    const parent = (secret: string, redact?: RedactionPolicy) =>
      Agent.create({
        provider: mock({
          chunkDelayMs: 0,
          replies: [
            { toolCalls: [{ id: 't1', name: 'ask_specialist', args: { ssn: secret } }] },
            { content: 'Parent done.' },
          ],
        }),
        model: 'm',
        ...(redact !== undefined && { redact }),
      })
        .tool(
          defineTool<{ ssn: string }, unknown>({
            name: 'ask_specialist',
            description: 'Ask the specialist.',
            inputSchema: { type: 'object', properties: { ssn: { type: 'string' } } },
            execute: async ({ ssn }, ctx) =>
              specialist.run(
                { message: `about ${ssn}` },
                { ...(ctx.redact && { redact: ctx.redact }) },
              ),
          }),
        )
        .build();
    const covered = parent('SSN-P1-3000', carriedConversationPolicy());
    const open = parent('SSN-P2-4000');
    const coveredRecorder = recordRun(covered);
    const openRecorder = recordRun(open);
    await covered.run({ message: 'p1' });
    await open.run({ message: 'p2' });
    const coveredRecord = JSON.stringify([
      coveredRecorder.toRecording(),
      covered.getLastSnapshot(),
    ]);
    const openRecord = JSON.stringify([openRecorder.toRecording(), open.getLastSnapshot()]);
    // The covered parent keeps its value out, and never holds the other's.
    expect(coveredRecord).not.toContain('SSN-P1-3000');
    expect(coveredRecord).not.toContain('SSN-P2-4000');
    // The open parent holds its own value (no policy) — never the covered one's.
    expect(openRecord).toContain('SSN-P2-4000');
    expect(openRecord).not.toContain('SSN-P1-3000');
    // The specialist's own run for the covered parent was served under that
    // parent's policy, handed down as `ctx.redact`.
    const byRun = new Map<string, AgentfootprintEvent[]>();
    for (const e of specialistEvents) {
      const run = (e.meta as { runId: string }).runId;
      byRun.set(run, [...(byRun.get(run) ?? []), e]);
    }
    const runs = [...byRun.values()];
    expect(runs).toHaveLength(2);
    expect(locationsOf(runs[0], 'SSN-P1-3000')).toEqual([]);
    expect(locationsOf(runs[1], 'SSN-P2-4000').length).toBeGreaterThan(0);
  });
});

describe('(a) overlapping runs of ONE composition instance each keep their own run', () => {
  it('every event is stamped with the run that produced it, never the one started last', async () => {
    // A step whose model answers only after a pause, so the two runs overlap.
    const slow: LLMProvider = {
      name: 'slow',
      complete: async (): Promise<LLMResponse> => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        return { content: 'ok', toolCalls: [], usage: { input: 1, output: 1 }, stopReason: 'stop' };
      },
    };
    const step = Agent.create({ provider: slow, model: 'm', redact: { keys: ['ssn'] } }).build();
    const sequence = Sequence.create().step('a', step).build();
    const events: AgentfootprintEvent[] = [];
    sequence.on('*', (e) => events.push(e));
    const first = sequence.run({ message: 'first' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await Promise.all([first, sequence.run({ message: 'second' })]);
    const byRun = new Map<string, string[]>();
    for (const e of events) {
      if (!e.type.startsWith('agentfootprint.composition.')) continue;
      const run = (e.meta as { runId: string }).runId;
      byRun.set(run, [...(byRun.get(run) ?? []), e.type]);
    }
    // Two runs, each with its own enter and its own exit.
    expect(byRun.size).toBe(2);
    for (const types of byRun.values()) {
      expect(types.filter((t) => t === 'agentfootprint.composition.enter')).toHaveLength(1);
      expect(types.filter((t) => t === 'agentfootprint.composition.exit')).toHaveLength(1);
    }
  });
});

describe('(c) a lookup that misses fails closed; a mounted chart is bound to its own runner', () => {
  it('a fact of a run the dispatcher no longer holds is refused — never served under the run in force', async () => {
    const agent = Agent.create({
      provider: mock({ chunkDelayMs: 0, reply: 'ok' }),
      model: 'm',
    }).build();
    const events = collect(agent);
    // The first run is covered (per run), the next ones are not.
    await agent.run({ message: 'first' }, { redact: { keys: ['ssn'] } });
    const firstRun = (events[0]?.meta as { runId: string }).runId;
    for (let i = 0; i < 33; i += 1) await agent.run({ message: `again ${i}` });
    // A host files a late fact for the first run, after 33 newer runs.
    const late: AgentfootprintEvent[] = [];
    agent.on('*', (e) => late.push(e));
    agent.emitAttributed(
      'app.late_fact',
      { ssn: 'SSN-LATE-5000', note: 'filed late' },
      {
        sessionId: 's',
        runId: firstRun,
      },
    );
    const fact = late.find((e) => (e.type as string) === 'app.late_fact');
    expect(fact).toBeDefined();
    expect(fact?.payload).toBe('[REDACTED]');
    expect(locationsOf(late, 'SSN-LATE-5000')).toEqual([]);
  });

  it('a fact naming a run this instance never opened is UNKNOWN — refused on every instance, policy or not', async () => {
    const fact = () => ({ ssn: 'SSN-ELSEWHERE-8000', note: 'filed for another instance' });
    const make = (redact?: RedactionPolicy) =>
      Agent.create({
        provider: mock({ chunkDelayMs: 0, reply: 'ok' }),
        model: 'm',
        ...(redact !== undefined && { redact }),
      }).build();
    const fileOn = (agent: ReturnType<typeof make>) => {
      const got: AgentfootprintEvent[] = [];
      const off = agent.on('*', (e) => got.push(e));
      // A run id of this library's format, from a run this instance never ran.
      agent.emitAttributed('app.late_fact', fact(), { sessionId: 's', runId: 'run-1-999' });
      off();
      return got.find((e) => (e.type as string) === 'app.late_fact')?.payload;
    };
    // A declared policy, no run yet.
    expect(fileOn(make({ keys: ['ssn'] }))).toBe('[REDACTED]');
    // No policy at all, before and after its own runs — a lookup that misses
    // is never "none" (`redaction/coverage.ts`).
    const open = make();
    expect(fileOn(open)).toBe('[REDACTED]');
    await open.run({ message: 'first' });
    expect(fileOn(open)).toBe('[REDACTED]');
    // A run covered only per run.
    await open.run({ message: 'covered' }, { redact: { keys: ['ssn'] } });
    expect(fileOn(open)).toBe('[REDACTED]');
  });

  it('a no-policy instance serves a fact of its OWN run unchanged — that run is positively declared-none', async () => {
    const agent = Agent.create({
      provider: mock({ chunkDelayMs: 0, reply: 'ok' }),
      model: 'm',
    }).build();
    const got: AgentfootprintEvent[] = [];
    agent.on('*', (e) => got.push(e));
    await agent.run({ message: 'first' });
    const runId = (got[0]?.meta as { runId: string }).runId;
    await agent.run({ message: 'second' });
    const fact = { ssn: 'SSN-NOPOLICY-8100', note: 'filed for the first run' };
    agent.emitAttributed('app.late_fact', fact, { sessionId: 's', runId });
    // The very object dispatched: byte-identical.
    expect(got.find((e) => (e.type as string) === 'app.late_fact')?.payload).toBe(fact);
  });

  it('a fact filed about one run after it returned is served under THAT run, never the run opened since', () => {
    const dispatcher = new EventDispatcher();
    const got: AgentfootprintEvent[] = [];
    dispatcher.on('*', (e) => got.push(e));
    // The run in force now is another run, whose policy names `iteration`.
    dispatcher.useServing(servingAhead({ keys: ['iteration'] }), 'run-1-2');
    const pause = {
      type: 'agentfootprint.pause.request',
      payload: { attempt: 2, iteration: 3, questionPayload: { ssn: 'SSN-PAUSED-9000' } },
      meta: { runId: 'consumer-scope', runtimeStageId: 'ask#paused', subflowPath: [] },
    } as unknown as AgentfootprintEvent;
    // Served under the paused run's own serving, whose policy names `attempt`…
    dispatcher.dispatchForRun(pause, servingAhead({ keys: ['ssn', 'attempt'] }));
    // …and refused when that run has none (an executor no run opened).
    dispatcher.dispatchForRun(pause, undefined);
    expect(locationsOf(got, 'SSN-PAUSED-9000')).toEqual([]);
    // The numbers tell the two policies apart: its own selects `attempt`, the
    // run opened since would have selected `iteration`.
    expect(got[0]?.payload).toMatchObject({ attempt: '[REDACTED]', iteration: 3 });
    expect(got[1]?.payload).toBe('[REDACTED]');
  });

  it('two runners’ charts mounted in one app executor: each keeps its OWN policy, no bleed', async () => {
    // Numbers under the payload types' own field names: each policy is told
    // apart by the one it selects (the value-kind rule keeps numbers).
    const a = agentWith('attempt', 6000, { keys: ['attempt'] });
    const b = agentWith('iteration', 7000, { keys: ['iteration'] });
    const app = flowChart<{ q: string }>(
      'Ask',
      (scope) => {
        scope.q = 'go';
      },
      'ask',
    )
      .addSubFlowChartNext('sf-a', a.getSpec(), 'A', { inputMapper: () => ({ message: 'a' }) })
      .addSubFlowChartNext('sf-b', b.getSpec(), 'B', { inputMapper: () => ({ message: 'b' }) })
      .build();
    const executor = new FlowChartExecutor(app);
    const starts: { subflow: string; args: Record<string, unknown> }[] = [];
    executor.attachCombinedRecorder({
      id: 'app',
      onEmit: (e: { name: string; payload: unknown; subflowPath?: readonly string[] }) => {
        if (e.name !== 'agentfootprint.stream.tool_start') return;
        starts.push({
          subflow: String(e.subflowPath?.[0] ?? ''),
          args: (e.payload as { args: Record<string, unknown> }).args,
        });
      },
    } as unknown as CombinedRecorder);
    await executor.run({ input: {} });
    const fromA = starts.find((s) => s.subflow.includes('sf-a'));
    const fromB = starts.find((s) => s.subflow.includes('sf-b'));
    expect(fromA?.args).toEqual({ attempt: '[REDACTED]' });
    expect(fromB?.args).toEqual({ iteration: '[REDACTED]' });
  });
});

describe('(b, d) the registries the redaction keeps: weak, keyed by identity, none in served.ts', () => {
  const SRC = resolve(__dirname, '../../src');
  /** Module-scope statements of a file: its top-level lines, comments taken out. */
  const moduleScope = (path: string): string[] =>
    readFileSync(path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
      .split('\n')
      .filter((line) => /^(export\s+)?(const|let|var)\s/.test(line));

  const files = [
    ...readdirSync(join(SRC, 'redaction'))
      .filter((f) => f.endsWith('.ts'))
      .map((f) => join(SRC, 'redaction', f)),
    join(SRC, 'events/dispatcher.ts'),
    join(SRC, 'core/runnerLive.ts'),
    join(SRC, 'core/servableSnapshot.ts'),
  ];

  it('no module keeps a strong list or map of runs, scopes, listeners or values', () => {
    for (const file of files) {
      for (const line of moduleScope(file)) {
        // A registry starts EMPTY and fills at run time; a constant set of literals is data.
        expect(line, file).not.toMatch(/\bnew\s+(Map|Set)\s*(<[^>]*>)?\s*\(\s*\)/);
        expect(line, file).not.toMatch(/^(export\s+)?let\s/);
        expect(line, file).not.toMatch(/=\s*\[\s*\]\s*;?$/);
      }
    }
  });

  it('a settled run’s serving keeps the rule’s NAMES only — never a thrown value', () => {
    const live = new RedactionRule({ keys: ['ssn'] });
    live.mark('accountNo');
    // footprintjs remembers the masked form of a thrown value it served — keyed
    // by the thrown value itself.
    const thrown = Object.assign(new Error('lookup failed'), { ssn: 'SSN-THROWN-8300' });
    live.retainStageError(thrown, 'lookup failed', 'lookup failed');
    const cache = (rule: RedactionRule) =>
      (rule as unknown as { maskedErrors?: Map<unknown, unknown> }).maskedErrors;
    expect(cache(live)?.has(thrown)).toBe(true);
    const retired = retiredRule(live, { keys: ['ssn'] });
    // The names stay: the policy's and the run's marks.
    expect(retired.isKeyRedacted('ssn')).toBe(true);
    expect(retired.isKeyRedacted('accountNo')).toBe(true);
    expect(retired.marksForCheckpoint()).toEqual(live.marksForCheckpoint());
    // The thrown value does not.
    expect(cache(retired)).toBeUndefined();
  });

  it('a covered run retires its rule when it settles — its late facts keep its names', async () => {
    const agent = Agent.create({
      provider: mock({ chunkDelayMs: 0, reply: 'ok' }),
      model: 'm',
      redact: { keys: ['attempt'] },
    }).build();
    const events: AgentfootprintEvent[] = [];
    agent.on('*', (e) => events.push(e));
    await agent.run({ message: 'go' });
    const runId = (events[0]?.meta as { runId: string }).runId;
    // The executor's own LIVE rule, marked after the run settled: a serving that
    // still held it would now keep `iteration` out of the run's late facts too.
    const executor = (agent as unknown as { lastExecutor: FlowChartExecutor }).lastExecutor;
    const live = executor.getRuntime().rootStageContext.getRedactionRule();
    expect(live).toBeDefined();
    live?.mark('iteration');
    agent.emitAttributed(
      'app.late_fact',
      { attempt: 8400, iteration: 8401 },
      { sessionId: 's', runId },
    );
    const fact = events.find((e) => (e.type as string) === 'app.late_fact');
    // Its names stay (the policy's `attempt`); the live rule is no longer read,
    // so `iteration` — a number, which the value-kind rule keeps — is not selected.
    expect(fact?.payload).toEqual({ attempt: '[REDACTED]', iteration: 8401 });
  });

  it('served.ts keeps nothing at module scope but frozen constants', () => {
    const lines = moduleScope(join(SRC, 'redaction/served.ts'));
    for (const line of lines) expect(line).not.toMatch(/\bnew\s+(Weak)?(Map|Set)\b/);
  });
});

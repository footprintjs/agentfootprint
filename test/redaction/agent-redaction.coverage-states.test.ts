/**
 * Every door that serves a record resolves the run it serves to ONE of three
 * states (`src/redaction/coverage.ts`) — never inferred from an absent value:
 *
 *   - COVERED        — the run was opened with a policy: served under it;
 *   - DECLARED-NONE  — positively none (the run was opened with none): served
 *                      unchanged;
 *   - UNKNOWN        — the executor, the run or the scope is not one this
 *                      library recorded: FAIL CLOSED, whatever the instance
 *                      declares — a refusal for a snapshot, a narrative or a
 *                      record, the placeholder for an event.
 *
 * Doors: `getLastSnapshot()` / `getSnapshot()`, `getLastNarrativeEntries()`,
 * events (`agent.on`), recordings (`recordRun`, packed and unpacked), answer
 * accounts (`accountForAnswer`). One test per door per state, and the UNKNOWN
 * state on an instance with NO policy: a lookup that misses fails closed
 * there too.
 */
import { FlowChartExecutor } from 'footprintjs';
import type { RedactionPolicy } from 'footprintjs';
import { describe, expect, it } from 'vitest';

import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import {
  accountForAnswer,
  packRecording,
  recordRun,
  unpackRecording,
} from '../../src/doors/observe.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';
import { coverageOfExecutor } from '../../src/redaction/runRedaction.js';
import { carriedConversationPolicy, locationsOf } from './fixture.js';

const SECRET = 'SSN-STATE-9000';

/** An agent whose model calls `lookup` with the secret, which the tool returns; then answers. */
function agentUnder(redact?: RedactionPolicy) {
  return Agent.create({
    provider: mock({
      chunkDelayMs: 0,
      replies: [
        { toolCalls: [{ id: 'c1', name: 'lookup', args: { ssn: SECRET } }] },
        { content: 'Done.' },
      ],
    }),
    model: 'm',
    ...(redact !== undefined && { redact }),
  })
    .tool(
      defineTool<{ ssn: string }, unknown>({
        name: 'lookup',
        description: 'Look it up.',
        inputSchema: { type: 'object', properties: { ssn: { type: 'string' } } },
        execute: ({ ssn }) => ({ ssn, ok: true }),
      }),
    )
    .build();
}

type Built = ReturnType<typeof agentUnder>;

/** One run, with every door read after it. */
async function served(agent: Built) {
  const events: AgentfootprintEvent[] = [];
  agent.on('*', (e) => events.push(e));
  const recorder = recordRun(agent);
  await agent.run({ message: `Check ${SECRET}` });
  recorder.stop();
  const recording = recorder.toRecording();
  return {
    events,
    snapshot: agent.getLastSnapshot(),
    snapshotAlias: agent.getSnapshot(),
    narrative: agent.getLastNarrativeEntries(),
    recording,
    unpacked: unpackRecording(JSON.parse(JSON.stringify(packRecording(recording)))),
    account: accountForAnswer(recording),
  };
}

/** The runner's last executor swapped for one no run of this library opened — a lookup that misses. */
async function unknownExecutor(agent: Built): Promise<FlowChartExecutor> {
  const foreign = new FlowChartExecutor(agent.getSpec());
  await foreign.run({ input: { message: `Check ${SECRET}` } }).catch(() => undefined);
  (agent as unknown as { lastExecutor: FlowChartExecutor }).lastExecutor = foreign;
  expect(coverageOfExecutor(foreign)).toEqual({ state: 'unknown' });
  return foreign;
}

const holds = (value: unknown) => locationsOf(value, SECRET).length > 0;

describe('COVERED — the run was opened with a policy: every door serves under it', () => {
  it('snapshot, narrative, events, recordings and the account hold no selected value', async () => {
    const agent = agentUnder(carriedConversationPolicy());
    const doors = await served(agent);
    expect(
      coverageOfExecutor((agent as unknown as { lastExecutor: object }).lastExecutor),
    ).toMatchObject({
      state: 'covered',
    });
    expect(doors.snapshot).toBeDefined();
    expect(doors.narrative.length).toBeGreaterThan(0);
    expect(doors.events.length).toBeGreaterThan(0);
    for (const [door, value] of Object.entries(doors)) expect(holds(value), door).toBe(false);
  });
});

describe('DECLARED-NONE — positively no policy: every door serves unchanged', () => {
  it('snapshot and narrative are the executor’s own', async () => {
    const agent = agentUnder();
    const doors = await served(agent);
    const executor = (agent as unknown as { lastExecutor: FlowChartExecutor }).lastExecutor;
    expect(coverageOfExecutor(executor)).toEqual({ state: 'declared-none' });
    expect(JSON.stringify(doors.snapshot)).toBe(JSON.stringify(executor.getSnapshot()));
    expect(doors.narrative).toEqual(executor.getNarrativeEntries());
    expect(holds(doors.snapshot)).toBe(true);
  });

  it('events, recordings and the account carry the run as it was', async () => {
    const doors = await served(agentUnder());
    expect(holds(doors.events)).toBe(true);
    expect(holds(doors.recording)).toBe(true);
    expect(holds(doors.unpacked)).toBe(true);
    // Nothing reads as kept out on a record no policy covered.
    expect(JSON.stringify(doors.account)).not.toContain('kept out');
  });
});

describe('UNKNOWN — a lookup that misses fails closed, whatever the instance declares', () => {
  for (const [label, redact] of [
    ['an instance with a policy', carriedConversationPolicy()],
    ['an instance with NO policy', undefined],
  ] as const) {
    describe(label, () => {
      it('snapshot and narrative: refused for an executor no run opened', async () => {
        const agent = agentUnder(redact);
        await agent.run({ message: 'first' });
        await unknownExecutor(agent);
        expect(agent.getLastSnapshot()).toBeUndefined();
        expect(agent.getSnapshot()).toBeUndefined();
        expect(agent.getLastNarrativeEntries()).toEqual([]);
      });

      it('events: a fact of a run the instance never opened is the placeholder', async () => {
        const agent = agentUnder(redact);
        await agent.run({ message: 'first' });
        const got: AgentfootprintEvent[] = [];
        agent.on('*', (e) => got.push(e));
        agent.emitAttributed('app.fact', { ssn: SECRET }, { sessionId: 's', runId: 'run-1-999' });
        const fact = got.find((e) => (e.type as string) === 'app.fact');
        expect(fact?.payload).toBe('[REDACTED]');
        expect(holds(got)).toBe(false);
      });

      it('recordings and the account: nothing of an executor no run opened', async () => {
        const agent = agentUnder(redact);
        const recorder = recordRun(agent);
        await agent.run({ message: 'first' });
        await unknownExecutor(agent);
        recorder.stop();
        const recording = recorder.toRecording();
        expect((recording as { snapshot?: unknown }).snapshot).toBeUndefined();
        const unpacked = unpackRecording(JSON.parse(JSON.stringify(packRecording(recording))));
        for (const value of [recording, unpacked, accountForAnswer(recording)]) {
          expect(locationsOf(value, `Check ${SECRET}`)).toEqual([]);
        }
      });
    });
  }
});

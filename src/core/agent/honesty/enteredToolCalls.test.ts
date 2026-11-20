import { describe, expect, it } from 'vitest';
import { commitValueAt } from 'foottrace';
import {
  Agent,
  checkInApproved,
  defineTool,
  deny,
  isCheckInPause,
  isPaused,
  pauseHere,
  RunCheckpointError,
  Sequence,
} from '../../../index.js';
import { mock } from '../../../llm-providers.js';
import type { CallOccurrenceKey } from '../../../lib/callOccurrence.js';
import { validateCheckpoint } from '../../runCheckpoint.js';
import { entryEvidenceOf } from '../assessment/entryEvidence.js';
import type { AgentState } from '../types.js';
import {
  MAX_ENTERED_TOOL_CALLS,
  recordToolEntry,
  type EnteredToolCall,
} from './enteredToolCalls.js';

const key = (ordinal: number): CallOccurrenceKey => [1, 2, 3, 4, ordinal];
const call = (name: string) => ({ toolCalls: [{ id: 'reused', name, args: {} }] });
const executeTool = (name: string, execute: () => string, checkIn?: 'always') =>
  defineTool({
    name,
    description: 'Run the entry fixture.',
    inputSchema: { type: 'object' },
    execute,
    ...(checkIn !== undefined && { checkIn }),
  });
const snapshot = (agent: Agent) => agent.getLastSnapshot()?.sharedState as Partial<AgentState>;

describe('committed tool entry', () => {
  it('keeps one fact per exact key and reports an incomplete bound', () => {
    const full: readonly EnteredToolCall[] = Array.from(
      { length: MAX_ENTERED_TOOL_CALLS },
      (_, index) => ({ callOccurrenceKey: key(index), entered: true }),
    );
    const state = {
      enteredToolCalls: full,
      enteredToolCallsComplete: true,
      $getValue(field: 'enteredToolCalls' | 'enteredToolCallsComplete') {
        return this[field];
      },
    };
    const scope = state as unknown as Parameters<typeof recordToolEntry>[0];
    recordToolEntry(scope, key(0));
    expect(state.enteredToolCalls).toBe(full);
    expect(state.enteredToolCallsComplete).toBe(true);
    recordToolEntry(scope, key(MAX_ENTERED_TOOL_CALLS));
    recordToolEntry(scope, key(MAX_ENTERED_TOOL_CALLS + 1));
    expect(state.enteredToolCalls).toBe(full);
    expect(state.enteredToolCallsComplete).toBe(false);

    state.enteredToolCalls = [];
    state.enteredToolCallsComplete = true;
    recordToolEntry(scope, undefined);
    recordToolEntry(scope, key(0));
    expect(state.enteredToolCalls).toEqual([{ callOccurrenceKey: key(0), entered: true }]);
    expect(state.enteredToolCallsComplete).toBe(false);
  });

  it('reads both entry formats and fails closed on a missing or damaged field', () => {
    const entries = [{ callOccurrenceKey: key(0), entered: true }];
    const keys = new Set(['1.2.3.4.0']);
    expect(entryEvidenceOf(entries, true)).toEqual({ keys, complete: true, legacy: false });
    expect(entryEvidenceOf({ entries, complete: true })).toEqual({
      keys,
      complete: true,
      legacy: true,
    });
    expect(entryEvidenceOf(undefined, true)?.complete).toBe(false);
    expect(entryEvidenceOf(entries)?.complete).toBe(false);
    expect(entryEvidenceOf([{ callOccurrenceKey: key(1), entered: false }], true)).toEqual({
      keys: new Set(),
      complete: false,
      legacy: false,
    });
    expect(entryEvidenceOf(undefined)).toBeUndefined();
  });

  it.each([true, false])(
    'records a throw and leaves the rejected occurrence out with the inputs layer %s',
    async (armed) => {
      let deniedEntered = false;
      const builder = Agent.create({
        model: 'mock',
        provider: mock({ replies: [call('blocked'), call('throws'), 'Done.'] }),
      })
        .tools([
          executeTool('blocked', () => {
            deniedEntered = true;
            return 'Unexpected result.';
          }),
          executeTool('throws', () => {
            throw new Error('Expected fixture exception.');
          }),
        ])
        .toolMiddleware({
          name: 'block the first occurrence',
          onToolCall: ({ toolName }) =>
            toolName === 'blocked' ? deny('Expected admission refusal.') : { kind: 'allow' },
        });
      if (armed) builder.inputsLayer();
      // This fixture toggles only the inputs layer that records entry.
      const agent = builder.answerLayer(false).build();
      try {
        await expect(agent.run({ message: 'Run both fixtures.' })).resolves.toBe('Done.');
        expect(deniedEntered).toBe(false);
        const { enteredToolCalls, enteredToolCallsComplete, history } = snapshot(agent);
        const landed = history!.filter(({ role }) => role === 'tool');
        expect(landed).toMatchObject([
          { toolCallId: 'reused', toolName: 'blocked', outcome: 'refused' },
          { toolCallId: 'reused', toolName: 'throws', outcome: 'failed' },
        ]);
        expect(landed[0]?.callOccurrenceKey).not.toEqual(landed[1]?.callOccurrenceKey);
        expect(enteredToolCalls).toEqual(
          armed ? [{ callOccurrenceKey: landed[1]?.callOccurrenceKey, entered: true }] : undefined,
        );
        expect(enteredToolCallsComplete).toBe(armed ? true : undefined);
      } finally {
        await agent.shutdown();
      }
    },
  );

  it.each(['append', 'legacy'] as const)(
    'retains %s entry proof through two pauses on a fresh executor and resets the next turn',
    async (format) => {
      const build = (replies: (ReturnType<typeof call> | string)[]) =>
        Agent.create({ model: 'mock', provider: mock({ replies }) })
          .tools([
            executeTool('collect', () =>
              pauseHere({ question: 'What should the fixture return?' }),
            ),
            executeTool('review', () => 'Reviewed.', 'always'),
            executeTool('again', () => 'New turn.'),
          ])
          .inputsLayer()
          .build();
      const agent = build([call('collect'), call('review')]);
      const fresh = build(['Done.', call('again'), 'Next.']);
      try {
        const paused = await agent.run({ message: 'Run the fixture.' });
        if (!isPaused(paused)) throw new Error('Expected an in-tool pause.');
        const initialState = paused.checkpoint.sharedState as Partial<AgentState>;
        const initial = initialState.enteredToolCalls;
        expect(initial).toEqual([{ callOccurrenceKey: expect.any(Array), entered: true }]);
        expect(initialState.enteredToolCallsComplete).toBe(true);
        const waiting = await agent.resume(paused.checkpoint, 'Fixture input.');
        if (!isCheckInPause(waiting)) throw new Error('Expected a consent pause.');
        expect((waiting.checkpoint.sharedState as Partial<AgentState>).enteredToolCalls).toEqual(
          initial,
        );
        const stored = JSON.parse(JSON.stringify(waiting.checkpoint)) as typeof waiting.checkpoint;
        if (format === 'legacy') {
          stored.sharedState.enteredToolCalls = { entries: initial, complete: true };
          delete stored.sharedState.enteredToolCallsComplete;
        }

        await expect(
          fresh.resume(stored, checkInApproved({ request: waiting.checkIn, by: 'fixture' })),
        ).resolves.toBe('Done.');
        const finished = snapshot(fresh).enteredToolCalls;
        expect(finished).toEqual([
          initial?.[0],
          { entered: true, callOccurrenceKey: expect.any(Array) },
        ]);
        expect(finished?.[0]?.callOccurrenceKey).not.toEqual(finished?.[1]?.callOccurrenceKey);
        expect(snapshot(fresh).enteredToolCallsComplete).toBe(true);

        await expect(fresh.followUp('Run the next fixture.')).resolves.toBe('Next.');
        const next = snapshot(fresh).enteredToolCalls;
        expect(next).toEqual([{ callOccurrenceKey: expect.any(Array), entered: true }]);
        expect(snapshot(fresh).enteredToolCallsComplete).toBe(true);
        expect(finished?.map(({ callOccurrenceKey }) => callOccurrenceKey)).not.toContainEqual(
          next?.[0]?.callOccurrenceKey,
        );
      } finally {
        await agent.shutdown();
        await fresh.shutdown();
      }
    },
  );

  it('writes one entry and one settlement per call during a 31-call turn', async () => {
    const name = 'lookup';
    const agent = Agent.create({
      model: 'mock',
      provider: mock({
        replies: [...Array.from({ length: 31 }, () => call(name)), 'Done.'],
      }),
      maxIterations: 32,
    })
      .tool(executeTool(name, () => 'Executed.'))
      .inputsLayer()
      .answerLayer()
      .build();
    try {
      await expect(agent.run({ message: 'Run 31 fixture calls.' })).resolves.toBe('Done.');
      const log = agent.getLastSnapshot()!.commitLog;
      const state = snapshot(agent);
      const writes = (key: string) =>
        log.flatMap(({ trace, overwrite }) =>
          trace
            .filter(({ path }) => path === key)
            .map(({ verb }) => ({ verb, value: overwrite[key] })),
        );
      for (const key of ['enteredToolCalls', 'settledToolCalls'] as const) {
        const rows = state[key]!;
        expect(rows).toHaveLength(31);
        expect(writes(key)).toEqual([
          { verb: 'set', value: [] },
          ...rows.map((row) => ({ verb: 'append', value: [row] })),
        ]);
        expect(writes(`${key}Complete`)).toEqual([{ verb: 'set', value: true }]);
        expect(commitValueAt(log, log.length - 1, key)).toEqual(rows);
        expect(commitValueAt(log, log.length - 1, `${key}Complete`)).toBe(true);
      }
    } finally {
      await agent.shutdown();
    }
  });

  it('restores detached turn proof after a crash and starts a new turn without it', async () => {
    const name = 'lookup';
    const build = (provider: ReturnType<typeof mock>) =>
      Agent.create({ model: 'mock', provider })
        .tool(executeTool(name, () => 'Executed.'))
        .inputsLayer()
        .answerLayer()
        .build();
    let requests = 0;
    const first = build(
      mock({
        respond: () => {
          if (++requests === 1) return call(name);
          throw new Error('Expected provider exception.');
        },
      }),
    );
    const fresh = build(mock({ replies: [call(name), 'Recovered.'] }));
    const next = build(mock({ replies: [call(name), 'New turn.'] }));
    try {
      const error: unknown = await first.run({ message: 'Run once.' }).catch((cause) => cause);
      expect(error).toBeInstanceOf(RunCheckpointError);
      if (!(error instanceof RunCheckpointError)) throw new Error('Expected a crash checkpoint.');
      const stored = JSON.parse(JSON.stringify(error.checkpoint)) as typeof error.checkpoint;
      const admitted = validateCheckpoint(stored);
      const prior = admitted.toolTurnEvidence?.entries;
      const settlements = admitted.toolTurnEvidence?.settlements;
      expect(prior).toEqual({
        rows: [{ callOccurrenceKey: expect.any(Array), entered: true }],
        complete: true,
      });
      expect(prior?.rows).not.toBe(stored.toolTurnEvidence?.entries?.rows);
      expect(prior?.rows[0]?.callOccurrenceKey).not.toBe(
        stored.toolTurnEvidence?.entries?.rows[0]?.callOccurrenceKey,
      );
      expect(settlements).toEqual({
        rows: [
          {
            callOccurrenceKey: prior?.rows[0]?.callOccurrenceKey,
            execution: 'returned',
            delivery: 'native',
          },
        ],
        complete: true,
      });
      expect(settlements?.rows).not.toBe(stored.toolTurnEvidence?.settlements?.rows);
      expect(settlements?.rows[0]?.callOccurrenceKey).not.toBe(
        stored.toolTurnEvidence?.settlements?.rows[0]?.callOccurrenceKey,
      );
      expect(() =>
        validateCheckpoint({
          ...stored,
          toolTurnEvidence: { entries: { rows: [{ entered: true }], complete: true } },
        }),
      ).toThrow('checkpoint toolTurnEvidence is malformed');
      const { toolTurnEvidence, ...oldShape } = stored;
      expect(() =>
        validateCheckpoint(Object.assign(Object.create({ toolTurnEvidence }), oldShape)),
      ).toThrow('checkpoint toolTurnEvidence is malformed');

      await expect(fresh.resumeOnError(stored)).resolves.toBe('Recovered.');
      expect(snapshot(fresh).enteredToolCalls).toEqual([
        prior?.rows[0],
        { callOccurrenceKey: expect.any(Array), entered: true },
      ]);
      expect(snapshot(fresh).enteredToolCallsComplete).toBe(true);
      expect(snapshot(fresh).settledToolCalls).toEqual([
        settlements?.rows[0],
        {
          callOccurrenceKey: snapshot(fresh).enteredToolCalls?.[1]?.callOccurrenceKey,
          execution: 'returned',
          delivery: 'native',
        },
      ]);
      expect(snapshot(fresh).settledToolCallsComplete).toBe(true);

      await expect(next.run({ message: 'Start over.', continueFrom: stored })).resolves.toBe(
        'New turn.',
      );
      expect(snapshot(next).enteredToolCalls).toEqual([
        { callOccurrenceKey: expect.any(Array), entered: true },
      ]);
      expect(snapshot(next).enteredToolCalls?.[0]).not.toEqual(prior?.rows[0]);
      expect(snapshot(next).enteredToolCallsComplete).toBe(true);
      expect(snapshot(next).settledToolCalls).toHaveLength(1);
      expect(snapshot(next).settledToolCalls?.[0]?.callOccurrenceKey).toEqual(
        snapshot(next).enteredToolCalls?.[0]?.callOccurrenceKey,
      );
      expect(snapshot(next).settledToolCallsComplete).toBe(true);
      expect(next.checkpoint()?.toolTurnEvidence).toBeUndefined();
    } finally {
      await first.shutdown();
      await fresh.shutdown();
      await next.shutdown();
    }
  });

  it('keeps separate proofs when two mounts use the same Agent', async () => {
    const agent = Agent.create({
      model: 'mock',
      provider: mock({
        respond: ({ messages }) =>
          messages.some(({ role }) => role === 'tool') ? 'Done.' : call('lookup'),
      }),
    })
      .tool(executeTool('lookup', () => 'Executed.'))
      .inputsLayer()
      .build();
    const sequence = Sequence.create().step('first', agent).step('second', agent).build();
    try {
      await expect(sequence.run({ message: 'Run both mounted fixtures.' })).resolves.toBe('Done.');
      type MemberResult = { treeContext?: { globalContext?: Partial<AgentState> } };
      const snapshot = sequence.getLastSnapshot() as unknown as {
        sharedState?: Partial<AgentState>;
        subflowResults?: ReadonlyMap<string, MemberResult> | Record<string, MemberResult>;
      };
      const results = snapshot.subflowResults;
      const ledgerOf = (name: string) => {
        const mount = `step-${name}`;
        const member =
          results instanceof Map
            ? results.get(mount)
            : (results as Record<string, MemberResult> | undefined)?.[mount];
        return member?.treeContext?.globalContext;
      };
      const first = ledgerOf('first');
      const second = ledgerOf('second');
      for (const ledger of [first, second]) {
        expect(ledger?.enteredToolCalls).toEqual([
          { callOccurrenceKey: expect.any(Array), entered: true },
        ]);
        expect(ledger?.enteredToolCallsComplete).toBe(true);
      }
      expect(first?.enteredToolCalls?.[0]?.callOccurrenceKey).not.toEqual(
        second?.enteredToolCalls?.[0]?.callOccurrenceKey,
      );
      expect(snapshot.sharedState?.enteredToolCalls).toBeUndefined();
      expect(snapshot.sharedState?.enteredToolCallsComplete).toBeUndefined();
    } finally {
      await sequence.shutdown();
      await agent.shutdown();
    }
  });
});

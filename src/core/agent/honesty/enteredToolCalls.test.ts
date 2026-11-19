import { describe, expect, it } from 'vitest';
import {
  Agent,
  checkInApproved,
  defineTool,
  deny,
  isCheckInPause,
  isPaused,
  pauseHere,
  Sequence,
} from '../../../index.js';
import { mock } from '../../../llm-providers.js';
import type { CallOccurrenceKey } from '../../../lib/callOccurrence.js';
import type { AgentState } from '../types.js';
import {
  appendEnteredToolCall,
  MAX_ENTERED_TOOL_CALLS,
  type EnteredToolCalls,
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
    const full: EnteredToolCalls = {
      entries: Array.from({ length: MAX_ENTERED_TOOL_CALLS }, (_, index) => ({
        callOccurrenceKey: key(index),
        entered: true,
      })),
      complete: true,
    };
    expect(appendEnteredToolCall(full, key(0))).toBe(full);
    const overflow = appendEnteredToolCall(full, key(MAX_ENTERED_TOOL_CALLS));
    expect(overflow).toEqual({ entries: full.entries, complete: false });
    expect(appendEnteredToolCall(overflow, key(MAX_ENTERED_TOOL_CALLS + 1))).toBe(overflow);
    expect(appendEnteredToolCall({ entries: [], complete: true }, undefined)).toEqual({
      entries: [],
      complete: false,
    });
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
      const agent = builder.build();
      try {
        await expect(agent.run({ message: 'Run both fixtures.' })).resolves.toBe('Done.');
        expect(deniedEntered).toBe(false);
        const { enteredToolCalls, history } = snapshot(agent);
        const landed = history!.filter(({ role }) => role === 'tool');
        expect(landed).toMatchObject([
          { toolCallId: 'reused', toolName: 'blocked', outcome: 'refused' },
          { toolCallId: 'reused', toolName: 'throws', outcome: 'failed' },
        ]);
        expect(landed[0]?.callOccurrenceKey).not.toEqual(landed[1]?.callOccurrenceKey);
        expect(enteredToolCalls).toEqual(
          armed
            ? {
                entries: [{ callOccurrenceKey: landed[1]?.callOccurrenceKey, entered: true }],
                complete: true,
              }
            : undefined,
        );
      } finally {
        await agent.shutdown();
      }
    },
  );

  it('retains the native entry through two pauses and starts fresh on the next turn', async () => {
    const agent = Agent.create({
      model: 'mock',
      provider: mock({
        replies: [call('collect'), call('review'), 'Done.', call('again'), 'Next.'],
      }),
    })
      .tools([
        executeTool('collect', () => pauseHere({ question: 'What should the fixture return?' })),
        executeTool('review', () => 'Reviewed.', 'always'),
        executeTool('again', () => 'New turn.'),
      ])
      .inputsLayer()
      .build();
    try {
      const paused = await agent.run({ message: 'Run the fixture.' });
      if (!isPaused(paused)) throw new Error('Expected an in-tool pause.');
      const initial = (paused.checkpoint.sharedState as Partial<AgentState>).enteredToolCalls;
      expect(initial).toEqual({
        entries: [{ callOccurrenceKey: expect.any(Array), entered: true }],
        complete: true,
      });
      const waiting = await agent.resume(paused.checkpoint, 'Fixture input.');
      if (!isCheckInPause(waiting)) throw new Error('Expected a consent pause.');
      expect((waiting.checkpoint.sharedState as Partial<AgentState>).enteredToolCalls).toEqual(
        initial,
      );

      await expect(
        agent.resume(
          waiting.checkpoint,
          checkInApproved({ request: waiting.checkIn, by: 'fixture' }),
        ),
      ).resolves.toBe('Done.');
      const finished = snapshot(agent).enteredToolCalls;
      expect(finished?.entries).toEqual([
        initial?.entries[0],
        { entered: true, callOccurrenceKey: expect.any(Array) },
      ]);
      expect(finished?.entries[0]?.callOccurrenceKey).not.toEqual(
        finished?.entries[1]?.callOccurrenceKey,
      );

      await expect(agent.followUp('Run the next fixture.')).resolves.toBe('Next.');
      const next = snapshot(agent).enteredToolCalls;
      expect(next).toEqual({
        entries: [{ callOccurrenceKey: expect.any(Array), entered: true }],
        complete: true,
      });
      expect(
        finished?.entries.map(({ callOccurrenceKey }) => callOccurrenceKey),
      ).not.toContainEqual(next?.entries[0]?.callOccurrenceKey);
    } finally {
      await agent.shutdown();
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
        return member?.treeContext?.globalContext?.enteredToolCalls;
      };
      const first = ledgerOf('first');
      const second = ledgerOf('second');
      for (const ledger of [first, second]) {
        expect(ledger).toEqual({
          entries: [{ callOccurrenceKey: expect.any(Array), entered: true }],
          complete: true,
        });
      }
      expect(first?.entries[0]?.callOccurrenceKey).not.toEqual(
        second?.entries[0]?.callOccurrenceKey,
      );
      expect(snapshot.sharedState?.enteredToolCalls).toBeUndefined();
    } finally {
      await sequence.shutdown();
      await agent.shutdown();
    }
  });
});

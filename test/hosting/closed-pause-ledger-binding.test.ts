/**
 * A decision for a pause minted under a ledger that CAN prove is spent only in
 * that same ledger.
 *
 * The close proves "did not run" by spending the request in the ledger it was
 * minted under. A resume used to spend wherever the resuming agent's ledger
 * was — so, reproduced on the release that proved closes by a tombstone:
 *
 *   1. minted under ledger A; a rebuilt agent on ledger B accepted the
 *      approval and the refund ran (B never saw the request); A's close then
 *      "proved" the call never ran;
 *   2. A closed first ("did not run" stored); B's resume then ran the refund.
 *
 * The law: when the pause records a minting ledger that can prove (a shared
 * ledger with a `storeId`, or this process's own default ledger), a resume
 * whose ledger is a different one is REFUSED before anything runs
 * (`'ledger-changed'`) — the person is asked again. A pause minted under a
 * ledger that cannot prove (no identity, or an earlier process's default
 * ledger) keeps today's behaviour.
 */

import { describe, expect, it } from 'vitest';

import {
  Agent,
  allow,
  ask,
  inMemoryDecisionLedger,
  isAskPause,
  type DecisionLedger,
  type RunnerPauseOutcome,
} from '../../src/index.js';
import { defineTool } from '../../src/tools/tools.js';
import { checkInApproved } from '../../src/core/checkin.js';
import {
  NOT_RUN_UNANSWERABLE,
  OUTCOME_UNKNOWN_UNANSWERABLE,
  closedConversation,
} from '../../src/hosting/answeredPause.js';
import { memorySessions, standingAgent, type PausedRun } from '../../src/hosting/index.js';
import type { LLMMessage, LLMProvider } from '../../src/provider-contract/types.js';
import { inProcessHost } from './testHost.js';

const usage = { input: 1, output: 1 };

interface World {
  readonly ran: number[];
  readonly sent: (readonly LLMMessage[])[];
}

/** A shared ledger over its own table, named `storeId`. */
function tableLedger(storeId: string): DecisionLedger {
  const table = new Set<string>();
  return {
    storeId,
    spend: (key: string) => (table.has(key) ? false : (table.add(key), true)),
    isSpent: (key: string) => table.has(key),
  } as DecisionLedger;
}

function refundsModel(world: World): LLMProvider {
  return {
    name: 'mock',
    complete: async (request) => {
      world.sent.push([...request.messages]);
      const last = request.messages[request.messages.length - 1];
      if (last?.role === 'tool') {
        return { content: 'refund issued', toolCalls: [], usage, stopReason: 'stop' };
      }
      return last?.role === 'user' && String(last.content).includes('refund')
        ? {
            content: '',
            toolCalls: [{ id: 't1', name: 'issue_refund', args: { amount: 10 } }],
            usage,
            stopReason: 'tool_use',
          }
        : { content: `noted: ${String(last?.content)}`, toolCalls: [], usage, stopReason: 'stop' };
    },
  };
}

/** The same rules on every agent — only the ledger differs. */
function asking(world: World, decisionLedger?: DecisionLedger): Agent {
  return Agent.create({
    provider: refundsModel(world),
    model: 'test-model',
    maxIterations: 4,
    ...(decisionLedger !== undefined && { decisionLedger }),
  })
    .system('terse')
    .tool(
      defineTool<{ amount: number }, string>({
        name: 'issue_refund',
        description: 'refund a customer',
        inputSchema: {
          type: 'object',
          properties: { amount: { type: 'number' } },
          required: ['amount'],
        },
        execute: ({ amount }) => {
          world.ran.push(amount);
          return `refunded ${amount}`;
        },
      }),
    )
    .toolMiddleware(
      { name: 'approval', onToolCall: () => ask({ question: 'Issue this refund?' }) },
      { name: 'limit', onToolCall: () => allow() },
    )
    .build();
}

async function pauseOn(agent: Agent): Promise<RunnerPauseOutcome & { ask: { id: string } }> {
  const paused = await agent.run({ message: 'refund me' });
  if (!isAskPause(paused)) throw new Error('expected the ask to pause');
  return paused as RunnerPauseOutcome & { ask: { id: string } };
}

const refusal = (reason: string) => ({ code: 'ERR_RESUME_DECISION', reason });

describe('a decision is spent only in the ledger its request was minted under', () => {
  it('repro 1 — minted under A, approved on an agent rebuilt on B: refused before anything runs', async () => {
    const world: World = { ran: [], sent: [] };
    const paused = await pauseOn(asking(world, tableLedger('ledger-a')));
    const rebuilt = asking(world, tableLedger('ledger-b'));
    await expect(
      rebuilt.resume(paused.checkpoint, checkInApproved({ request: paused.ask, by: 'alice' })),
    ).rejects.toMatchObject(refusal('ledger-changed'));
    expect(world.ran).toEqual([]);
  });

  it('repro 2 — A closes first ("did not run"); a resume on B afterwards is refused, and nothing runs', async () => {
    const world: World = { ran: [], sent: [] };
    const ledgerA = tableLedger('ledger-a');
    const agentA = asking(world, ledgerA);
    const paused = await pauseOn(agentA);
    const stored: PausedRun = {
      checkpoint: paused.checkpoint,
      conversation: {
        version: 1,
        runId: 'r',
        history: [
          { role: 'user', content: 'refund me' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 't1', name: 'issue_refund', args: { amount: 10 } }],
          },
        ],
        lastCompletedIteration: 1,
        originalInput: { message: 'refund me' },
        checkpointedAt: 1,
      },
      pending: { ask: paused.ask as never },
    };
    const closed = await closedConversation(stored, { runner: agentA });
    expect(closed.history[closed.history.length - 1]?.content).toBe(NOT_RUN_UNANSWERABLE);
    const rebuilt = asking(world, tableLedger('ledger-b'));
    await expect(
      rebuilt.resume(paused.checkpoint, checkInApproved({ request: paused.ask, by: 'alice' })),
    ).rejects.toMatchObject(refusal('ledger-changed'));
    expect(world.ran).toEqual([]);
  });

  it('the process ledger, too: minted under this process’s default, approved on an agent given a shared ledger — refused', async () => {
    const world: World = { ran: [], sent: [] };
    const paused = await pauseOn(asking(world));
    const rebuilt = asking(world, tableLedger('ledger-b'));
    await expect(
      rebuilt.resume(paused.checkpoint, checkInApproved({ request: paused.ask, by: 'alice' })),
    ).rejects.toMatchObject(refusal('ledger-changed'));
    expect(world.ran).toEqual([]);
  });

  it('the same shared ledger in another instance (another process) answers as before', async () => {
    const world: World = { ran: [], sent: [] };
    const table = new Set<string>();
    const instance = (): DecisionLedger =>
      ({
        storeId: 'ledger-a',
        spend: (key: string) => (table.has(key) ? false : (table.add(key), true)),
        isSpent: (key: string) => table.has(key),
      } as DecisionLedger);
    const paused = await pauseOn(asking(world, instance()));
    await asking(world, instance()).resume(
      paused.checkpoint,
      checkInApproved({ request: paused.ask, by: 'alice' }),
    );
    expect(world.ran).toEqual([10]);
  });

  it('control — a pause minted under a ledger that cannot prove keeps today’s behaviour', async () => {
    const world: World = { ran: [], sent: [] };
    const paused = await pauseOn(asking(world, inMemoryDecisionLedger()));
    await asking(world, inMemoryDecisionLedger()).resume(
      paused.checkpoint,
      checkInApproved({ request: paused.ask, by: 'alice' }),
    );
    expect(world.ran).toEqual([10]);
  });

  it('control — a pause an earlier process minted under its default ledger keeps today’s behaviour after a restart', async () => {
    const world: World = { ran: [], sent: [] };
    const paused = await pauseOn(asking(world));
    const state = paused.checkpoint.sharedState as Record<string, unknown>;
    const request = state.pausedRequest as Record<string, unknown>;
    const fromEarlierProcess = {
      ...paused.checkpoint,
      sharedState: { ...state, pausedRequest: { ...request, ledger: `process:${'0'.repeat(32)}` } },
    };
    await asking(world).resume(
      fromEarlierProcess as never,
      checkInApproved({ request: paused.ask, by: 'alice' }),
    );
    expect(world.ran).toEqual([10]);
  });

  it('the refusal asks for the person to be asked again, and carries no request id', async () => {
    const world: World = { ran: [], sent: [] };
    const paused = await pauseOn(asking(world, tableLedger('ledger-a')));
    const error = await asking(world, tableLedger('ledger-b'))
      .resume(paused.checkpoint, checkInApproved({ request: paused.ask, by: 'alice' }))
      .catch((err: unknown) => err as Error);
    expect(error.message).toMatch(/ask(ed)? (the person )?again/i);
    expect(error.message).not.toContain(paused.ask.id);
    expect(JSON.stringify(error)).not.toContain(paused.ask.id);
  });
});

describe('a hosted door — the approval reaches a replica on another ledger', () => {
  it('refused (409), nothing runs, and the pause is closed rather than held: the next message continues', async () => {
    const world: World = { ran: [], sent: [] };
    const sessions = memorySessions();
    const first = inProcessHost();
    const firstHandle = await standingAgent({
      agent: asking(world, tableLedger('ledger-a')),
      sessions,
      host: first,
    });
    const asked = await first.deliver({ input: 'refund me', sessionId: 's' });
    await firstHandle.close();
    if (asked.awaiting?.ask === undefined) throw new Error('expected the ask to pause');
    const second = inProcessHost();
    const secondHandle = await standingAgent({
      agent: asking(world, tableLedger('ledger-b')),
      sessions,
      host: second,
    });
    try {
      const answered = await second.deliver({
        input: '',
        sessionId: 's',
        decision: checkInApproved({ request: asked.awaiting.ask, by: 'alice' }),
      });
      expect(answered.code).toBe('ERR_RESUME_DECISION');
      expect(answered.error).toMatch(/ledger/);
      expect(world.ran).toEqual([]);
      expect((await sessions.hydrate('s'))?.format).toBe('conversation-v1');
      const next = await second.deliver({ input: 'is it done?', sessionId: 's' });
      expect(next.output).toBe('noted: is it done?');
      // This replica's ledger is not the one the request was minted under, so
      // it cannot prove the call never ran there: may have run.
      const told = [...(world.sent[world.sent.length - 1] ?? [])]
        .reverse()
        .find((m) => m.role === 'tool')?.content;
      expect(told).toBe(OUTCOME_UNKNOWN_UNANSWERABLE);
    } finally {
      await secondHandle.close();
    }
  });
});

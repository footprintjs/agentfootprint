/**
 * The proof that a closed pause's call never ran — the review round.
 *
 *  1. PROOF BY TOMBSTONE, NOT A READ. Reading `isSpent` and then writing the
 *     close leaves a window in which a resume on another replica runs the
 *     refund; and a ledger may expire `isSpent` keys. The proof is the
 *     ledger's own atomic `spend(requestId) === true` — which also CONSUMES
 *     the request, so no later resume can run the call.
 *  2. ONLY THE MINTING LEDGER CAN PROVE. A redeploy that also moved from the
 *     default ledger to a shared one asked a ledger that never saw the spend.
 *     The pause carries the identity of the ledger it was minted under; only
 *     that ledger proves, and a ledger without a stable identity never does.
 *  3. THE PROCESS LEDGER PROVES ONLY WITH A PROCESS-LOCAL SESSION STORE. With
 *     a shared store another replica, on its own default ledger, can have
 *     spent and run it. A restart is a new process ledger: it never proves.
 *  4. The unknown notice says what to do, and every host notice is marked as
 *     the library's (`toolResultOrigin`), findings or not.
 *  5. The refusals that tell a caller about a closed pause say "not run only
 *     when proven".
 */

import { describe, expect, it, vi } from 'vitest';

import { Agent, allow, ask, type DecisionLedger } from '../../src/index.js';
import { defineTool } from '../../src/tools/tools.js';
import { checkInApproved } from '../../src/core/checkin.js';
import { ResumeDecisionError } from '../../src/core/pause.js';
import {
  NOT_RUN_UNANSWERABLE,
  OUTCOME_NOT_RECORDED,
  OUTCOME_UNKNOWN_UNANSWERABLE,
} from '../../src/hosting/answeredPause.js';
import {
  memorySessions,
  readPausedRun,
  standingAgent,
  toPausedEnvelope,
  type CheckpointEnvelope,
  type SessionLifecycle,
} from '../../src/hosting/index.js';
import type { LLMMessage, LLMProvider } from '../../src/provider-contract/types.js';
import { inProcessHost } from './testHost.js';

const usage = { input: 1, output: 1 };
const CHECK = 'Tell the person it may already have happened and ask them to check.';

/** One refund for a refund request; the call after the tool fails while `failing.model`. */
function refundsModel(sent: (readonly LLMMessage[])[], failing: { model: boolean }): LLMProvider {
  return {
    name: 'mock',
    complete: async (request) => {
      sent.push([...request.messages]);
      const last = request.messages[request.messages.length - 1];
      if (last?.role === 'tool') {
        if (failing.model) throw new Error('model unavailable');
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

interface World {
  readonly ran: number[];
  readonly sent: (readonly LLMMessage[])[];
  readonly failing: { model: boolean; persist: boolean };
}

function newWorld(): World {
  return { ran: [], sent: [], failing: { model: false, persist: false } };
}

/** An agent whose `approval` link asks before every refund, and `later` runs after it. */
function asking(later: string, world: World, decisionLedger?: DecisionLedger): Agent {
  return Agent.create({
    provider: refundsModel(world.sent, world.failing),
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
      { name: later, onToolCall: () => allow() },
    )
    .build();
}

/**
 * A ledger in a store every process reaches — a unique-key table. Separate
 * INSTANCES over one `table` are two processes sharing it; `id` is the
 * table's stable name. `isSpent` answers `isSpentSays` when given — a key it
 * expired, say — while `spend` keeps the truth.
 */
function tableLedger(
  table: Set<string>,
  id: string | undefined,
  isSpentSays?: boolean,
): DecisionLedger {
  return {
    ...(id !== undefined && { id }),
    spend: async (requestId) => {
      if (table.has(requestId)) return false;
      table.add(requestId);
      return true;
    },
    isSpent: async (requestId) => isSpentSays ?? table.has(requestId),
  } as DecisionLedger;
}

/** A session store that is NOT this process's memory — a database every replica reaches. */
function sharedStore(failing: { persist: boolean }): SessionLifecycle {
  const rows = new Map<string, CheckpointEnvelope>();
  return {
    hydrate: async (id) => rows.get(id),
    persist: async (id, envelope) => {
      if (failing.persist) throw new Error('store unavailable');
      rows.set(id, JSON.parse(JSON.stringify(envelope)) as CheckpointEnvelope);
    },
  } as SessionLifecycle;
}

/** This process's memory store, its writes failing while `failing.persist`. */
function localStore(failing: { persist: boolean }): SessionLifecycle {
  const store = memorySessions();
  const persist = store.persist.bind(store);
  (store as { persist: SessionLifecycle['persist'] }).persist = async (id, envelope) => {
    if (failing.persist) throw new Error('store unavailable');
    return persist(id, envelope);
  };
  return store;
}

const toldAbout = (sent: (readonly LLMMessage[])[]): unknown[] =>
  sent.flatMap((messages) =>
    messages.filter((m) => m.role === 'tool' && m.toolCallId === 't1').map((m) => m.content),
  );

const lastTold = (sent: (readonly LLMMessage[])[]): LLMMessage | undefined =>
  [...(sent[sent.length - 1] ?? [])].reverse().find((m) => m.role === 'tool');

/**
 * Pause on `before`, optionally approve it there (the refund runs, the next
 * model call fails, the mark write fails), then serve the same store with
 * `after` — a redeploy whose chain renamed the rule after the ask — and send
 * the next message.
 */
async function redeploy(input: {
  readonly world: World;
  readonly store: SessionLifecycle;
  readonly before: Agent;
  readonly after: Agent;
  readonly approveFirst: boolean;
}) {
  const { world, store } = input;
  const first = inProcessHost();
  const firstHandle = await standingAgent({ agent: input.before, sessions: store, host: first });
  const asked = await first.deliver({ input: 'refund me', sessionId: 's' });
  if (asked.awaiting?.ask === undefined) throw new Error('expected the ask to pause');
  const decision = checkInApproved({ request: asked.awaiting.ask, by: 'alice' });
  const checkpoint = readPausedRun(await store.hydrate('s')).checkpoint;
  if (input.approveFirst) {
    world.failing.model = true;
    world.failing.persist = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await first.deliver({ input: '', sessionId: 's', decision });
    warn.mockRestore();
    world.failing.model = false;
    world.failing.persist = false;
  }
  await firstHandle.close();
  const second = inProcessHost();
  const secondHandle = await standingAgent({ agent: input.after, sessions: store, host: second });
  const next = await second.deliver({ input: 'is it done?', sessionId: 's' });
  await secondHandle.close();
  return { next, decision, checkpoint };
}

// ── 1. the tombstone ────────────────────────────────────────────────────

describe('1 — proof by tombstone: the ledger’s own atomic spend, never a read', () => {
  it('a ledger whose isSpent says "not spent" (an expired key) while its spend knows better proves nothing', async () => {
    const world = newWorld();
    const table = new Set<string>();
    const store = localStore(world.failing);
    const { next } = await redeploy({
      world,
      store,
      before: asking('limit', world, tableLedger(table, 'refunds-ledger', false)),
      after: asking('limit-v2', world, tableLedger(table, 'refunds-ledger', false)),
      approveFirst: true,
    });
    expect(world.ran).toEqual([10]);
    expect(next.output).toBe('noted: is it done?');
    expect(toldAbout(world.sent)).not.toContain(NOT_RUN_UNANSWERABLE);
    expect(lastTold(world.sent)?.content).toBe(OUTCOME_UNKNOWN_UNANSWERABLE);
  });

  it('a proven close consumes the request: a resume of the old checkpoint afterwards is refused and runs nothing', async () => {
    const world = newWorld();
    const table = new Set<string>();
    const store = localStore(world.failing);
    const oldRules = asking('limit', world, tableLedger(table, 'refunds-ledger'));
    const { decision, checkpoint } = await redeploy({
      world,
      store,
      before: oldRules,
      after: asking('limit-v2', world, tableLedger(table, 'refunds-ledger')),
      approveFirst: false,
    });
    expect(lastTold(world.sent)?.content).toBe(NOT_RUN_UNANSWERABLE);
    // An older replica, still running the old rules, gets the person's approval late.
    const late = asking('limit', world, tableLedger(table, 'refunds-ledger'));
    await expect(late.resume(checkpoint, decision)).rejects.toMatchObject({
      code: 'ERR_RESUME_DECISION',
      reason: 'already-answered',
    });
    expect(world.ran).toEqual([]);
  });

  it.each([
    ['the old-rules replica’s approval reaches the ledger first', 'resume-first'],
    ['the closing replica reaches the ledger first', 'close-first'],
  ] as const)(
    'two concurrent resumes of one pause — %s: never a refund that ran told "did not run"',
    async (_label, winner) => {
      const world = newWorld();
      const table = new Set<string>();
      const held: (() => void)[] = [];
      /** Every spend waits for the test to let it through, so the order is the test's. */
      const gated = (): DecisionLedger => ({
        id: 'refunds-ledger',
        spend: async (requestId: string) => {
          await new Promise<void>((go) => held.push(go));
          if (table.has(requestId)) return false;
          table.add(requestId);
          return true;
        },
      });
      const store = localStore(world.failing);
      const oldHost = inProcessHost();
      const oldHandle = await standingAgent({
        agent: asking('limit', world, gated()),
        sessions: store,
        host: oldHost,
      });
      const newHost = inProcessHost();
      const newHandle = await standingAgent({
        agent: asking('limit-v2', world, gated()),
        sessions: store,
        host: newHost,
      });
      const waitFor = async (count: number): Promise<void> => {
        for (let tick = 0; held.length < count && tick < 2000; tick++) {
          await new Promise((done) => setTimeout(done, 1));
        }
        expect(held.length).toBe(count);
      };
      try {
        const asked = await oldHost.deliver({ input: 'refund me', sessionId: 's' });
        const decision = checkInApproved({ request: asked.awaiting!.ask!, by: 'alice' });
        const approving = oldHost.deliver({ input: '', sessionId: 's', decision });
        await waitFor(1);
        const closing = newHost.deliver({ input: 'is it done?', sessionId: 's' });
        await waitFor(2);
        const [resumeSpend, closeSpend] = held;
        if (winner === 'resume-first') {
          resumeSpend!();
          await new Promise((done) => setTimeout(done, 5));
          closeSpend!();
        } else {
          closeSpend!();
          await new Promise((done) => setTimeout(done, 5));
          resumeSpend!();
        }
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const [approved, closed] = await Promise.all([approving, closing]);
        warn.mockRestore();
        const toldOnClose = closed.output === undefined ? undefined : lastTold(world.sent);
        if (winner === 'resume-first') {
          expect(world.ran).toEqual([10]);
          expect(approved.output).toBe('refund issued');
          expect(toldAbout(world.sent)).not.toContain(NOT_RUN_UNANSWERABLE);
          expect(toldOnClose?.content).toBe(OUTCOME_UNKNOWN_UNANSWERABLE);
        } else {
          expect(world.ran).toEqual([]);
          expect(approved.code).toBe('ERR_RESUME_DECISION');
          expect(toldOnClose?.content).toBe(NOT_RUN_UNANSWERABLE);
        }
      } finally {
        await oldHandle.close();
        await newHandle.close();
      }
    },
  );
});

// ── 2. only the minting ledger ──────────────────────────────────────────

describe('2 — only the ledger the request was minted under can prove', () => {
  it('a redeploy that moves from the default ledger to a shared one asks a ledger that never saw the spend: not known', async () => {
    const world = newWorld();
    const store = localStore(world.failing);
    const { next } = await redeploy({
      world,
      store,
      before: asking('limit', world),
      after: asking('limit-v2', world, tableLedger(new Set(), 'refunds-ledger')),
      approveFirst: true,
    });
    expect(world.ran).toEqual([10]);
    expect(next.output).toBe('noted: is it done?');
    expect(toldAbout(world.sent)).not.toContain(NOT_RUN_UNANSWERABLE);
    expect(lastTold(world.sent)?.content).toBe(OUTCOME_UNKNOWN_UNANSWERABLE);
  });

  it('a ledger with no stable identity never proves, even when nothing was spent', async () => {
    const world = newWorld();
    const table = new Set<string>();
    await redeploy({
      world,
      store: sharedStore(world.failing),
      before: asking('limit', world, tableLedger(table, undefined)),
      after: asking('limit-v2', world, tableLedger(table, undefined)),
      approveFirst: false,
    });
    expect(lastTold(world.sent)?.content).toBe(OUTCOME_UNKNOWN_UNANSWERABLE);
  });

  it('two ledgers with different identities: the closing one never saw the request — not known', async () => {
    const world = newWorld();
    await redeploy({
      world,
      store: sharedStore(world.failing),
      before: asking('limit', world, tableLedger(new Set(), 'ledger-a')),
      after: asking('limit-v2', world, tableLedger(new Set(), 'ledger-b')),
      approveFirst: false,
    });
    expect(lastTold(world.sent)?.content).toBe(OUTCOME_UNKNOWN_UNANSWERABLE);
  });

  it('separate instances of ONE shared ledger (two processes, one table, one id) prove a request nobody spent', async () => {
    const world = newWorld();
    const table = new Set<string>();
    await redeploy({
      world,
      store: sharedStore(world.failing),
      before: asking('limit', world, tableLedger(table, 'refunds-ledger')),
      after: asking('limit-v2', world, tableLedger(table, 'refunds-ledger')),
      approveFirst: false,
    });
    expect(world.ran).toEqual([]);
    expect(lastTold(world.sent)?.content).toBe(NOT_RUN_UNANSWERABLE);
  });

  it('…and say "not known" when one of them spent it', async () => {
    const world = newWorld();
    const table = new Set<string>();
    await redeploy({
      world,
      store: sharedStore(world.failing),
      before: asking('limit', world, tableLedger(table, 'refunds-ledger')),
      after: asking('limit-v2', world, tableLedger(table, 'refunds-ledger')),
      approveFirst: true,
    });
    expect(world.ran).toEqual([10]);
    expect(lastTold(world.sent)?.content).toBe(OUTCOME_UNKNOWN_UNANSWERABLE);
  });
});

// ── 3. the process ledger and the session store ─────────────────────────

describe('3 — the process ledger proves only with a process-local session store', () => {
  it('a shared session store: another replica on its own default ledger may have run it — not known', async () => {
    const world = newWorld();
    await redeploy({
      world,
      store: sharedStore(world.failing),
      before: asking('limit', world),
      after: asking('limit-v2', world),
      approveFirst: false,
    });
    expect(world.ran).toEqual([]);
    expect(lastTold(world.sent)?.content).toBe(OUTCOME_UNKNOWN_UNANSWERABLE);
  });

  it('this process’s memory store and the request minted here, never spent: the call did not run', async () => {
    const world = newWorld();
    await redeploy({
      world,
      store: localStore(world.failing),
      before: asking('limit', world),
      after: asking('limit-v2', world),
      approveFirst: false,
    });
    expect(lastTold(world.sent)?.content).toBe(NOT_RUN_UNANSWERABLE);
  });

  it('a restart: the pause was minted under the previous process’s ledger — not known', async () => {
    const world = newWorld();
    const store = localStore(world.failing);
    const host = inProcessHost();
    const handle = await standingAgent({ agent: asking('limit', world), sessions: store, host });
    try {
      await host.deliver({ input: 'refund me', sessionId: 's' });
      // What a previous process stored: the request names ITS ledger.
      const stored = readPausedRun(await store.hydrate('s'));
      const state = stored.checkpoint.sharedState as Record<string, unknown>;
      const request = state.pausedRequest as Record<string, unknown>;
      expect(typeof request.ledger).toBe('string');
      await store.persist(
        's',
        toPausedEnvelope({
          ...stored,
          checkpoint: {
            ...stored.checkpoint,
            sharedState: {
              ...state,
              pausedRequest: { ...request, ledger: `process:${'0'.repeat(32)}` },
            },
          },
        }),
      );
    } finally {
      await handle.close();
    }
    const after = inProcessHost();
    const afterHandle = await standingAgent({
      agent: asking('limit-v2', world),
      sessions: store,
      host: after,
    });
    try {
      await after.deliver({ input: 'is it done?', sessionId: 's' });
      expect(lastTold(world.sent)?.content).toBe(OUTCOME_UNKNOWN_UNANSWERABLE);
    } finally {
      await afterHandle.close();
    }
  });
});

// ── 4 & 5. what the model and the caller are told ───────────────────────

describe('4 — the notices say what to do, and are always marked as the library’s', () => {
  it('the unknown notice: may have run, no result, do not run it again, tell the person', () => {
    expect(OUTCOME_UNKNOWN_UNANSWERABLE).toBe(
      'This call may have run; no result was kept. Do not run it again. ' + CHECK,
    );
    expect(OUTCOME_UNKNOWN_UNANSWERABLE).not.toMatch(/approv/i);
    expect(OUTCOME_NOT_RECORDED.endsWith(CHECK)).toBe(true);
  });

  it('marked as the library’s whether or not the run served findings', async () => {
    const world = newWorld();
    await redeploy({
      world,
      store: sharedStore(world.failing),
      before: asking('limit', world),
      after: asking('limit-v2', world),
      approveFirst: false,
    });
    // The model never sees the marker; the stored conversation carries it.
    expect(lastTold(world.sent)).not.toHaveProperty('toolResultOrigin');
  });
});

describe('5 — a refusal that tells a caller about a closed pause', () => {
  it.each(['request-not-recorded', 'call-changed', 'chain-changed'] as const)(
    "'%s' says the call is recorded as not run only when proven",
    (reason) => {
      const message = new ResumeDecisionError(reason, 'ask').message;
      expect(message).toContain('as not run only when proven, otherwise as not known');
      expect(message).not.toMatch(/recorded as not run\.$/);
    },
  );
});

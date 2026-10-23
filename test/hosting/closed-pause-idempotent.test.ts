/**
 * A close is idempotent: a retried close reaches the verdict the first one
 * proved, and a person answering a pause a host closed is told so.
 *
 * The tombstone (`spend(requestId)`) is taken BEFORE the closed pause is
 * stored. If storing it fails — the close's own write, or the run that goes on
 * from it — the pause is still stored as waiting, and:
 *
 *   - a retried close used to find the request spent and say "may have run"
 *     about a call the first attempt PROVED never ran;
 *   - a person answering the still-stored pause was told "already answered …
 *     not known", as if their approval had been used.
 *
 * The law: once a closer wins the request, it also records that IT closed it
 * — a second spend, of `closed-proven:<requestId>`. A retried close, and a
 * resume refused because the request is spent, read that marker
 * (`DecisionLedger.isSpent`): present → proven not run, and the person is
 * told the host closed the request and the call did not run; absent → not
 * known. A crash between the two spends leaves the request spent and no
 * marker: "not known" — the safe direction, never a false "did not run".
 */

import { describe, expect, it, vi } from 'vitest';

import { Agent, allow, ask, type DecisionLedger } from '../../src/index.js';
import { defineTool } from '../../src/tools/tools.js';
import { checkInApproved } from '../../src/core/checkin.js';
import {
  NOT_RUN_UNANSWERABLE,
  OUTCOME_UNKNOWN_UNANSWERABLE,
} from '../../src/hosting/answeredPause.js';
import {
  memorySessions,
  readPausedRun,
  standingAgent,
  type SessionLifecycle,
} from '../../src/hosting/index.js';
import type { LLMMessage, LLMProvider } from '../../src/provider-contract/types.js';
import { inProcessHost } from './testHost.js';

const usage = { input: 1, output: 1 };

interface World {
  readonly ran: number[];
  readonly sent: (readonly LLMMessage[])[];
  /** `model` fails every model call; `persist` fails every store write. */
  readonly failing: { model: boolean; persist: boolean };
  /** The shared table — request ids and close markers alike. */
  readonly table: Set<string>;
  /** Keys whose spend "crashes" (throws) instead of landing. */
  readonly crashOn: (key: string) => boolean;
}

function newWorld(crashOn: (key: string) => boolean = () => false): World {
  return {
    ran: [],
    sent: [],
    failing: { model: false, persist: false },
    table: new Set(),
    crashOn,
  };
}

/** A shared ledger over `world.table`, named by a stable `storeId`; spends permanent. */
function sharedLedger(world: World): DecisionLedger {
  return {
    storeId: 'refunds-ledger',
    spend: async (key: string) => {
      if (world.crashOn(key)) throw new Error('process died');
      if (world.table.has(key)) return false;
      world.table.add(key);
      return true;
    },
    isSpent: async (key: string) => world.table.has(key),
  } as DecisionLedger;
}

function refundsModel(world: World): LLMProvider {
  return {
    name: 'mock',
    complete: async (request) => {
      world.sent.push([...request.messages]);
      if (world.failing.model) throw new Error('model unavailable');
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

/** An agent whose `approval` link asks before every refund, and `later` runs after it. */
function asking(later: string, world: World): Agent {
  return Agent.create({
    provider: refundsModel(world),
    model: 'test-model',
    maxIterations: 4,
    decisionLedger: sharedLedger(world),
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

/** A session store every replica reaches, its writes failing while `failing.persist`. */
function store(world: World): SessionLifecycle {
  const inner = memorySessions();
  const persist = inner.persist.bind(inner);
  (inner as { persist: SessionLifecycle['persist'] }).persist = async (id, envelope) => {
    if (world.failing.persist) throw new Error('store unavailable');
    return persist(id, envelope);
  };
  return inner;
}

const lastTold = (world: World): unknown =>
  [...(world.sent[world.sent.length - 1] ?? [])].reverse().find((m) => m.role === 'tool')?.content;

/** Serve `agent` on `sessions` over a fresh in-process host. */
async function serve(agent: Agent, sessions: SessionLifecycle) {
  const host = inProcessHost();
  const handle = await standingAgent({ agent, sessions, host });
  return { host, close: () => handle.close() };
}

/** Pause on the old rules; return the person's approval for it. */
async function pauseOnOldRules(world: World, sessions: SessionLifecycle) {
  const old = await serve(asking('limit', world), sessions);
  const asked = await old.host.deliver({ input: 'refund me', sessionId: 's' });
  if (asked.awaiting?.ask === undefined) throw new Error('expected the ask to pause');
  return { old, decision: checkInApproved({ request: asked.awaiting.ask, by: 'alice' }) };
}

describe('a retried close reaches the verdict the first close proved', () => {
  it('the run that goes on from the close fails, so the pause is still stored: the next message still says did not run', async () => {
    const world = newWorld();
    const sessions = store(world);
    const { old } = await pauseOnOldRules(world, sessions);
    await old.close();
    const redeployed = await serve(asking('limit-v2', world), sessions);
    try {
      world.failing.model = true;
      const failed = await redeployed.host.deliver({ input: 'is it done?', sessionId: 's' });
      expect(failed.error).toBeDefined();
      world.failing.model = false;
      // The close was never stored: the pause still waits.
      expect((await sessions.hydrate('s'))?.format).toBe('flowchart-v1');
      const next = await redeployed.host.deliver({ input: 'is it done?', sessionId: 's' });
      expect(next.output).toBe('noted: is it done?');
      expect(lastTold(world)).toBe(NOT_RUN_UNANSWERABLE);
      expect(world.ran).toEqual([]);
    } finally {
      await redeployed.close();
    }
  });

  it('a refused answer closes it, the close’s own write fails, and the next message still says did not run', async () => {
    const world = newWorld();
    const sessions = store(world);
    const { old, decision } = await pauseOnOldRules(world, sessions);
    await old.close();
    const redeployed = await serve(asking('limit-v2', world), sessions);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      world.failing.persist = true;
      const refused = await redeployed.host.deliver({ input: '', sessionId: 's', decision });
      expect(refused.code).toBe('ERR_RESUME_DECISION');
      world.failing.persist = false;
      expect((await sessions.hydrate('s'))?.format).toBe('flowchart-v1');
      await redeployed.host.deliver({ input: 'is it done?', sessionId: 's' });
      expect(lastTold(world)).toBe(NOT_RUN_UNANSWERABLE);
      expect(world.ran).toEqual([]);
    } finally {
      warn.mockRestore();
      await redeployed.close();
    }
  });

  it('a crash between the two spends — the request spent, no close marker — degrades to may-have-run, never to did-not-run', async () => {
    const world = newWorld((key) => key.startsWith('closed-proven:'));
    const sessions = store(world);
    const { old } = await pauseOnOldRules(world, sessions);
    await old.close();
    const redeployed = await serve(asking('limit-v2', world), sessions);
    try {
      // The close wins the request, then "dies" before its marker lands — and
      // the run that goes on from it fails, so nothing of it is stored.
      world.failing.model = true;
      await redeployed.host.deliver({ input: 'is it done?', sessionId: 's' });
      world.failing.model = false;
      await redeployed.host.deliver({ input: 'is it done?', sessionId: 's' });
      expect(lastTold(world)).toBe(OUTCOME_UNKNOWN_UNANSWERABLE);
      expect(world.ran).toEqual([]);
    } finally {
      await redeployed.close();
    }
  });
});

describe('a person answering a pause a host closed is told the host closed it — the call did not run', () => {
  it('an old-rules replica refuses the approval as closed by the host, runs nothing, and stores the close', async () => {
    const world = newWorld();
    const sessions = store(world);
    const { old, decision } = await pauseOnOldRules(world, sessions);
    // A new-rules replica closes the pause; storing what follows fails.
    const redeployed = await serve(asking('limit-v2', world), sessions);
    world.failing.persist = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await redeployed.host.deliver({ input: 'is it done?', sessionId: 's' });
      world.failing.persist = false;
      expect((await sessions.hydrate('s'))?.format).toBe('flowchart-v1');

      // The person's approval reaches the old replica, where the rules still match.
      const answered = await old.host.deliver({ input: '', sessionId: 's', decision });
      expect(answered.code).toBe('ERR_RESUME_DECISION');
      expect(answered.error).toContain('closed');
      expect(answered.error).toContain('did not run');
      expect(answered.error).not.toContain('not known');
      expect(world.ran).toEqual([]);

      // …and the closed conversation is stored: the next message says did not run.
      expect((await sessions.hydrate('s'))?.format).toBe('conversation-v1');
      await old.host.deliver({ input: 'is it done?', sessionId: 's' });
      expect(lastTold(world)).toBe(NOT_RUN_UNANSWERABLE);
    } finally {
      warn.mockRestore();
      await old.close();
      await redeployed.close();
    }
  });

  it('the refusal carries its own reason, distinct from already-answered', async () => {
    const world = newWorld();
    const sessions = store(world);
    const { old, decision } = await pauseOnOldRules(world, sessions);
    const redeployed = await serve(asking('limit-v2', world), sessions);
    world.failing.persist = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await redeployed.host.deliver({ input: 'is it done?', sessionId: 's' });
      world.failing.persist = false;
      const late = asking('limit', world);
      const checkpoint = readPausedRun(await sessions.hydrate('s')).checkpoint;
      await expect(late.resume(checkpoint, decision)).rejects.toMatchObject({
        code: 'ERR_RESUME_DECISION',
        reason: 'closed-by-host',
      });
      expect(world.ran).toEqual([]);
    } finally {
      warn.mockRestore();
      await old.close();
      await redeployed.close();
    }
  });
});

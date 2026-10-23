/**
 * A closed pause says "did not run" only when non-execution is PROVEN.
 *
 * Reproduced on the release that bound decisions to their request:
 *   1. a person approves a refund the middleware asked about;
 *   2. the refund runs — the decision is spent;
 *   3. the model call after it fails;
 *   4. marking the stored pause answered fails (a store error), so the store
 *      still says the pause is waiting;
 *   5. a redeploy changes the middleware rules, so no answer can reach the
 *      pause any more (`'chain-changed'`);
 *   6. the next message closes it, and the model is told "That call did not
 *      run" — about a refund that ran. A model that believes it may refund
 *      again.
 *
 * The law: a door that closes a pause no answer can reach records its open
 * calls as not run ONLY when no decision for that paused request can have been
 * handed over — a ledger every resume of it must spend in says so. Otherwise,
 * and whenever that cannot be read, the outcome is recorded as not known.
 * A false "unknown" is the safe direction; a false "did not run" is not.
 */

import { describe, expect, it, vi } from 'vitest';
import type { FlowchartCheckpoint } from 'footprintjs';

import {
  Agent,
  allow,
  ask,
  inMemoryDecisionLedger,
  Sequence,
  type DecisionLedger,
} from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { defineTool } from '../../src/tools/tools.js';
import { checkInApproved } from '../../src/core/checkin.js';
import { mintConsentRequest } from '../../src/core/consentRequest.js';
import { captureFindingsRequest } from '../../src/core/agent/findings/admission.js';
import {
  NOT_RUN_UNANSWERABLE,
  OUTCOME_UNKNOWN_UNANSWERABLE,
  closedConversation,
  openToolCalls,
} from '../../src/hosting/answeredPause.js';
import {
  memorySessions,
  readPausedRun,
  standingAgent,
  type PausedRun,
  type SessionLifecycle,
} from '../../src/hosting/index.js';
import type { LLMMessage, LLMProvider } from '../../src/provider-contract/types.js';
import { inProcessHost } from './testHost.js';

// ── doubles ─────────────────────────────────────────────────────────────

/** Two refunds asked in one turn; only the first has its result. */
const halfAnswered: LLMMessage[] = [
  { role: 'user', content: 'refund orders 1 and 2' },
  {
    role: 'assistant',
    content: '',
    toolCalls: [
      { id: 'a', name: 'refund', args: { order: 1 } },
      { id: 'b', name: 'refund', args: { order: 2 } },
    ],
  },
  { role: 'tool', toolCallId: 'a', toolName: 'refund', content: 'refunded 1' },
];

/** A ledger in a store every process reaches — a stand-in for a unique-key table. */
function durableLedger(): DecisionLedger & { readonly spent: Set<string> } {
  const spent = new Set<string>();
  return {
    spent,
    spend: async (id) => {
      if (spent.has(id)) return false;
      spent.add(id);
      return true;
    },
    isSpent: async (id) => spent.has(id),
  };
}

/** An agent this library built, spending in `decisionLedger` (the process's when none). */
function agentOn(decisionLedger?: DecisionLedger): Agent {
  return Agent.create({
    provider: mock({ reply: 'x' }),
    model: 'm',
    ...(decisionLedger !== undefined && { decisionLedger }),
  }).build();
}

/** A check-in pause on call 'b', its request `id` named by the state and by the question. */
function pausedOn(
  request: { readonly id: string; readonly nonce: string } | undefined,
  findings = false,
): PausedRun {
  return {
    checkpoint: {
      pausedStageId: 'tool-calls',
      sharedState: {
        pausedToolCallId: 'b',
        ...(request !== undefined && { pausedRequest: request }),
        ...(findings && { findingsServe: 'ids' }),
      },
      subflowPath: [],
    } as unknown as FlowchartCheckpoint,
    conversation: {
      version: 1,
      runId: 'r-1',
      history: halfAnswered,
      lastCompletedIteration: 1,
      originalInput: { message: 'refund orders 1 and 2' },
      checkpointedAt: 1,
    },
    pending: {
      tool: 'refund',
      ...(request !== undefined && { checkIn: { id: request.id } as never }),
    },
  };
}

/** A request this process minted, as a pause would. */
function mintedHere(): { readonly id: string; readonly nonce: string } {
  const bound = mintConsentRequest({
    gate: 'checkIn',
    tool: 'refund',
    toolCallId: 'b',
    args: { order: 2 },
  });
  if (bound === undefined) throw new Error('expected a request');
  return bound.request;
}

/** A request minted somewhere else — by a process that is gone. */
const fromElsewhere = { id: 'f'.repeat(64), nonce: '0'.repeat(32) };

const lastNotice = (history: readonly LLMMessage[]): LLMMessage | undefined =>
  history[history.length - 1];

// ── the rule, at the one owner ──────────────────────────────────────────

describe('closedConversation — "did not run" only when proven', () => {
  it('a ledger every resume spends in says the request was never spent: the call did not run', async () => {
    const ledger = durableLedger();
    const closed = await closedConversation(pausedOn(mintedHere(), true), agentOn(ledger));
    expect(lastNotice(closed.history)).toEqual({
      role: 'tool',
      toolName: 'refund',
      toolCallId: 'b',
      toolResultOrigin: 'not-entered',
      content: NOT_RUN_UNANSWERABLE,
    });
    expect(openToolCalls(closed.history)).toEqual([]);
  });

  it('the same ledger says it WAS spent: the outcome is not known', async () => {
    const ledger = durableLedger();
    const request = mintedHere();
    ledger.spent.add(request.id);
    const closed = await closedConversation(pausedOn(request, true), agentOn(ledger));
    expect(lastNotice(closed.history)).toEqual({
      role: 'tool',
      toolName: 'refund',
      toolCallId: 'b',
      toolResultOrigin: 'outcome-unknown',
      content: OUTCOME_UNKNOWN_UNANSWERABLE,
    });
  });

  it('fail closed: a ledger that cannot say — no isSpent, a throw, an answer that is not false — proves nothing', async () => {
    const request = mintedHere();
    const ledgers: DecisionLedger[] = [
      { spend: () => true },
      {
        spend: () => true,
        isSpent: () => {
          throw new Error('ledger unavailable');
        },
      },
      { spend: () => true, isSpent: async () => Promise.reject(new Error('timeout')) },
      { spend: () => true, isSpent: () => 'no' as never },
      { spend: () => true, isSpent: () => undefined as never },
    ];
    for (const ledger of ledgers) {
      const closed = await closedConversation(pausedOn(request), agentOn(ledger));
      expect(lastNotice(closed.history)?.content).toBe(OUTCOME_UNKNOWN_UNANSWERABLE);
    }
  });

  it('no runner, or one whose ledger a host cannot see (a composition), proves nothing', async () => {
    const request = mintedHere();
    for (const runner of [
      undefined,
      {},
      Sequence.create().step('a', agentOn(durableLedger())).build(),
    ]) {
      const closed = await closedConversation(pausedOn(request), runner);
      expect(lastNotice(closed.history)?.content).toBe(OUTCOME_UNKNOWN_UNANSWERABLE);
    }
  });

  it('the process ledger proves a request this process minted and never spent', async () => {
    const closed = await closedConversation(pausedOn(mintedHere()), agentOn());
    expect(lastNotice(closed.history)?.content).toBe(NOT_RUN_UNANSWERABLE);
  });

  it('the process ledger proves nothing about a request stored before this process started', async () => {
    const closed = await closedConversation(pausedOn(fromElsewhere), agentOn());
    expect(lastNotice(closed.history)?.content).toBe(OUTCOME_UNKNOWN_UNANSWERABLE);
  });

  it('an app’s own in-memory ledger proves nothing — it may be one agent’s alone, and a restart forgets it', async () => {
    const closed = await closedConversation(
      pausedOn(mintedHere()),
      agentOn(inMemoryDecisionLedger()),
    );
    expect(lastNotice(closed.history)?.content).toBe(OUTCOME_UNKNOWN_UNANSWERABLE);
  });

  it('an old stored row — a pause that names no request anywhere — reads as outcome unknown', async () => {
    const closed = await closedConversation(pausedOn(undefined), agentOn(durableLedger()));
    expect(lastNotice(closed.history)?.content).toBe(OUTCOME_UNKNOWN_UNANSWERABLE);
  });

  it('every request the pause names must be proven: the question’s and the state’s', async () => {
    const ledger = durableLedger();
    const state = mintedHere();
    const shown = mintedHere();
    ledger.spent.add(state.id);
    const paused = pausedOn(state);
    const both: PausedRun = { ...paused, pending: { tool: 'refund', checkIn: shown as never } };
    const closed = await closedConversation(both, agentOn(ledger));
    expect(lastNotice(closed.history)?.content).toBe(OUTCOME_UNKNOWN_UNANSWERABLE);
  });

  it('the assessment reader (findings admission) reads the unknown notice as unknown, the proven one as not dispatched', async () => {
    const request = mintedHere();
    const spentLedger = durableLedger();
    spentLedger.spent.add(request.id);
    for (const [ledger, execution] of [
      [durableLedger(), 'not-dispatched'],
      [spentLedger, 'unknown'],
    ] as const) {
      const closed = await closedConversation(pausedOn(request, true), agentOn(ledger));
      const seen = captureFindingsRequest(
        { messages: closed.history, model: 'm' } as never,
        closed.history,
        2,
      );
      expect(seen.results.find((row) => row.toolCallId === 'b')?.execution).toBe(execution);
    }
  });
});

// ── the reproduced sequence, on standingAgent ───────────────────────────

const usage = { input: 1, output: 1 };

/** The model: one refund for a refund request; the call after the tool fails while `failing.model`. */
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
        : {
            content: `noted: ${String(last?.content)}`,
            toolCalls: [],
            usage,
            stopReason: 'stop',
          };
    },
  };
}

/** An agent whose `approval` link asks before every refund, and `later` runs after it. */
function asking(
  later: string,
  world: {
    readonly ran: number[];
    readonly sent: (readonly LLMMessage[])[];
    readonly failing: { model: boolean };
    readonly ledger?: DecisionLedger;
  },
): Agent {
  return Agent.create({
    provider: refundsModel(world.sent, world.failing),
    model: 'test-model',
    maxIterations: 4,
    ...(world.ledger !== undefined && { decisionLedger: world.ledger }),
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

/** A session store whose writes fail while `failing.persist` is set. */
function flakyStore(failing: { persist: boolean }): SessionLifecycle {
  const inner = memorySessions();
  return new Proxy(inner, {
    get(target, key) {
      if (key === 'persist') {
        return async (...args: Parameters<SessionLifecycle['persist']>) => {
          if (failing.persist) throw new Error('store unavailable');
          return target.persist(...args);
        };
      }
      const value = Reflect.get(target, key, target) as unknown;
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

/** What the model was told for the paused call `t1`, in every request it was sent. */
const toldAbout = (sent: (readonly LLMMessage[])[]): unknown[] =>
  sent.flatMap((messages) =>
    messages.filter((m) => m.role === 'tool' && m.toolCallId === 't1').map((m) => m.content),
  );

type Event = 'approve' | 'model-failure' | 'save-failure' | 'redeploy';

/**
 * One world: pause on a refund the middleware asks about, then apply
 * `events` in order — an approval delivered to whichever host serves now, the
 * model call after the tool failing, the session store refusing writes, a
 * redeploy (a new host whose chain renamed the rule after the ask) — then
 * clear the failures and send the next message.
 */
async function play(events: readonly Event[], ledgerKind: 'process' | 'shared') {
  const world = {
    ran: [] as number[],
    sent: [] as (readonly LLMMessage[])[],
    failing: { model: false, persist: false },
    ...(ledgerKind === 'shared' && { ledger: durableLedger() }),
  };
  const sessions = flakyStore(world.failing);
  let host = inProcessHost();
  let handle = await standingAgent({ agent: asking('limit', world), sessions, host });
  const asked = await host.deliver({ input: 'refund me', sessionId: 's' });
  if (asked.awaiting?.ask === undefined) throw new Error('expected the ask to pause');
  const decision = checkInApproved({ request: asked.awaiting.ask, by: 'alice' });
  for (const event of events) {
    if (event === 'model-failure') world.failing.model = true;
    if (event === 'save-failure') world.failing.persist = true;
    if (event === 'approve') await host.deliver({ input: '', sessionId: 's', decision });
    if (event === 'redeploy') {
      await handle.close();
      host = inProcessHost();
      handle = await standingAgent({ agent: asking('limit-v2', world), sessions, host });
    }
  }
  world.failing.model = false;
  world.failing.persist = false;
  const next = await host.deliver({ input: 'is it done?', sessionId: 's' });
  await handle.close();
  return { ...world, next, sessions };
}

describe('the reproduced sequence on standingAgent — approve, spend, model failure, save failure, redeploy', () => {
  it.each(['process', 'shared'] as const)(
    'with the %s ledger: the refund ran, so the model is never told it did not run',
    async (ledgerKind) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const { ran, sent, next, sessions } = await play(
          ['model-failure', 'save-failure', 'approve', 'redeploy'],
          ledgerKind,
        );
        expect(ran).toEqual([10]);
        // The mark could not be written, so the redeployed host found the
        // pause still waiting — and closed it on the next message.
        expect(next.output).toBe('noted: is it done?');
        expect(toldAbout(sent)).not.toContain(NOT_RUN_UNANSWERABLE);
        expect(toldAbout(sent).at(-1)).toBe(OUTCOME_UNKNOWN_UNANSWERABLE);
        expect((await sessions.hydrate('s'))?.format).toBe('conversation-v1');
      } finally {
        warn.mockRestore();
      }
    },
  );

  it.each(['process', 'shared'] as const)(
    'with the %s ledger: a redeploy before any answer — nothing was spent — still says the call did not run',
    async (ledgerKind) => {
      const { ran, sent, next } = await play(['redeploy'], ledgerKind);
      expect(ran).toEqual([]);
      expect(next.output).toBe('noted: is it done?');
      expect(toldAbout(sent).at(-1)).toBe(NOT_RUN_UNANSWERABLE);
    },
  );

  it('an answer refused for the redeploy closes the pause — as unknown when an earlier resume had spent it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const { ran, sent } = await play(
        ['model-failure', 'save-failure', 'approve', 'redeploy', 'approve'],
        'process',
      );
      expect(ran).toEqual([10]);
      expect(toldAbout(sent)).not.toContain(NOT_RUN_UNANSWERABLE);
      expect(toldAbout(sent).at(-1)).toBe(OUTCOME_UNKNOWN_UNANSWERABLE);
    } finally {
      warn.mockRestore();
    }
  });

  it('an old stored row — the pause names no request — closes as outcome unknown', async () => {
    const world = {
      ran: [] as number[],
      sent: [] as (readonly LLMMessage[])[],
      failing: { model: false },
    };
    const sessions = memorySessions();
    const host = inProcessHost();
    const handle = await standingAgent({ agent: asking('limit', world), sessions, host });
    try {
      await host.deliver({ input: 'refund me', sessionId: 'old' });
      const stored = readPausedRun(await sessions.hydrate('old'));
      const { pausedRequest: _record, ...state } = stored.checkpoint.sharedState as Record<
        string,
        unknown
      >;
      void _record;
      const { id: _id, ...question } = stored.pending.ask as unknown as Record<string, unknown>;
      void _id;
      const { toPausedEnvelope } = await import('../../src/hosting/index.js');
      await sessions.persist(
        'old',
        toPausedEnvelope({
          ...stored,
          checkpoint: { ...stored.checkpoint, sharedState: state },
          pending: { ...stored.pending, ask: question as never },
        }),
      );
      const next = await host.deliver({ input: 'never mind', sessionId: 'old' });
      expect(next.output).toBe('noted: never mind');
      expect(toldAbout(world.sent).at(-1)).toBe(OUTCOME_UNKNOWN_UNANSWERABLE);
    } finally {
      await handle.close();
    }
  });
});

// ── the property: every order of the events ─────────────────────────────

/** Every order of `items`. */
function orders<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, at) =>
    orders([...items.slice(0, at), ...items.slice(at + 1)]).map((rest) => [item, ...rest]),
  );
}

describe('property — over every order of approve, model failure, save failure and redeploy, the record never says "did not run" after a spend', () => {
  // fast-check is not a dependency of this repository (see
  // test/core/agent/findings/reserved.test.ts); four events have 24 orders,
  // so every one of them is played — on both kinds of ledger — instead of a
  // sample. The spend happens where it can: an approval delivered to a host
  // whose rules still match the ask.
  const all = orders<Event>(['approve', 'model-failure', 'save-failure', 'redeploy']);

  it('plays all 24 orders', () => {
    expect(all).toHaveLength(24);
    expect(new Set(all.map((order) => order.join(' '))).size).toBe(24);
  });

  it.each(['process', 'shared'] as const)('with the %s ledger', async (ledgerKind) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      for (const order of all) {
        const { ran, sent } = await play(order, ledgerKind);
        const told = toldAbout(sent);
        if (ran.length > 0) {
          // The refund ran: no request the model was sent calls it not run.
          expect({ order, told }).not.toEqual(
            expect.objectContaining({ told: expect.arrayContaining([NOT_RUN_UNANSWERABLE]) }),
          );
        }
        // And nothing ran twice.
        expect({ order, ran: ran.length <= 1 }).toEqual({ order, ran: true });
      }
    } finally {
      warn.mockRestore();
    }
  });
});

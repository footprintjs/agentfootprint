/**
 * Input-phase message middleware on a CONTINUED turn (9.112.2).
 *
 * THE LAW: the user entry a turn adds to the conversation is the message the
 * `'input'` chain let through — on a first turn AND on a continued one
 * (`run({ continueFrom })`, `followUp()`, every stored session behind
 * `standingAgent`). One owner writes that entry: `seed.ts · historyForTurn`,
 * called after the chain has run.
 *
 * THE BUG IT PINS. Through 9.112.1, `Agent.ts · applyContinuation` pre-built the
 * continued history as `[...stored, { role: 'user', content: <RAW message> }]`
 * BEFORE seed ran the chain, and seed used that history verbatim. The run
 * committed the rewrite as `userMessage` and filed it in the ledger, while the
 * model was served the raw text — a PII scrub RAN on every continued turn and
 * its output was discarded before the wire and the stored history.
 *
 * What must NOT move: `resumeOnError` appends no user entry (the failing
 * turn's message is already the last one in its history), a continued turn
 * with no middleware carries the exact history it always did, and a first
 * turn is untouched.
 */

import { describe, expect, it } from 'vitest';

import {
  Agent,
  allow,
  deny,
  MessageDeniedError,
  type AgentRunCheckpoint,
  type MessageMiddleware,
} from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { memorySessions, standingAgent } from '../../src/hosting/index.js';
import type { LLMMessage, LLMRequest } from '../../src/adapters/types.js';
import { inProcessHost } from '../hosting/testHost.js';

// ─── Helpers ──────────────────────────────────────────────────────

/** A mock provider that records every request it is asked to answer. */
function spyProvider() {
  const requests: LLMRequest[] = [];
  const provider = mock({
    respond: (req) => {
      requests.push(req);
      return `answer-${requests.length}`;
    },
  });
  return { provider, requests };
}

/** Rewrites every input message — the shape of a "quote this line" prefix. */
const prefixInput: MessageMiddleware = {
  name: 'prefix-input',
  onMessage: (msg) =>
    msg.phase === 'input' ? allow(`PREFIX\n\n${msg.content}`, 'stated a prefix') : allow(),
};

/** Replaces any run of six or more digits — the shape of a PII scrub. */
const scrubDigits: MessageMiddleware = {
  name: 'scrub-digits',
  onMessage: (msg) => {
    if (msg.phase !== 'input') return allow();
    const clean = msg.content.replace(/\d{6,}/g, '[number]');
    return clean === msg.content ? allow() : allow(clean, 'masked an account number');
  },
};

function build(provider: ReturnType<typeof mock>, chain: readonly MessageMiddleware[] = []) {
  let builder = Agent.create({ provider, model: 'm', maxIterations: 3 }).system('sys');
  for (const link of chain) builder = builder.messageMiddleware(link);
  return builder.build();
}

/** The conversation as the model was served it: everything but the system piece. */
function conversationOf(req: LLMRequest | undefined): { role: string; content: string }[] {
  return (req?.messages ?? [])
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));
}

function lastUserContent(messages: readonly { role: string; content: string }[]) {
  return [...messages].reverse().find((m) => m.role === 'user')?.content;
}

function committedHistory(agent: Agent): readonly LLMMessage[] {
  const state = agent.getLastSnapshot()?.sharedState as { history?: readonly LLMMessage[] };
  return state?.history ?? [];
}

/** Turn 1 on `agent`, then its stored conversation. */
async function firstTurn(agent: Agent, message = 'q1'): Promise<AgentRunCheckpoint> {
  await agent.run({ message });
  const stored = agent.checkpoint();
  if (stored === undefined) throw new Error('turn 1 left no conversation');
  return stored;
}

// ─── (a) the rewrite reaches the model on a continued turn ────────

describe('input middleware on a continued turn — the rewrite is what the model reads', () => {
  it('run({ continueFrom }): the last user message on the wire is the rewrite', async () => {
    const spy = spyProvider();
    const agent = build(spy.provider, [prefixInput]);
    const stored = await firstTurn(agent);

    await agent.run({ message: 'q2', continueFrom: stored });

    expect(spy.requests).toHaveLength(2);
    const wire = conversationOf(spy.requests[1]);
    expect(lastUserContent(wire)).toBe('PREFIX\n\nq2');
    // Exactly one user entry for this turn, and no raw copy anywhere.
    expect(wire).toEqual([
      { role: 'user', content: 'PREFIX\n\nq1' },
      { role: 'assistant', content: 'answer-1' },
      { role: 'user', content: 'PREFIX\n\nq2' },
    ]);
  });

  it('followUp(): the same door, the same law', async () => {
    const spy = spyProvider();
    const agent = build(spy.provider, [prefixInput]);
    await agent.run({ message: 'q1' });

    await agent.followUp('q2');

    expect(lastUserContent(conversationOf(spy.requests[1]))).toBe('PREFIX\n\nq2');
  });

  it('standingAgent: a stored session continues with the rewrite on the wire', async () => {
    const spy = spyProvider();
    const host = inProcessHost();
    const handle = await standingAgent({
      agent: build(spy.provider, [prefixInput]),
      sessions: memorySessions(),
      host,
    });
    try {
      await host.deliver({ input: 'q1', sessionId: 's-1' });
      await host.deliver({ input: 'q2', sessionId: 's-1' });
    } finally {
      await handle.close();
    }

    expect(spy.requests).toHaveLength(2);
    expect(conversationOf(spy.requests[1])).toEqual([
      { role: 'user', content: 'PREFIX\n\nq1' },
      { role: 'assistant', content: 'answer-1' },
      { role: 'user', content: 'PREFIX\n\nq2' },
    ]);
  });

  // ─── (b) the stored conversation agrees with the record ─────────

  it('the stored history holds the rewritten turn — the same string originalInput names', async () => {
    const spy = spyProvider();
    const agent = build(spy.provider, [prefixInput]);
    const stored = await firstTurn(agent);

    await agent.run({ message: 'q2', continueFrom: stored });

    const after = agent.checkpoint()!;
    expect(after.originalInput.message).toBe('PREFIX\n\nq2');
    expect(lastUserContent(after.history)).toBe(after.originalInput.message);
    // …and the committed run state says the same thing as the wire.
    const state = agent.getLastSnapshot()?.sharedState as { userMessage: string };
    expect(lastUserContent(committedHistory(agent))).toBe(state.userMessage);
  });

  // ─── (c) a scrub's output is what leaves the turn ───────────────

  it('a redaction-style scrub applies on the continued turn — the model never sees the digits', async () => {
    const spy = spyProvider();
    const agent = build(spy.provider, [scrubDigits]);
    const stored = await firstTurn(agent, 'hello');
    const events: { type: string }[] = [];
    agent.on('*', (e) => events.push(e));

    await agent.run({ message: 'my account is 12345678', continueFrom: stored });

    expect(lastUserContent(conversationOf(spy.requests[1]))).toBe('my account is [number]');
    expect(JSON.stringify(spy.requests)).not.toContain('12345678');
    // Nor does the conversation a host would store for the next turn.
    expect(JSON.stringify(agent.checkpoint()!.history)).not.toContain('12345678');
    // Nor any event this turn emitted. `context.injected` carried the raw
    // digits through 9.112.1; it must have fired, so the check is not vacuous.
    expect({
      injectedFired: events.some((e) => e.type === 'agentfootprint.context.injected'),
      carryingDigits: events
        .filter((e) => JSON.stringify(e).includes('12345678'))
        .map((e) => e.type),
    }).toEqual({ injectedFired: true, carryingDigits: [] });
  });

  it('the scrub holds across several continued turns', async () => {
    const spy = spyProvider();
    const agent = build(spy.provider, [scrubDigits]);
    await agent.run({ message: 'card 4111111111111111' });
    await agent.followUp('and 5500005555555559');
    await agent.followUp('what did I send?');

    expect(spy.requests).toHaveLength(3);
    const everything = JSON.stringify(spy.requests);
    expect(everything).not.toContain('4111111111111111');
    expect(everything).not.toContain('5500005555555559');
    expect(conversationOf(spy.requests[2]).filter((m) => m.role === 'user')).toEqual([
      { role: 'user', content: 'card [number]' },
      { role: 'user', content: 'and [number]' },
      { role: 'user', content: 'what did I send?' },
    ]);
  });

  // ─── (d) the .act() door reaches the same continuation path ─────
  // `AgentBuilder.act` forwards `input` rules to `.messageMiddleware()`
  // (wrapped by `act.ts · onlyAt('input', …)`), so the fix — and the
  // CHANGELOG's "who is affected" — covers both spellings.

  it('.act({ input }): a scrub applies on the continued turn, the same as .messageMiddleware()', async () => {
    const spy = spyProvider();
    const agent = Agent.create({ provider: spy.provider, model: 'm', maxIterations: 3 })
      .system('sys')
      .act({ input: [scrubDigits] })
      .build();
    const stored = await firstTurn(agent, 'hello');

    await agent.run({ message: 'my account is 12345678', continueFrom: stored });
    await agent.followUp('and 5500005555555559');

    expect(spy.requests).toHaveLength(3);
    expect(lastUserContent(conversationOf(spy.requests[1]))).toBe('my account is [number]');
    expect(lastUserContent(conversationOf(spy.requests[2]))).toBe('and [number]');
    const everything = JSON.stringify(spy.requests);
    expect(everything).not.toContain('12345678');
    expect(everything).not.toContain('5500005555555559');
    expect(JSON.stringify(agent.checkpoint()!.history)).not.toContain('5500005555555559');
  });
});

// ─── A refusal on a continued turn does what it does on a first turn ─

describe('input middleware on a continued turn — a refusal', () => {
  const rewriteThenDeny: readonly MessageMiddleware[] = [
    prefixInput,
    {
      name: 'no-secrets',
      onMessage: (msg) =>
        msg.phase === 'input' && msg.content.includes('secret')
          ? deny('contains a secret')
          : allow(),
    },
  ];

  it('raises MessageDeniedError, never calls the model, and commits the refused content the way a first turn does', async () => {
    // First turn, refused: the committed user entry is the content as it
    // stood when the chain refused it.
    const firstSpy = spyProvider();
    const fresh = build(firstSpy.provider, rewriteThenDeny);
    await expect(fresh.run({ message: 'a secret' })).rejects.toThrow(MessageDeniedError);
    expect(firstSpy.requests).toHaveLength(0);
    const firstTurnEntry = committedHistory(fresh).at(-1);

    // Continued turn, refused: the same entry, after the stored conversation.
    const spy = spyProvider();
    const agent = build(spy.provider, rewriteThenDeny);
    const stored = await firstTurn(agent);
    await expect(agent.run({ message: 'a secret', continueFrom: stored })).rejects.toThrow(
      MessageDeniedError,
    );
    expect(spy.requests).toHaveLength(1);
    expect(firstTurnEntry).toEqual({ role: 'user', content: 'PREFIX\n\na secret' });
    expect(committedHistory(agent)).toEqual([...stored.history, firstTurnEntry]);
  });
});

// ─── What must not move ───────────────────────────────────────────

describe('continuation paths that must not move', () => {
  // ─── (d) resumeOnError appends no user entry ───────────────────
  it('resumeOnError appends no user entry, middleware or not', async () => {
    const spy = spyProvider();
    const agent = build(spy.provider, [prefixInput]);
    const stored = await firstTurn(agent);
    const failed: AgentRunCheckpoint = {
      ...stored,
      history: [...stored.history, { role: 'user', content: 'q2' }],
      originalInput: { message: 'q2' },
    };

    await agent.resumeOnError(failed);

    // The model is served the stored history exactly — no second copy of the
    // failing turn's message, rewritten or raw.
    expect(conversationOf(spy.requests[1])).toEqual(
      failed.history.map((m) => ({ role: m.role, content: m.content })),
    );
    expect(committedHistory(agent)).toEqual(failed.history);
  });

  // ─── (e) no middleware: the history a continued turn always carried ─
  it('with no middleware, a continued turn carries exactly [...stored, { user: message }]', async () => {
    const spy = spyProvider();
    const agent = build(spy.provider);
    const stored = await firstTurn(agent);

    await agent.run({ message: 'q2', continueFrom: stored });

    const expected = [...stored.history, { role: 'user', content: 'q2' }];
    expect(committedHistory(agent)).toEqual(expected);
    // Byte for byte: no key added to the entry, none reordered.
    expect(JSON.stringify(committedHistory(agent))).toBe(JSON.stringify(expected));
    expect(conversationOf(spy.requests[1])).toEqual([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'answer-1' },
      { role: 'user', content: 'q2' },
    ]);
  });

  // ─── (f) a first turn is unchanged ─────────────────────────────
  it('a first turn seeds one user entry — the rewrite with middleware, the message without', async () => {
    const withChain = spyProvider();
    const rewritten = build(withChain.provider, [prefixInput]);
    await rewritten.run({ message: 'q1' });
    expect(committedHistory(rewritten)).toEqual([{ role: 'user', content: 'PREFIX\n\nq1' }]);
    expect(conversationOf(withChain.requests[0])).toEqual([
      { role: 'user', content: 'PREFIX\n\nq1' },
    ]);

    const plain = spyProvider();
    const untouched = build(plain.provider);
    await untouched.run({ message: 'q1' });
    expect(committedHistory(untouched)).toEqual([{ role: 'user', content: 'q1' }]);
  });

  it('a fresh run after a continued one starts a new conversation — the flag does not linger', async () => {
    const spy = spyProvider();
    const agent = build(spy.provider, [prefixInput]);
    const stored = await firstTurn(agent);
    await agent.run({ message: 'q2', continueFrom: stored });

    await agent.run({ message: 'q3' });

    expect(conversationOf(spy.requests[2])).toEqual([{ role: 'user', content: 'PREFIX\n\nq3' }]);
  });
});

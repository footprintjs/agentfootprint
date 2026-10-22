/**
 * Security — a person's decision answers ONE paused request, once, for the
 * exact call it was asked about.
 *
 * A consent gate (a tool's `checkIn`, a middleware's `ask`) pauses the run and
 * mints a request id. `checkInApproved({ request, by })` names that id. On
 * resume the decision is refused, before anything runs, when it:
 *   - names no request (an old-format or hand-built decision);
 *   - names a different request (another run's, an earlier pause's, a
 *     parallel sibling's);
 *   - names this request but the paused call changed since it was asked (the
 *     checkpoint's arguments, tool, call or middleware position were altered);
 *   - names a request that was already answered (a replay).
 *
 * The tool never runs on a refusal (fail closed), and the refusal is a typed
 * `ResumeDecisionError` whose `reason` says which of the four it was.
 */

import { describe, expect, it, vi } from 'vitest';
import { Agent } from '../../../src/core/Agent.js';
import { defineTool } from '../../../src/tools/tools.js';
import {
  allow,
  ask,
  checkInApproved,
  checkInDeclined,
  deny,
  inMemoryDecisionLedger,
  isAskPause,
  isCheckInPause,
  isPaused,
  Parallel,
  ResumeIdentityConflictError,
  Sequence,
  type RunnerPauseOutcome,
} from '../../../src/index.js';
import type { LLMProvider, LLMResponse } from '../../../src/provider-contract/types.js';

// ── doubles ─────────────────────────────────────────────────────────────

function resp(
  content: string,
  toolCalls: readonly { id: string; name: string; args: Record<string, unknown> }[] = [],
): LLMResponse {
  return {
    content,
    toolCalls,
    usage: { input: 1, output: 1 },
    stopReason: toolCalls.length > 0 ? 'tool_use' : 'stop',
  };
}

/**
 * Asks for one refund per amount, in order, one call per turn — the amount
 * read from the person's message (`refund 500 900` asks for 500, then 900).
 * Every call carries the SAME tool call id, as a provider that numbers its
 * calls per response does: an id the model chose is never what makes two
 * requests different.
 */
function refunds(): LLMProvider {
  return {
    name: 'mock',
    complete: async (req) => {
      const said = String(req.messages.find((m) => m.role === 'user')?.content ?? '');
      const amounts = (said.match(/\d+/g) ?? []).map(Number);
      const answered = req.messages.filter((m) => m.role === 'tool').length;
      return answered < amounts.length
        ? resp('', [{ id: 't1', name: 'issue_refund', args: { amount: amounts[answered]! } }])
        : resp(`done after ${answered}`);
    },
  };
}

function refundTool(exec: (args: { amount: number }) => string, checkIn = true) {
  return defineTool<{ amount: number }, string>({
    name: 'issue_refund',
    description: 'Issue a refund to the customer',
    inputSchema: {
      type: 'object',
      properties: { amount: { type: 'number' } },
      required: ['amount'],
    },
    ...(checkIn && { checkIn: 'always' as const }),
    execute: exec,
  });
}

function gatedAgent(exec: (args: { amount: number }) => string) {
  return Agent.create({ provider: refunds(), model: 'mock' })
    .system('You issue refunds.')
    .tool(refundTool(exec))
    .build();
}

type CheckInPause = RunnerPauseOutcome & { checkIn: NonNullable<RunnerPauseOutcome['checkIn']> };
type AskPause = RunnerPauseOutcome & { ask: NonNullable<RunnerPauseOutcome['ask']> };

function asCheckIn(out: unknown): CheckInPause {
  expect(isCheckInPause(out)).toBe(true);
  return out as CheckInPause;
}

function asAsk(out: unknown): AskPause {
  expect(isAskPause(out)).toBe(true);
  return out as AskPause;
}

const refusal = (reason: string) => ({ code: 'ERR_RESUME_DECISION', reason });

// ── (a) a decision answers the request it names, and no other ───────────

describe('decision binding — a decision for request A never answers request B', () => {
  it('refuses a decision for one run’s pause on another run’s pause, and runs nothing', async () => {
    // Two conversations (two agents built alike), each paused on the same
    // tool with the same tool call id ('t1').
    const exec = vi.fn(({ amount }: { amount: number }) => `refunded ${amount}`);
    const forSmall = gatedAgent(exec);
    const forLarge = gatedAgent(exec);
    const a = asCheckIn(await forSmall.run({ message: 'refund 5' }));
    const b = asCheckIn(await forLarge.run({ message: 'refund 9000' }));

    const forA = checkInApproved({ request: a.checkIn, by: 'maya' });
    await expect(forLarge.resume(b.checkpoint, forA)).rejects.toMatchObject(
      refusal('other-request'),
    );
    expect(exec).not.toHaveBeenCalled();
    // Only the request ids tell the two apart.
    expect(a.checkIn.id).not.toBe(b.checkIn.id);

    // B is still answerable with ITS decision — the refusal changed nothing.
    const out = await forLarge.resume(
      b.checkpoint,
      checkInApproved({ request: b.checkIn, by: 'maya' }),
    );
    expect(out).toBe('done after 1');
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith({ amount: 9000 }, expect.anything());
  });

  it('refuses a duplicate of an earlier answer on the pause the run reached next', async () => {
    // The double click: the first "approve" resumes the run, which pauses on
    // the NEXT refund; the second, identical "approve" must not answer it.
    const ran: number[] = [];
    const exec = vi.fn(({ amount }: { amount: number }) => {
      ran.push(amount);
      return `refunded ${amount}`;
    });
    const agent = gatedAgent(exec);
    const first = asCheckIn(await agent.run({ message: 'refund 5 9000' }));
    const approveFirst = checkInApproved({ request: first.checkIn, by: 'maya' });
    const second = asCheckIn(await agent.resume(first.checkpoint, approveFirst));
    expect(second.checkIn.args).toEqual({ amount: 9000 });

    await expect(agent.resume(second.checkpoint, approveFirst)).rejects.toMatchObject(
      refusal('other-request'),
    );
    // Read at call time: only the approved refund ran.
    expect(ran).toEqual([5]);
  });

  it('refuses a decline for another request too — a record names only what was asked', async () => {
    const exec = vi.fn(() => 'refunded');
    const first = gatedAgent(exec);
    const second = gatedAgent(exec);
    const a = asCheckIn(await first.run({ message: 'refund 5' }));
    const b = asCheckIn(await second.run({ message: 'refund 9' }));
    const declineA = checkInDeclined({ request: a.checkIn, by: 'maya', note: 'no' });
    await expect(second.resume(b.checkpoint, declineA)).rejects.toMatchObject(
      refusal('other-request'),
    );
  });
});

describe('decision binding — who may answer is asked before what the answer names', () => {
  it('a caller whose identity is refused learns nothing about the paused request', async () => {
    const exec = vi.fn(() => 'refunded');
    const agent = gatedAgent(exec);
    const maya = { principal: 'maya', conversationId: 'c-maya' };
    const eve = { principal: 'eve', conversationId: 'c-maya' };
    const paused = asCheckIn(await agent.run({ message: 'refund 5', identity: maya }));
    const elsewhere = asCheckIn(await gatedAgent(exec).run({ message: 'refund 9' }));
    // Each of these would be refused for what it names — a decision for
    // another request, an old-format decision, a value — but the caller is
    // not the paused run's, so the refusal says that and nothing about the
    // request, its gate or its tool.
    for (const input of [
      checkInApproved({ request: elsewhere.checkIn, by: 'eve' }),
      { approved: true, by: 'eve', at: 1 },
      'yes',
    ]) {
      await expect(
        agent.resume(paused.checkpoint, input, { identity: eve }),
      ).rejects.toBeInstanceOf(ResumeIdentityConflictError);
    }
    expect(exec).not.toHaveBeenCalled();
    // The paused run's own caller is still answered as asked.
    await agent.resume(
      paused.checkpoint,
      checkInApproved({ request: paused.checkIn, by: 'maya' }),
      { identity: maya },
    );
    expect(exec).toHaveBeenCalledTimes(1);
  });
});

// ── (b) one decision runs one call ──────────────────────────────────────

describe('decision binding — one decision is used once', () => {
  it('refuses the same decision on the same checkpoint a second time', async () => {
    const exec = vi.fn(({ amount }: { amount: number }) => `refunded ${amount}`);
    const agent = gatedAgent(exec);
    const paused = asCheckIn(await agent.run({ message: 'refund 500' }));
    const decision = checkInApproved({ request: paused.checkIn, by: 'maya' });

    expect(await agent.resume(paused.checkpoint, decision)).toBe('done after 1');
    await expect(agent.resume(paused.checkpoint, decision)).rejects.toMatchObject(
      refusal('already-answered'),
    );
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('a decline is an answer too: an approval replayed after it is refused', async () => {
    const exec = vi.fn(() => 'refunded');
    const agent = gatedAgent(exec);
    const paused = asCheckIn(await agent.run({ message: 'refund 500' }));
    await agent.resume(paused.checkpoint, checkInDeclined({ request: paused.checkIn, by: 'maya' }));
    await expect(
      agent.resume(paused.checkpoint, checkInApproved({ request: paused.checkIn, by: 'mallory' })),
    ).rejects.toMatchObject(refusal('already-answered'));
    expect(exec).not.toHaveBeenCalled();
  });
});

// ── (c) the decision binds to the exact call that was asked about ───────

describe('decision binding — an approval binds to the exact paused call', () => {
  it('refuses when the checkpoint’s arguments changed after the person was asked', async () => {
    const exec = vi.fn(({ amount }: { amount: number }) => `refunded ${amount}`);
    const agent = gatedAgent(exec);
    const paused = asCheckIn(await agent.run({ message: 'refund 50' }));
    const decision = checkInApproved({ request: paused.checkIn, by: 'maya' });

    const altered = structuredClone(paused.checkpoint);
    (altered.sharedState as Record<string, unknown>).pausedCheckInArgs = { amount: 50_000 };
    await expect(agent.resume(altered, decision)).rejects.toMatchObject(refusal('call-changed'));
    expect(exec).not.toHaveBeenCalled();
  });

  it('refuses when the checkpoint names a different tool than the one asked about', async () => {
    const exec = vi.fn(() => 'refunded');
    const agent = gatedAgent(exec);
    const paused = asCheckIn(await agent.run({ message: 'refund 50' }));
    const altered = structuredClone(paused.checkpoint);
    (altered.sharedState as Record<string, unknown>).pausedToolName = 'delete_account';
    await expect(
      agent.resume(altered, checkInApproved({ request: paused.checkIn, by: 'maya' })),
    ).rejects.toMatchObject(refusal('call-changed'));
  });
});

// ── an old-format decision ──────────────────────────────────────────────

describe('decision binding — a decision that names no request', () => {
  it('refuses an old-format decision ({ approved, by, at }) and runs nothing', async () => {
    const exec = vi.fn(() => 'refunded');
    const agent = gatedAgent(exec);
    const paused = asCheckIn(await agent.run({ message: 'refund 500' }));
    const oldFormat = { approved: true, by: 'maya', at: Date.now() };
    await expect(agent.resume(paused.checkpoint, oldFormat)).rejects.toMatchObject(
      refusal('no-request'),
    );
    expect(exec).not.toHaveBeenCalled();
    // And the checkpoint is still good for a decision that names its request.
    await agent.resume(paused.checkpoint, checkInApproved({ request: paused.checkIn, by: 'maya' }));
    expect(exec).toHaveBeenCalledTimes(1);
  });
});

// ── a middleware's ask is bound the same way ────────────────────────────

describe('decision binding — a toolMiddleware ask', () => {
  function askingAgent(exec: (args: { amount: number }) => string) {
    return Agent.create({ provider: refunds(), model: 'mock' })
      .system('You issue refunds.')
      .tool(refundTool(exec, false))
      .toolMiddleware(
        { name: 'approval', onToolCall: () => ask({ question: 'Issue this refund?' }) },
        {
          name: 'limit',
          onToolCall: (call) =>
            (call.args as { amount: number }).amount > 1000 ? deny('over the limit') : allow(),
        },
      )
      .build();
  }

  it('refuses an approval of one ask on another ask', async () => {
    const exec = vi.fn(() => 'refunded');
    const first = askingAgent(exec);
    const second = askingAgent(exec);
    const a = asAsk(await first.run({ message: 'refund 5' }));
    const b = asAsk(await second.run({ message: 'refund 7' }));
    await expect(
      second.resume(b.checkpoint, checkInApproved({ request: a.ask, by: 'maya' })),
    ).rejects.toMatchObject(refusal('other-request'));
    expect(exec).not.toHaveBeenCalled();
  });

  it('refuses when the checkpoint moved where the chain resumes (skipping a later rule)', async () => {
    const exec = vi.fn(() => 'refunded');
    const agent = askingAgent(exec);
    const paused = asAsk(await agent.run({ message: 'refund 5000' }));
    const decision = checkInApproved({ request: paused.ask, by: 'maya' });
    // Resuming past 'limit' would run a 5000 refund the chain denies.
    const altered = structuredClone(paused.checkpoint);
    (altered.sharedState as Record<string, unknown>).pausedAskIndex = 5;
    await expect(agent.resume(altered, decision)).rejects.toMatchObject(refusal('call-changed'));
    expect(exec).not.toHaveBeenCalled();
  });

  it('runs the rest of the chain on an approval of its own ask', async () => {
    const exec = vi.fn(() => 'refunded');
    const agent = askingAgent(exec);
    const paused = asAsk(await agent.run({ message: 'refund 5' }));
    expect(typeof paused.ask.id).toBe('string');
    await agent.resume(paused.checkpoint, checkInApproved({ request: paused.ask, by: 'maya' }));
    expect(exec).toHaveBeenCalledTimes(1);
  });
});

// ── compositions: nested agents and parallel siblings ───────────────────

describe('decision binding — inside compositions', () => {
  it('a parallel sibling’s decision does not answer the other sibling', async () => {
    const one = vi.fn(() => 'refunded one');
    const two = vi.fn(() => 'refunded two');
    const par = Parallel.create()
      .branch('one', gatedAgent(one))
      .branch('two', gatedAgent(two))
      .mergeWithFn((results) => JSON.stringify(results))
      .build();

    const first = asCheckIn(await par.run({ message: 'refund 3' }));
    const forFirst = checkInApproved({ request: first.checkIn, by: 'maya' });
    const second = asCheckIn(await par.resume(first.checkpoint, forFirst));

    // The first sibling's approval, presented to the second sibling's pause.
    await expect(par.resume(second.checkpoint, forFirst)).rejects.toMatchObject(
      refusal('other-request'),
    );
    expect(one.mock.calls.length + two.mock.calls.length).toBe(1);
    expect(second.checkIn.id).not.toBe(first.checkIn.id);

    const done = await par.resume(
      second.checkpoint,
      checkInApproved({ request: second.checkIn, by: 'maya' }),
    );
    expect(isPaused(done)).toBe(false);
    expect(one).toHaveBeenCalledTimes(1);
    expect(two).toHaveBeenCalledTimes(1);
  });

  it('a nested agent refuses an altered call and a replay through the composition’s resume', async () => {
    const exec = vi.fn(({ amount }: { amount: number }) => `refunded ${amount}`);
    const seq = Sequence.create().step('refunds', gatedAgent(exec)).build();
    const paused = asCheckIn(await seq.run({ message: 'refund 40' }));
    const decision = checkInApproved({ request: paused.checkIn, by: 'maya' });

    // The paused call lives in the step's own state, not the root's.
    const altered = structuredClone(paused.checkpoint);
    const [step] = paused.checkpoint.subflowPath;
    (altered.subflowStates[step!] as Record<string, unknown>).pausedCheckInArgs = {
      amount: 40_000,
    };
    await expect(seq.resume(altered, decision)).rejects.toMatchObject(refusal('call-changed'));
    expect(exec).not.toHaveBeenCalled();

    await seq.resume(paused.checkpoint, decision);
    expect(exec).toHaveBeenCalledTimes(1);
    await expect(seq.resume(paused.checkpoint, decision)).rejects.toMatchObject(
      refusal('already-answered'),
    );
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('a nested agent refuses a decision that names no request', async () => {
    const exec = vi.fn(() => 'refunded');
    const seq = Sequence.create().step('refunds', gatedAgent(exec)).build();
    const paused = asCheckIn(await seq.run({ message: 'refund 40' }));
    await expect(
      seq.resume(paused.checkpoint, { approved: true, by: 'maya', at: 1 }),
    ).rejects.toMatchObject(refusal('no-request'));
    expect(exec).not.toHaveBeenCalled();
  });
});

// ── the record, the ledger, and what a refusal leaves behind ────────────

describe('decision binding — the record and the ledger', () => {
  it('the record joins each decision to the one request it answered', async () => {
    const agent = gatedAgent(() => 'refunded');
    const asked: unknown[] = [];
    const decided: { requestId?: unknown }[] = [];
    agent.on('agentfootprint.checkin.request', (e) => asked.push(e.payload.request));
    agent.on('agentfootprint.checkin.decision', (e) => decided.push(e.payload));
    const paused = asCheckIn(await agent.run({ message: 'refund 5' }));
    await agent.resume(paused.checkpoint, checkInApproved({ request: paused.checkIn, by: 'maya' }));
    expect(asked).toEqual([expect.objectContaining({ id: paused.checkIn.id })]);
    expect(decided).toEqual([expect.objectContaining({ requestId: paused.checkIn.id })]);
  });

  it('one shared ledger refuses a replay on a FRESH agent — another process, the same decision', async () => {
    const exec = vi.fn(() => 'refunded');
    const decisionLedger = inMemoryDecisionLedger();
    const build = () =>
      Agent.create({ provider: refunds(), model: 'mock', decisionLedger })
        .system('You issue refunds.')
        .tool(refundTool(exec))
        .build();
    const paused = asCheckIn(await build().run({ message: 'refund 500' }));
    const stored = JSON.parse(JSON.stringify(paused.checkpoint));
    const decision = checkInApproved({ request: paused.checkIn, by: 'maya' });
    await build().resume(stored, decision);
    await expect(build().resume(stored, decision)).rejects.toMatchObject(
      refusal('already-answered'),
    );
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('without a shared ledger, each agent keeps its own — the limit a host closes with one', async () => {
    const exec = vi.fn(() => 'refunded');
    const paused = asCheckIn(await gatedAgent(exec).run({ message: 'refund 500' }));
    const decision = checkInApproved({ request: paused.checkIn, by: 'maya' });
    await gatedAgent(exec).resume(paused.checkpoint, decision);
    await gatedAgent(exec).resume(paused.checkpoint, decision);
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it('refuses a ledger that cannot spend, at build', () => {
    expect(() =>
      Agent.create({ provider: refunds(), model: 'mock', decisionLedger: {} as never })
        .system('s')
        .build(),
    ).toThrow(/decisionLedger/);
  });

  it('a replay refused inside the run leaves the agent waiting on its own open question', async () => {
    const agent = gatedAgent(() => 'refunded');
    const first = asCheckIn(await agent.run({ message: 'refund 5 9000' }));
    const approveFirst = checkInApproved({ request: first.checkIn, by: 'maya' });
    asCheckIn(await agent.resume(first.checkpoint, approveFirst)); // now paused on 9000
    await expect(agent.resume(first.checkpoint, approveFirst)).rejects.toMatchObject(
      refusal('already-answered'),
    );
    // The 9000 refund is still asked: a new message is refused, not silently run.
    await expect(agent.run({ message: 'never mind' })).rejects.toMatchObject({
      name: 'PendingQuestionError',
    });
  });
});

describe('decision binding — a call that cannot be bound is refused, never asked', () => {
  it('a gated call whose arguments are not plain JSON does not pause and does not run', async () => {
    const exec = vi.fn(() => 'refunded');
    const results: string[] = [];
    const agent = Agent.create({ provider: refunds(), model: 'mock' })
      .system('You issue refunds.')
      .tool(refundTool(exec))
      .toolMiddleware({
        name: 'stamp',
        // A rewrite that puts a Date into the arguments the person would approve.
        onToolCall: (call) => allow({ ...call.args, at: new Date(0) }, 'stamped'),
      })
      .build();
    agent.on('agentfootprint.stream.tool_end', (e) => results.push(String(e.payload.result)));
    const out = await agent.run({ message: 'refund 5' });
    expect(isPaused(out)).toBe(false);
    expect(exec).not.toHaveBeenCalled();
    expect(results[0]).toContain('was not run on that call');
    expect(results[0]).toContain('plain JSON');
  });
});

describe('decision binding — a checkpoint whose record of the ask was altered', () => {
  it("refuses every decision when the pause's request record is gone: 'request-not-recorded'", async () => {
    const exec = vi.fn(() => 'refunded');
    const agent = gatedAgent(exec);
    const paused = asCheckIn(await agent.run({ message: 'refund 5' }));
    const altered = structuredClone(paused.checkpoint);
    delete (altered.sharedState as Record<string, unknown>).pausedRequest;
    await expect(
      agent.resume(altered, checkInApproved({ request: paused.checkIn, by: 'maya' })),
    ).rejects.toMatchObject(refusal('request-not-recorded'));
    expect(exec).not.toHaveBeenCalled();
  });

  it('the run still refuses when the pause payload no longer shows the gate — the state decides', async () => {
    const exec = vi.fn(() => 'refunded');
    const agent = gatedAgent(exec);
    const paused = asCheckIn(await agent.run({ message: 'refund 5' }));
    // The early check reads the payload; the dispatch loop reads the state.
    const altered = { ...structuredClone(paused.checkpoint), pauseData: { toolCallId: 't1' } };
    await expect(agent.resume(altered, 'yes')).rejects.toMatchObject({
      name: 'DecisionRequiredError',
    });
    const other = asCheckIn(await gatedAgent(exec).run({ message: 'refund 9' }));
    await expect(
      agent.resume(altered, checkInApproved({ request: other.checkIn, by: 'maya' })),
    ).rejects.toMatchObject(refusal('other-request'));
    expect(exec).not.toHaveBeenCalled();
  });
});

/**
 * Check in with the receipts — behavioral suite for the evidence-carrying
 * human-consent primitive (7-pattern coverage).
 *
 * A tool declares `checkIn` ('always' | predicate). When it trips, the
 * tool-dispatch loop pauses BEFORE execute — AFTER the permission gate +
 * arg-validation, BEFORE credential resolution — and surfaces a
 * `CheckInRequest` carrying an evidence pack. A human answers with
 * `checkInApproved` / `checkInDeclined`; on approve the tool executes, on
 * decline the model sees a `declined by human` result. Typed
 * `checkin.request` / `checkin.decision` events + a `CheckInRecorder` capture
 * the audit trail. Tools WITHOUT `checkIn` are byte-identical.
 */

import { describe, it, expect, vi } from 'vitest';
import { Agent } from '../../../src/core/Agent.js';
import { defineTool } from '../../../src/core/tools.js';
import {
  checkInApproved,
  checkInDeclined,
  isPaused,
  isCheckInPause,
  CheckInRecorder,
  lexicalDriverScorer,
  type RunnerPauseOutcome,
  type CheckInScorer,
} from '../../../src/index.js';
import type {
  LLMProvider,
  LLMResponse,
  PermissionChecker,
  PermissionDecision,
  PermissionRequest,
} from '../../../src/adapters/types.js';
import type {
  CredentialProvider,
  CredentialRequest,
  CredentialResult,
} from '../../../src/identity/types.js';

// ── Test doubles ────────────────────────────────────────────────────────

function scripted(...r: LLMResponse[]): LLMProvider {
  let i = 0;
  return { name: 'mock', complete: async () => r[Math.min(i++, r.length - 1)] };
}

function resp(
  content: string,
  toolCalls: readonly { id: string; name: string; args: Record<string, unknown> }[] = [],
): LLMResponse {
  return {
    content,
    toolCalls,
    usage: { input: 100, output: 50 },
    stopReason: toolCalls.length ? 'tool_use' : 'stop',
  };
}

/** Message-aware provider: asks for the refund tool, then returns `finalText`
 *  once a tool result appears — deterministic across FRESH-agent resume. */
function refundThenFinal(finalText: string, amount = 500): LLMProvider {
  return {
    name: 'mock',
    complete: async (req) => {
      const hadToolResult = req.messages.some((m) => m.role === 'tool');
      return hadToolResult
        ? resp(finalText)
        : resp('', [{ id: 't1', name: 'issue_refund', args: { amount } }]);
    },
  };
}

function refundTool(
  checkIn: 'always' | ((args: Record<string, unknown>) => boolean),
  execute: (args: { amount: number }) => string = ({ amount }) => `refunded ${amount}`,
) {
  return defineTool<{ amount: number }, string>({
    name: 'issue_refund',
    description: 'Issue a refund to the customer',
    inputSchema: { type: 'object', properties: { amount: { type: 'number' } }, required: ['amount'] },
    checkIn,
    execute,
  });
}

// ── 1. Declarative trip — 'always' + predicate ──────────────────────────

describe('check-in — declarative trip', () => {
  it("'always' pauses BEFORE execute and surfaces the typed request", async () => {
    const exec = vi.fn(({ amount }: { amount: number }) => `refunded ${amount}`);
    const agent = Agent.create({
      provider: scripted(resp('', [{ id: 't1', name: 'issue_refund', args: { amount: 500 } }]), resp('done')),
      model: 'mock',
    })
      .system('You are a refunds assistant.')
      .tool(refundTool('always', exec))
      .build();

    const out = await agent.run({ message: 'refund order 123' });
    expect(isPaused(out)).toBe(true);
    expect(isCheckInPause(out)).toBe(true);
    const paused = out as RunnerPauseOutcome & { checkIn: NonNullable<RunnerPauseOutcome['checkIn']> };
    expect(paused.checkIn.tool).toBe('issue_refund');
    expect(paused.checkIn.args).toEqual({ amount: 500 });
    expect(paused.checkIn.evidence.willDo).toContain('Issue a refund');
    // The whole point: consent BEFORE execute.
    expect(exec).not.toHaveBeenCalled();
  });

  it('predicate trips selectively — big refund asks, small refund runs', async () => {
    const build = (amount: number, exec: () => string) =>
      Agent.create({
        provider: scripted(resp('', [{ id: 't1', name: 'issue_refund', args: { amount } }]), resp('done')),
        model: 'mock',
      })
        .system('refunds')
        .tool(refundTool((a) => (a.amount as number) > 1000, exec as never))
        .build();

    // small — under threshold → executes, no pause
    const smallExec = vi.fn(() => 'refunded 500');
    const small = await build(500, smallExec).run({ message: 'refund' });
    expect(isCheckInPause(small)).toBe(false);
    expect(small).toBe('done');
    expect(smallExec).toHaveBeenCalledTimes(1);

    // big — over threshold → pauses
    const bigExec = vi.fn(() => 'refunded 5000');
    const big = await build(5000, bigExec).run({ message: 'refund' });
    expect(isCheckInPause(big)).toBe(true);
    expect(bigExec).not.toHaveBeenCalled();
  });

  it('a tool WITHOUT checkIn never pauses (feature is opt-in per tool)', async () => {
    const exec = vi.fn(() => 'ok');
    const agent = Agent.create({
      provider: scripted(resp('', [{ id: 't1', name: 'plain', args: {} }]), resp('done')),
      model: 'mock',
    })
      .system('')
      .tool(defineTool({ name: 'plain', description: 'no check-in', execute: exec }))
      .build();
    const out = await agent.run({ message: 'go' });
    expect(isCheckInPause(out)).toBe(false);
    expect(out).toBe('done');
    expect(exec).toHaveBeenCalledTimes(1);
  });
});

// ── 2. Gate ORDER proof ─────────────────────────────────────────────────

describe('check-in — gate order', () => {
  it('permission REJECTS before check-in ASKS (denied call never asks a human)', async () => {
    const exec = vi.fn(() => 'refunded');
    const denyRefund: PermissionChecker = {
      name: 'deny-refunds',
      check: async (req: PermissionRequest): Promise<PermissionDecision> =>
        req.target === 'issue_refund'
          ? { result: 'deny', rationale: 'refunds-forbidden' }
          : { result: 'allow' },
    };
    const agent = Agent.create({
      provider: scripted(resp('', [{ id: 't1', name: 'issue_refund', args: { amount: 500 } }]), resp('done')),
      model: 'mock',
      permissionChecker: denyRefund,
    })
      .system('')
      .tool(refundTool('always', exec as never))
      .build();

    const permChecks: unknown[] = [];
    let checkInAsks = 0;
    agent.on('agentfootprint.permission.check', (e) => permChecks.push(e.payload));
    agent.on('agentfootprint.checkin.request', () => checkInAsks++);

    const out = await agent.run({ message: 'refund' });
    // Permission denied → the run does NOT pause; the model sees the denial.
    expect(isCheckInPause(out)).toBe(false);
    expect(permChecks).toHaveLength(1);
    expect((permChecks[0] as { result: string }).result).toBe('deny');
    // The check-in gate is AFTER permission — a denied call never asks.
    expect(checkInAsks).toBe(0);
    expect(exec).not.toHaveBeenCalled();
  });

  it('check-in ASKS before credentials RESOLVE (no creds acquired for a call awaiting consent)', async () => {
    const getCredential = vi.fn(
      async (_req: CredentialRequest): Promise<CredentialResult> => ({
        status: 'issued',
        credential: { kind: 'bearer', toHeaders: () => ({ authorization: 'Bearer x' }) },
      }),
    );
    const credentials: CredentialProvider = { name: 'spy', getCredential };

    const tool = defineTool<{ amount: number }, string>({
      name: 'issue_refund',
      description: 'Issue a refund',
      inputSchema: { type: 'object', properties: { amount: { type: 'number' } } },
      needs: { credential: 'stripe' },
      checkIn: 'always',
      execute: () => 'refunded',
    });
    const buildAgent = () =>
      Agent.create({ provider: refundThenFinal('done'), model: 'mock', credentials })
        .system('')
        .tool(tool)
        .build();

    const agent = buildAgent();
    const out = await agent.run({ message: 'refund' });
    expect(isCheckInPause(out)).toBe(true);
    // The proof: at pause time NO credential was resolved — the check-in gate
    // sits BEFORE credential resolution, so consent gates the whole thing.
    expect(getCredential).not.toHaveBeenCalled();

    // On approve (fresh agent, cross-process resume), the credential resolves
    // and the tool runs — the resolution happens only AFTER the human said yes.
    const agent2 = buildAgent();
    const checkpoint = JSON.parse(JSON.stringify((out as RunnerPauseOutcome).checkpoint));
    const final = await agent2.resume(checkpoint, checkInApproved({ by: 'alice' }));
    expect(final).toBe('done');
    expect(getCredential).toHaveBeenCalledTimes(1);
  });
});

// ── 3. Pause / checkpoint / resume — JSON round-trip, pack survives ──────

describe('check-in — pause/resume round-trip', () => {
  it('the evidence pack survives structuredClone + JSON', async () => {
    const agent = Agent.create({
      provider: scripted(resp('reasoning here', [{ id: 't1', name: 'issue_refund', args: { amount: 500 } }]), resp('done')),
      model: 'mock',
    })
      .system('Always confirm refunds with the customer.')
      .tool(refundTool('always'))
      .checkIn({ evidence: 'standard' })
      .build();

    const out = (await agent.run({ message: 'refund order 42' })) as RunnerPauseOutcome & {
      checkIn: NonNullable<RunnerPauseOutcome['checkIn']>;
    };
    expect(isCheckInPause(out)).toBe(true);

    // structuredClone-safe (checkpoint discipline).
    expect(() => structuredClone(out.checkIn)).not.toThrow();
    // JSON round-trip is lossless.
    const roundTripped = JSON.parse(JSON.stringify(out.checkIn));
    expect(roundTripped).toEqual(out.checkIn);
    // And so is the whole checkpoint.
    expect(() => JSON.parse(JSON.stringify(out.checkpoint))).not.toThrow();
  });

  it('resume from a JSON checkpoint on a FRESH agent finishes the run', async () => {
    const build = () =>
      Agent.create({ provider: refundThenFinal('done'), model: 'mock' })
        .system('refunds')
        .tool(refundTool('always'))
        .build();

    const out = (await build().run({ message: 'refund' })) as RunnerPauseOutcome;
    const checkpoint = JSON.parse(JSON.stringify(out.checkpoint));
    const final = await build().resume(checkpoint, checkInApproved({ by: 'ops' }));
    expect(final).toBe('done');
  });
});

// ── 4. Approve → executes / Decline → model-visible + recorded ──────────

describe('check-in — decision', () => {
  it('APPROVE executes the tool exactly once and finishes', async () => {
    const exec = vi.fn(({ amount }: { amount: number }) => `refunded ${amount}`);
    const build = () =>
      Agent.create({ provider: refundThenFinal('all set'), model: 'mock' })
        .system('refunds')
        .tool(refundTool('always', exec))
        .build();

    const out = (await build().run({ message: 'refund' })) as RunnerPauseOutcome;
    expect(exec).not.toHaveBeenCalled();
    const final = await build().resume(out.checkpoint, checkInApproved({ by: 'alice' }));
    expect(final).toBe('all set');
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith({ amount: 500 }, expect.anything());
  });

  it('DECLINE does NOT execute; the model sees "declined by human: <note>"', async () => {
    const exec = vi.fn(() => 'refunded');
    const toolMessages: string[] = [];
    const provider: LLMProvider = {
      name: 'mock',
      complete: async (req) => {
        const toolMsgs = req.messages.filter((m) => m.role === 'tool');
        if (toolMsgs.length > 0) {
          toolMessages.push(toolMsgs[toolMsgs.length - 1]!.content);
          return resp('understood, cancelling');
        }
        return resp('', [{ id: 't1', name: 'issue_refund', args: { amount: 9999 } }]);
      },
    };
    const build = () =>
      Agent.create({ provider, model: 'mock' })
        .system('refunds')
        .tool(refundTool('always', exec as never))
        .build();

    const out = (await build().run({ message: 'refund' })) as RunnerPauseOutcome;
    const final = await build().resume(
      out.checkpoint,
      checkInDeclined({ by: 'alice', note: 'amount too high' }),
    );
    expect(final).toBe('understood, cancelling');
    expect(exec).not.toHaveBeenCalled();
    expect(toolMessages).toHaveLength(1);
    expect(toolMessages[0]).toBe('declined by human: amount too high');
  });
});

// ── 5. Both assemblers' pack contents ───────────────────────────────────

describe('check-in — evidence assemblers', () => {
  it("'standard' fills willDo + read + drivers + trail", async () => {
    // A prior (non-check-in) tool result seeds a 'result' context frame.
    const provider: LLMProvider = {
      name: 'mock',
      complete: async (req) => {
        const hadTool = req.messages.some((m) => m.role === 'tool');
        return hadTool
          ? resp('now refunding', [{ id: 't2', name: 'issue_refund', args: { amount: 500 } }])
          : resp('', [{ id: 't1', name: 'lookup', args: {} }]);
      },
    };
    const agent = Agent.create({ provider, model: 'mock' })
      .system('Refund only verified orders. Confirm the amount first.')
      .tool(defineTool({ name: 'lookup', description: 'Look up the order', execute: () => 'order total: 500' }))
      .tool(refundTool('always'))
      .checkIn({ evidence: 'standard' })
      .build();

    const out = (await agent.run({ message: 'refund order 7' })) as RunnerPauseOutcome & {
      checkIn: NonNullable<RunnerPauseOutcome['checkIn']>;
    };
    const ev = out.checkIn.evidence;
    expect(ev.willDo).toContain('Issue a refund');
    expect(ev.willDo).toContain('amount=500');
    // read: the run-so-far context frames — system + task + the prior result.
    const channels = new Set((ev.read ?? []).map((f) => f.channel));
    expect(channels.has('system')).toBe(true);
    expect(channels.has('task')).toBe(true);
    expect(channels.has('result')).toBe(true);
    // drivers: ranked (non-increasing scores).
    expect((ev.drivers ?? []).length).toBeGreaterThan(0);
    const scores = (ev.drivers ?? []).map((d) => d.score);
    for (let i = 1; i < scores.length; i++) expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
    // intent = the assistant's stated reasoning for THIS call.
    expect(out.checkIn.intent).toBe('now refunding');
    // trail: compact grouped run-so-far.
    expect(ev.trail?.iteration).toBeGreaterThanOrEqual(0);
    expect(ev.trail?.toolCalls.some((t) => t.name === 'lookup')).toBe(true);
  });

  it("'minimal' fills ONLY willDo (zero cost)", async () => {
    const agent = Agent.create({
      provider: scripted(resp('', [{ id: 't1', name: 'issue_refund', args: { amount: 500 } }]), resp('done')),
      model: 'mock',
    })
      .system('refunds')
      .tool(refundTool('always'))
      .checkIn({ evidence: 'minimal' })
      .build();

    const out = (await agent.run({ message: 'refund' })) as RunnerPauseOutcome & {
      checkIn: NonNullable<RunnerPauseOutcome['checkIn']>;
    };
    const ev = out.checkIn.evidence;
    expect(ev.willDo).toContain('Issue a refund');
    expect(ev.read).toBeUndefined();
    expect(ev.drivers).toBeUndefined();
    expect(ev.trail).toBeUndefined();
  });
});

// ── 6. Scorer pluggability ──────────────────────────────────────────────

describe('check-in — scorer pluggability', () => {
  it('a custom scorer produces the drivers ranking', async () => {
    const customScorer: CheckInScorer = vi.fn(({ units }) =>
      // Rank by a fixed rule the default lexical scorer would never produce:
      // 'task' channel always wins with score 1, everything else 0.
      units
        .map((u) => ({ id: u.id, channel: u.channel, text: u.text, score: u.channel === 'task' ? 1 : 0 }))
        .sort((a, b) => b.score - a.score),
    );
    const agent = Agent.create({
      provider: scripted(resp('', [{ id: 't1', name: 'issue_refund', args: { amount: 500 } }]), resp('done')),
      model: 'mock',
    })
      .system('some rule')
      .tool(refundTool('always'))
      .checkIn({ evidence: 'standard', scorer: customScorer })
      .build();

    const out = (await agent.run({ message: 'refund the order' })) as RunnerPauseOutcome & {
      checkIn: NonNullable<RunnerPauseOutcome['checkIn']>;
    };
    expect(customScorer).toHaveBeenCalledTimes(1);
    const top = out.checkIn.evidence.drivers?.[0];
    expect(top?.channel).toBe('task');
    expect(top?.score).toBe(1);
  });

  it('the default lexical scorer is deterministic', () => {
    const input = {
      tool: { name: 'issue_refund', text: 'issue refund amount 500' },
      units: [
        { id: 'a', channel: 'task', text: 'please issue a refund of 500' },
        { id: 'b', channel: 'system', text: 'the weather is nice today' },
      ],
    };
    const a = lexicalDriverScorer(input);
    const b = lexicalDriverScorer(input);
    expect(a).toEqual(b);
    expect((a as readonly { id: string }[])[0].id).toBe('a'); // overlapping unit ranks first
  });
});

// ── 7. Events + recorder capture + backward-compat ──────────────────────

describe('check-in — events + recorder', () => {
  it('checkin.request / checkin.decision fire with the registry shapes', async () => {
    const requests: Record<string, unknown>[] = [];
    const decisions: Record<string, unknown>[] = [];
    const build = () => {
      const a = Agent.create({
        provider: scripted(resp('', [{ id: 't1', name: 'issue_refund', args: { amount: 500 } }]), resp('done')),
        model: 'mock',
      })
        .system('refunds')
        .tool(refundTool('always'))
        .build();
      a.on('agentfootprint.checkin.request', (e) => requests.push(e.payload as never));
      a.on('agentfootprint.checkin.decision', (e) => decisions.push(e.payload as never));
      return a;
    };

    const agent = build();
    const out = (await agent.run({ message: 'refund' })) as RunnerPauseOutcome;
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ toolName: 'issue_refund', toolCallId: 't1' });
    expect(typeof requests[0].iteration).toBe('number');
    expect((requests[0].request as { tool: string }).tool).toBe('issue_refund');

    await agent.resume(out.checkpoint, checkInApproved({ by: 'alice', note: 'ok' }));
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      toolName: 'issue_refund',
      approved: true,
      by: 'alice',
      note: 'ok',
    });
  });

  it('CheckInRecorder captures the ask + decision as a record', async () => {
    const rec = new CheckInRecorder();
    const build = () => {
      const a = Agent.create({
        provider: scripted(resp('', [{ id: 't1', name: 'issue_refund', args: { amount: 500 } }]), resp('done')),
        model: 'mock',
      })
        .system('refunds')
        .tool(refundTool('always'))
        .build();
      a.attach(rec);
      return a;
    };

    const agent = build();
    const out = (await agent.run({ message: 'refund' })) as RunnerPauseOutcome;
    expect(rec.getRequests()).toHaveLength(1);
    expect(rec.getStats()).toEqual({ requested: 1, approved: 0, declined: 0, pending: 1 });

    await agent.resume(out.checkpoint, checkInDeclined({ by: 'bob', note: 'no' }));
    expect(rec.getDecisions()).toHaveLength(1);
    expect(rec.getDecisions()[0]).toMatchObject({ approved: false, by: 'bob', note: 'no' });
    expect(rec.getStats()).toEqual({ requested: 1, approved: 0, declined: 1, pending: 0 });
  });

  it('BACKWARD-COMPAT: a run with no checkIn tool fires zero check-in events + never pauses', async () => {
    const events: string[] = [];
    const agent = Agent.create({
      provider: scripted(resp('', [{ id: 't1', name: 'plain', args: {} }]), resp('done')),
      model: 'mock',
    })
      .system('')
      .tool(defineTool({ name: 'plain', description: 'noop', execute: () => 'ok' }))
      .build();
    agent.on('*', (e) => {
      if (e.type.startsWith('agentfootprint.checkin.')) events.push(e.type);
    });
    const rec = new CheckInRecorder();
    agent.attach(rec);

    const out = await agent.run({ message: 'go' });
    expect(out).toBe('done');
    expect(isPaused(out)).toBe(false);
    expect(events).toHaveLength(0);
    expect(rec.getStats()).toEqual({ requested: 0, approved: 0, declined: 0, pending: 0 });
  });
});

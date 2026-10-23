/**
 * a paused session — 7-pattern tests
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * The laws being pinned:
 *   • A paused hosted run is STORED as `'flowchart-v1'` and the reply carries
 *     the ask as DATA. Never an error standing in for unfinished work.
 *   • A later request carrying `decision` RESUMES that run and completes it —
 *     and resuming a pause is not a replay: no earlier tool call runs twice.
 *   • A plain new message on a paused session gets a corrective refusal naming
 *     the pending ask. The message is not run; the pause is not discarded.
 *   • A decision with nothing pending is refused by name.
 *   • `'flowchart-v1'` is refused BY NAME by a 7.18-shaped reader, and a 7.18
 *     envelope is still read by this one. Both directions.
 *   • The whole envelope survives a real serialize/parse cycle, and the run
 *     resumes from what came back.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  Agent,
  allow,
  ask,
  defineTool,
  inMemoryDecisionLedger,
  type DecisionLedger,
} from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { askHuman } from '../../src/core/pause.js';
import { bearer } from '../../src/identity.js';
import { checkInApproved, checkInDeclined } from '../../src/core/checkin.js';
import {
  memorySessions,
  readEnvelope,
  readPausedRun,
  standingAgent,
  toEnvelope,
  toPausedEnvelope,
} from '../../src/hosting/index.js';
import { AwaitingDecisionError } from '../../src/hosting/index.js';
import type {
  AgentHost,
  CheckpointEnvelope,
  HostHandle,
  HostHandler,
  HostReply,
  HostRequest,
  PausedRun,
  PendingAsk,
  SessionLifecycle,
  WakeReason,
} from '../../src/hosting/index.js';
import type { LLMMessage, LLMProvider } from '../../src/provider-contract/types.js';
import { inProcessHost } from './testHost.js';
import { REFUSAL_STATUS } from '../../src/hosting/refusalStatus.js';
import { pausedRequest } from '../helpers/pausedRequest.js';
import {
  NOT_RUN_UNANSWERABLE,
  OUTCOME_NOT_RECORDED,
  OUTCOME_UNKNOWN_UNANSWERABLE,
} from '../../src/hosting/answeredPause.js';

// ─── Helpers ─────────────────────────────────────────────────────────

/** A tool that asks a person, then — once approved — really does the thing. */
function refundTool(ran: string[]): ReturnType<typeof defineTool> {
  return defineTool<{ amount: number }, string>({
    name: 'approve_refund',
    description: 'refund a customer',
    inputSchema: {
      type: 'object',
      properties: { amount: { type: 'number' } },
      required: ['amount'],
    },
    execute: ({ amount }) => {
      ran.push(`refund:${amount}`);
      return askHuman({ question: `Approve $${amount}?` });
    },
  });
}

function pausingAgent(ran: string[] = []): Agent {
  return Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [{ id: 't1', name: 'approve_refund', args: { amount: 10 } }] },
        { content: 'refund issued' },
      ],
    }),
    model: 'test-model',
    maxIterations: 3,
  })
    .system('terse')
    .tool(refundTool(ran))
    .build();
}

/** An agent whose tool declares its OWN consent gate — a check-in pause. */
function consentGateAgent(ran: string[] = []): Agent {
  return Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [{ id: 't1', name: 'issue_refund', args: { amount: 10 } }] },
        { content: 'refund issued' },
      ],
    }),
    model: 'test-model',
    maxIterations: 3,
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
        checkIn: 'always',
        execute: ({ amount }) => {
          ran.push(`refund:${amount}`);
          return `refunded ${amount}`;
        },
      }),
    )
    .build();
}

/** The reader agentfootprint 7.18 shipped, reproduced exactly. */
function readEnvelope718(envelope: unknown): unknown {
  const KNOWN: readonly string[] = ['conversation-v1'];
  const found = (envelope as { format?: string } | null)?.format;
  if (typeof found !== 'string' || !KNOWN.includes(found)) {
    throw new TypeError(
      `[hosting] unknown checkpoint format '${String(found)}'. ` +
        `This runtime reads: ${KNOWN.join(', ')}.`,
    );
  }
  return (envelope as { data: unknown }).data;
}

// ─── scenario: ask, store, answer, finish ────────────────────────────

describe('a paused session — the whole round trip', () => {
  it('pauses → stores → a later decision resumes and completes it', async () => {
    const sessions = memorySessions();
    const host = inProcessHost();
    const handle = await standingAgent({ agent: pausingAgent(), sessions, host });
    try {
      const asked = await host.deliver({ input: 'refund me $10', sessionId: 'r-1' });
      expect(asked.awaiting?.question).toBe('Approve $10?');
      expect((await sessions.hydrate('r-1'))?.format).toBe('flowchart-v1');

      const done = await host.deliver({
        input: '',
        sessionId: 'r-1',
        decision: { approved: true, by: 'alice@ops' },
      });
      expect(done.error).toBeUndefined();
      expect(done.output).toBe('refund issued');

      // The session is a plain conversation again, carrying the whole turn.
      const stored = await sessions.hydrate('r-1');
      expect(stored?.format).toBe('conversation-v1');
      const said = readEnvelope(stored).history.map((m) => m.content);
      expect(said[0]).toBe('refund me $10');
      expect(said[said.length - 1]).toBe('refund issued');
    } finally {
      await handle.close();
    }
  });

  it('a decline is carried too — the model reads it and answers anyway', async () => {
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 't1', name: 'approve_refund', args: { amount: 900 } }] },
          { content: 'I could not refund that.' },
        ],
      }),
      model: 'test-model',
      maxIterations: 3,
    })
      .system('terse')
      .tool(refundTool([]))
      .build();
    const host = inProcessHost();
    const handle = await standingAgent({ agent, sessions: memorySessions(), host });
    try {
      await host.deliver({ input: 'refund $900', sessionId: 'no' });
      const done = await host.deliver({
        input: '',
        sessionId: 'no',
        decision: { approved: false, by: 'alice@ops', note: 'too high' },
      });
      expect(done.output).toBe('I could not refund that.');
    } finally {
      await handle.close();
    }
  });

  it('the next turn continues the conversation the resumed run finished', async () => {
    const requests: string[][] = [];
    let reply = 0;
    const provider: LLMProvider = {
      name: 'spy',
      complete(req) {
        requests.push(req.messages.filter((m) => m.role !== 'system').map((m) => m.content ?? ''));
        const answers = [
          { toolCalls: [{ id: 't1', name: 'approve_refund', args: { amount: 10 } }] },
          { content: 'refund issued' },
          { content: 'It was ten dollars.' },
        ];
        const next = answers[Math.min(reply++, answers.length - 1)]!;
        return Promise.resolve({
          content: 'content' in next ? next.content : '',
          toolCalls: 'toolCalls' in next ? next.toolCalls : [],
          usage: { input: 1, output: 1 },
        });
      },
    };
    const agent = Agent.create({ provider, model: 'm', maxIterations: 3 })
      .system('terse')
      .tool(refundTool([]))
      .build();
    const host = inProcessHost();
    const handle = await standingAgent({ agent, sessions: memorySessions(), host });
    try {
      await host.deliver({ input: 'refund me', sessionId: 'c' });
      await host.deliver({ input: '', sessionId: 'c', decision: { approved: true, by: 'a' } });
      const third = await host.deliver({ input: 'how much was it?', sessionId: 'c' });
      expect(third.output).toBe('It was ten dollars.');
      // Turn 3 saw the refund turn, its answer, and the new question.
      const last = requests[requests.length - 1]!;
      expect(last).toContain('refund issued');
      expect(last[last.length - 1]).toBe('how much was it?');
    } finally {
      await handle.close();
    }
  });
});

// ─── unit: the resume-invoke contract ────────────────────────────────

// ─── security: one session's question must not gag every other session ───────

describe('a paused session — a pause belongs to a session, not to the agent', () => {
  it('session A waiting on a person does not block session B (9.2.0)', async () => {
    // 9.2.0 gave `Agent` an instance-level guard: a new message while the last
    // run paused is refused, because silently abandoning a person's question
    // makes a consent gate anyone can walk around. That guard is right for a
    // script driving one instance and WRONG for this composer, which shares one
    // Agent across every session — so `standingAgent` releases the instance the
    // moment the pause is in the STORE, which is the moment ownership moves.
    //
    // Without that release, session A's unanswered question refuses session B's
    // first message: a different conversation, a different person, an answer
    // they were never asked for.
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 't1', name: 'approve_refund', args: { amount: 10 } }] },
          { content: 'answered B' },
          { content: 'refund issued' },
        ],
      }),
      model: 'test-model',
      maxIterations: 3,
    })
      .system('terse')
      .tool(refundTool([]))
      .build();

    const sessions = memorySessions();
    const host = inProcessHost();
    const handle = await standingAgent({ agent, sessions, host });
    try {
      const a = await host.deliver({ input: 'refund me', sessionId: 'A' });
      expect(a.awaiting?.tool).toBe('approve_refund');

      // B is a different conversation and is answered normally.
      const b = await host.deliver({ input: 'hello from B', sessionId: 'B' });
      expect(b.error).toBeUndefined();
      expect(b.output).toBe('answered B');

      // …and A's question is still exactly where it belongs: in the store,
      // answerable by a later request carrying a decision.
      const stored = await sessions.hydrate('A');
      expect(stored?.format).toBe('flowchart-v1');
      const stillWaiting = await host.deliver({ input: 'anything', sessionId: 'A' });
      expect(stillWaiting.code).toBe('ERR_AWAITING_DECISION');
    } finally {
      await handle.close();
    }
  });
});

describe('a paused session — what makes a request a resume', () => {
  it('a plain message is refused, naming the pending ask, and nothing is lost', async () => {
    let calls = 0;
    const provider: LLMProvider = {
      name: 'counting',
      complete: () => {
        calls++;
        return Promise.resolve({
          content: '',
          toolCalls: [{ id: 't1', name: 'approve_refund', args: { amount: 10 } }],
          usage: { input: 1, output: 1 },
        });
      },
    };
    const agent = Agent.create({ provider, model: 'm', maxIterations: 3 })
      .system('terse')
      .tool(refundTool([]))
      .build();
    const sessions = memorySessions();
    const host = inProcessHost();
    const handle = await standingAgent({ agent, sessions, host });
    try {
      await host.deliver({ input: 'refund me', sessionId: 'stuck' });
      const callsAfterPause = calls;
      const before = await sessions.hydrate('stuck');

      const nudge = await host.deliver({ input: 'hello? are you there?', sessionId: 'stuck' });
      expect(nudge.code).toBe('ERR_AWAITING_DECISION');
      expect(nudge.error).toContain('approve_refund');
      expect(nudge.error).toContain('Approve $10?');
      expect(nudge.error).toContain('decision');
      // The message was NOT run…
      expect(calls).toBe(callsAfterPause);
      // …and the pause was NOT discarded.
      expect(await sessions.hydrate('stuck')).toEqual(before);
    } finally {
      await handle.close();
    }
  });

  it('a decision for a session with nothing pending is refused by name', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'hi' }), model: 'm' })
      .system('terse')
      .build();
    const host = inProcessHost();
    const handle = await standingAgent({ agent, sessions: memorySessions(), host });
    try {
      await host.deliver({ input: 'hello', sessionId: 'calm' });
      const stray = await host.deliver({
        input: '',
        sessionId: 'calm',
        decision: { approved: true, by: 'alice' },
      });
      expect(stray.code).toBe('ERR_NO_PENDING_ASK');
      expect(stray.error).toContain("session 'calm'");
      expect(stray.error).toContain('nothing is paused');
    } finally {
      await handle.close();
    }
  });

  it("wakes the store with 'resume' when the request carries a decision", async () => {
    const reasons: WakeReason[] = [];
    const inner = memorySessions();
    const sessions: SessionLifecycle = {
      hydrate: (id) => inner.hydrate(id),
      persist: (id, env) => inner.persist(id, env),
      onWake: (_id, reason) => {
        reasons.push(reason);
      },
    };
    const host = inProcessHost();
    const handle = await standingAgent({ agent: pausingAgent(), sessions, host });
    try {
      await host.deliver({ input: 'refund me', sessionId: 'w' });
      await host.deliver({ input: '', sessionId: 'w', decision: { approved: true, by: 'a' } });
      expect(reasons).toEqual(['invoke', 'resume']);
    } finally {
      await handle.close();
    }
  });
});

// ─── property: a resumed pause is not a replay ───────────────────────

describe('a paused session — resuming is not a replay', () => {
  it('the tool that asked is not re-executed on the way back in', async () => {
    const ran: string[] = [];
    const host = inProcessHost();
    const handle = await standingAgent({
      agent: pausingAgent(ran),
      sessions: memorySessions(),
      host,
    });
    try {
      await host.deliver({ input: 'refund me', sessionId: 'once' });
      expect(ran).toEqual(['refund:10']);
      await host.deliver({ input: '', sessionId: 'once', decision: { approved: true, by: 'a' } });
      // Still ONE. A pause resumes from the engine's own checkpoint, so the
      // conversation-replay caveat that applies to resumeOnError does not
      // apply here at all.
      expect(ran).toEqual(['refund:10']);
    } finally {
      await handle.close();
    }
  });

  it('carries a check-in pause with its evidence, and the decision runs the REAL tool', async () => {
    const ran: string[] = [];
    const pay = defineTool<{ amount: number }, string>({
      name: 'pay',
      description: 'pay a supplier',
      inputSchema: {
        type: 'object',
        properties: { amount: { type: 'number' } },
        required: ['amount'],
      },
      checkIn: 'always',
      execute: ({ amount }) => {
        ran.push(`paid:${amount}`);
        return Promise.resolve(`paid ${amount}`);
      },
    });
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 't1', name: 'pay', args: { amount: 500 } }] },
          { content: 'supplier paid' },
        ],
      }),
      model: 'm',
      maxIterations: 3,
    })
      .system('Pay suppliers promptly.')
      .tool(pay)
      .build();
    const sessions = memorySessions();
    const host = inProcessHost();
    const handle = await standingAgent({ agent, sessions, host });
    try {
      const asked = await host.deliver({ input: 'pay the supplier', sessionId: 'ci' });
      expect(asked.awaiting?.checkIn?.tool).toBe('pay');
      expect(asked.awaiting?.checkIn?.evidence.willDo).toContain('pay a supplier');
      // The tool has NOT run — consent comes before the side effect.
      expect(ran).toEqual([]);
      // The evidence rode into the store too.
      expect(readPausedRun(await sessions.hydrate('ci')).pending.checkIn?.tool).toBe('pay');

      const done = await host.deliver({
        input: '',
        sessionId: 'ci',
        decision: checkInApproved({ request: pausedRequest(asked.awaiting), by: 'alice' }),
      });
      expect(done.output).toBe('supplier paid');
      expect(ran).toEqual(['paid:500']);
    } finally {
      await handle.close();
    }
  });

  it('a middleware ask rides the same wire, end to end', async () => {
    const ran: string[] = [];
    const deploy = defineTool<Record<string, never>, string>({
      name: 'deploy',
      description: 'deploy to production',
      inputSchema: { type: 'object', properties: {} },
      execute: () => {
        ran.push('deployed');
        return Promise.resolve('deployed');
      },
    });
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 't1', name: 'deploy', args: {} }] },
          { content: 'shipped it' },
        ],
      }),
      model: 'm',
      maxIterations: 3,
    })
      .system('terse')
      .tool(deploy)
      .toolMiddleware({ name: 'four-eyes', onToolCall: () => ask({ question: 'sure?' }) })
      .build();
    const host = inProcessHost();
    const handle = await standingAgent({ agent, sessions: memorySessions(), host });
    try {
      const asked = await host.deliver({ input: 'ship it', sessionId: 'm' });
      expect(asked.awaiting?.ask).toEqual({
        id: expect.stringMatching(/^[0-9a-f]{64}$/),
        question: 'sure?',
        middleware: 'four-eyes',
      });
      expect(ran).toEqual([]);
      const done = await host.deliver({
        input: '',
        sessionId: 'm',
        decision: checkInApproved({ request: pausedRequest(asked.awaiting), by: 'alice' }),
      });
      expect(done.output).toBe('shipped it');
      expect(ran).toEqual(['deployed']);
    } finally {
      await handle.close();
    }
  });
});

// ─── security: the version field, in both directions ─────────────────

describe("a paused session — 'flowchart-v1' and an older reader", () => {
  it('a 7.18-shaped reader refuses a REAL paused envelope, by name', async () => {
    const sessions = memorySessions();
    const host = inProcessHost();
    const handle = await standingAgent({ agent: pausingAgent(), sessions, host });
    try {
      await host.deliver({ input: 'refund me', sessionId: 'old-reader' });
      const stored = await sessions.hydrate('old-reader');
      expect(() => readEnvelope718(stored)).toThrow(/unknown checkpoint format 'flowchart-v1'/);
      expect(() => readEnvelope718(stored)).toThrow(/reads: conversation-v1/);
    } finally {
      await handle.close();
    }
  });

  it('and this runtime still reads what the older one wrote', () => {
    const written718: CheckpointEnvelope = toEnvelope({
      version: 1,
      runId: 'from-7-18',
      history: [{ role: 'user', content: 'hello' }],
      lastCompletedIteration: 1,
      originalInput: { message: 'hello' },
      checkpointedAt: 1,
    });
    expect(readEnvelope(written718).runId).toBe('from-7-18');
  });

  it('the reply carries the question and never the run state', async () => {
    const sessions = memorySessions();
    const host = inProcessHost();
    const handle = await standingAgent({ agent: pausingAgent(), sessions, host });
    try {
      const asked = await host.deliver({ input: 'refund me', sessionId: 'sealed' });
      expect(asked.awaiting).not.toHaveProperty('checkpoint');
      expect(asked.awaiting).not.toHaveProperty('conversation');
      // The store, meanwhile, has all of it.
      const paused = readPausedRun(await sessions.hydrate('sealed'));
      expect(paused.checkpoint.sharedState).toBeDefined();
    } finally {
      await handle.close();
    }
  });
});

// ─── property: the envelope on a real wire ───────────────────────────

describe('a paused session — through a real serialize/parse cycle', () => {
  it('resumes from what came back off the wire', async () => {
    // A store that keeps STRINGS, which is what a real one does.
    const bytes = new Map<string, string>();
    const sessions: SessionLifecycle = {
      hydrate: (id) => {
        const raw = bytes.get(id);
        return Promise.resolve(raw === undefined ? undefined : (JSON.parse(raw) as never));
      },
      persist: (id, envelope) => {
        bytes.set(id, JSON.stringify(envelope));
        return Promise.resolve();
      },
    };
    const host = inProcessHost();
    const handle = await standingAgent({ agent: pausingAgent(), sessions, host });
    try {
      const asked = await host.deliver({ input: 'refund me', sessionId: 'wire' });
      expect(asked.awaiting).toBeDefined();
      expect(bytes.get('wire')).toContain('flowchart-v1');

      const done = await host.deliver({
        input: '',
        sessionId: 'wire',
        decision: { approved: true, by: 'alice' },
      });
      expect(done.output).toBe('refund issued');
    } finally {
      await handle.close();
    }
  });

  it('JSON keeps everything resume reads, and drops only explicit undefineds', async () => {
    // The honest statement of what JSON does to an engine checkpoint: it is
    // safe to resume from, and it is NOT byte-identical. `key: undefined`
    // comes back as no key at all — and every one of those lives in the
    // engine's diagnostic halves, never in the state resume restores.
    const sessions = memorySessions();
    const host = inProcessHost();
    const handle = await standingAgent({ agent: pausingAgent(), sessions, host });
    try {
      await host.deliver({ input: 'refund me', sessionId: 'json' });
      const paused = readPausedRun(await sessions.hydrate('json'));
      const back = JSON.parse(JSON.stringify(paused)) as typeof paused;

      // The half resume reads survives byte for byte.
      expect(back.checkpoint.sharedState).toEqual(paused.checkpoint.sharedState);
      expect(back.checkpoint.pausedStageId).toBe(paused.checkpoint.pausedStageId);
      expect(back.checkpoint.subflowPath).toEqual(paused.checkpoint.subflowPath);
      expect(back.checkpoint.subflowStates).toEqual(paused.checkpoint.subflowStates);
      expect(back.checkpoint.executionCount).toBe(paused.checkpoint.executionCount);
      expect(back.checkpoint.visitCounts).toEqual(paused.checkpoint.visitCounts);
      expect(back.conversation).toEqual(paused.conversation);
      expect(back.pending).toEqual(paused.pending);

      // Any difference at all is a dropped `undefined`, and nothing else.
      for (const path of droppedKeys(paused, back, '')) {
        expect(valueAt(paused, path)).toBeUndefined();
      }
    } finally {
      await handle.close();
    }
  });
});

// ─── integration: over a real socket ─────────────────────────────────

describe('a paused session — over nodeHost, for real', () => {
  it('answers 202 with the ask, then 200 when the decision arrives', async () => {
    const { nodeHost } = await import('../../src/hosting/index.js');
    const handle = await standingAgent({
      agent: pausingAgent(),
      sessions: memorySessions(),
      host: nodeHost({ port: 0, hostname: '127.0.0.1' }),
    });
    try {
      const post = (body: unknown): Promise<Response> =>
        fetch(`${handle.url}/invoke`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });

      const asked = await post({ input: 'refund me', sessionId: 'http' });
      // 202 Accepted: understood, acted on, not finished. Not a 4xx, not a 5xx.
      expect(asked.status).toBe(202);
      const askedBody = (await asked.json()) as { awaiting: { question: string; tool: string } };
      expect(askedBody.awaiting.tool).toBe('approve_refund');
      expect(askedBody.awaiting.question).toBe('Approve $10?');

      const nudge = await post({ input: 'still there?', sessionId: 'http' });
      expect(nudge.status).toBe(409);
      expect((await nudge.json()) as { code: string }).toMatchObject({
        code: 'ERR_AWAITING_DECISION',
      });

      const done = await post({
        input: '',
        sessionId: 'http',
        decision: { approved: true, by: 'alice' },
      });
      expect(done.status).toBe(200);
      expect((await done.json()) as { output: string }).toEqual({ output: 'refund issued' });
    } finally {
      await handle.close();
    }
  });
});

// ─── ROI: durability and pauses do not fight ─────────────────────────

describe('a paused session — with mid-run durability on', () => {
  it("an 'async' write in flight cannot land on top of the stored pause", async () => {
    // The ordering hazard, pinned: mid-run writes are settled BEFORE the
    // terminal envelope, so a late conversation write can never demote a
    // stored pause back to a plain conversation and lose the question.
    const formats: string[] = [];
    const inner = memorySessions();
    const sessions: SessionLifecycle = {
      hydrate: (id) => inner.hydrate(id),
      async persist(id, envelope) {
        // Every write takes a moment, so a racing one would be visible.
        await new Promise((resolve) => setTimeout(resolve, 5));
        formats.push(envelope.format);
        return inner.persist(id, envelope);
      },
    };
    const host = inProcessHost();
    const handle = await standingAgent({
      agent: pausingAgent(),
      sessions,
      host,
      durability: 'async',
    });
    try {
      const asked = await host.deliver({ input: 'refund me', sessionId: 'race' });
      expect(asked.awaiting).toBeDefined();
      await new Promise((resolve) => setTimeout(resolve, 40));
      // Whatever came before, the LAST word is the pause.
      expect(formats[formats.length - 1]).toBe('flowchart-v1');
      expect((await sessions.hydrate('race'))?.format).toBe('flowchart-v1');
    } finally {
      await handle.close();
    }
  });
});

// ─── tiny helpers for the JSON law ───────────────────────────────────

/** Paths present in `a` but absent in `b`, recursively. */
function droppedKeys(a: unknown, b: unknown, path: string, out: string[] = []): string[] {
  if (!a || typeof a !== 'object' || !b || typeof b !== 'object') return out;
  for (const key of Object.keys(a as object)) {
    const next = path ? `${path}.${key}` : key;
    if (!Object.prototype.hasOwnProperty.call(b, key)) out.push(next);
    else droppedKeys((a as never)[key], (b as never)[key], next, out);
  }
  return out;
}

function valueAt(root: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], root);
}

// ─── 8.13.0: a consent gate answered with a value is a CLIENT error ───

describe('a consent gate over the wire — the wrong shape is a 400, not a 500', () => {
  it('a string `decision` on a check-in pause is refused by name, and nothing runs', async () => {
    const ran: string[] = [];
    const sessions = memorySessions();
    const host = inProcessHost();
    const handle = await standingAgent({ agent: consentGateAgent(ran), sessions, host });
    try {
      const asked = await host.deliver({ input: 'refund me $10', sessionId: 'gate-1' });
      expect(asked.awaiting).toBeDefined();

      // A caller who typed "yes" instead of sending a decision. Before 8.13.0
      // this silently DECLINED and reported a clean 200.
      const wrong = await host.deliver({
        input: '',
        sessionId: 'gate-1',
        decision: 'yes go ahead',
      });

      expect(wrong.code).toBe('ERR_DECISION_REQUIRED');
      expect(wrong.output).toBeUndefined();
      expect(wrong.error).toContain('checkInApproved');
      expect(ran).toEqual([]);

      // The session is untouched — the same gate, answered right, completes.
      const done = await host.deliver({
        input: '',
        sessionId: 'gate-1',
        decision: checkInApproved({ request: pausedRequest(asked.awaiting), by: 'alice@ops' }),
      });
      expect(done.output).toBe('refund issued');
      expect(ran).toEqual(['refund:10']);
    } finally {
      await handle.close();
    }
  });

  it('over a real socket it is a 400 — the request is wrong, not the session', async () => {
    const { nodeHost } = await import('../../src/hosting/index.js');
    const handle = await standingAgent({
      agent: consentGateAgent(),
      sessions: memorySessions(),
      host: nodeHost({ port: 0, hostname: '127.0.0.1' }),
    });
    try {
      const post = (body: unknown): Promise<Response> =>
        fetch(`${handle.url}/invoke`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });

      const asked = await post({ input: 'refund me', sessionId: 'h-gate' });
      expect(asked.status).toBe(202);
      // What the client is shown — the request its decision must name.
      const { awaiting } = (await asked.json()) as { awaiting: unknown };

      const wrong = await post({ input: '', sessionId: 'h-gate', decision: 'yes' });
      expect(wrong.status).toBe(400);
      expect((await wrong.json()) as { code: string }).toMatchObject({
        code: 'ERR_DECISION_REQUIRED',
      });

      const done = await post({
        input: '',
        sessionId: 'h-gate',
        decision: checkInApproved({ request: pausedRequest(awaiting), by: 'alice' }),
      });
      expect(done.status).toBe(200);
    } finally {
      await handle.close();
    }
  });
});

// ─── a decision answers ONE pending request, once ──────────────────────

describe('a consent gate over the wire — a decision answers the request it names', () => {
  /** Two check-ins in a row: refund 5, then — after that answer — refund 9000. */
  function twoRefunds(ran: number[]): Agent {
    return Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 't1', name: 'issue_refund', args: { amount: 5 } }] },
          { toolCalls: [{ id: 't1', name: 'issue_refund', args: { amount: 9000 } }] },
          { content: 'both refunds issued' },
        ],
      }),
      model: 'test-model',
      maxIterations: 4,
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
          checkIn: 'always',
          execute: ({ amount }) => {
            ran.push(amount);
            return `refunded ${amount}`;
          },
        }),
      )
      .build();
  }

  it('a duplicate "approve" that lands on the NEXT pause is refused (409), and that pause still waits', async () => {
    const ran: number[] = [];
    const host = inProcessHost();
    const handle = await standingAgent({
      agent: twoRefunds(ran),
      sessions: memorySessions(),
      host,
    });
    try {
      const first = await host.deliver({ input: 'refund both', sessionId: 'dup' });
      expect(first.awaiting?.checkIn?.args).toEqual({ amount: 5 });
      const approveFirst = checkInApproved({
        request: pausedRequest(first.awaiting),
        by: 'alice@ops',
      });

      const second = await host.deliver({ input: '', sessionId: 'dup', decision: approveFirst });
      expect(ran).toEqual([5]);
      expect(second.awaiting?.checkIn?.args).toEqual({ amount: 9000 });

      // The double click: the same decision arrives again. The session is now
      // paused on a refund nobody was shown — it must not be the one answered.
      const duplicate = await host.deliver({ input: '', sessionId: 'dup', decision: approveFirst });
      expect(duplicate.code).toBe('ERR_RESUME_DECISION');
      expect(REFUSAL_STATUS[duplicate.code!]).toBe(409);
      expect(ran).toEqual([5]);

      // The second refund is still the outstanding question, answerable as asked.
      const done = await host.deliver({
        input: '',
        sessionId: 'dup',
        decision: checkInApproved({ request: pausedRequest(second.awaiting), by: 'alice@ops' }),
      });
      expect(done.output).toBe('both refunds issued');
      expect(ran).toEqual([5, 9000]);
    } finally {
      await handle.close();
    }
  });

  it('over a real socket, the 409 for a duplicate never carries the pending request id', async () => {
    // The refusal must not hand out the id it exists to require: a client that
    // retried a 409 with an id read from its body would approve the refund
    // nobody was shown.
    const { nodeHost } = await import('../../src/hosting/index.js');
    const ran: number[] = [];
    const handle = await standingAgent({
      agent: twoRefunds(ran),
      sessions: memorySessions(),
      host: nodeHost({ port: 0, hostname: '127.0.0.1' }),
    });
    try {
      const post = (body: unknown): Promise<Response> =>
        fetch(`${handle.url}/invoke`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
      const first = (await (await post({ input: 'refund both', sessionId: 'w409' })).json()) as {
        awaiting: unknown;
      };
      const approveFirst = checkInApproved({ request: pausedRequest(first.awaiting), by: 'alice' });
      const resumed = await post({ input: '', sessionId: 'w409', decision: approveFirst });
      expect(resumed.status).toBe(202);
      const second = (await resumed.json()) as { awaiting: unknown };
      const pendingId = pausedRequest(second.awaiting).id;

      const duplicate = await post({ input: '', sessionId: 'w409', decision: approveFirst });
      expect(duplicate.status).toBe(409);
      const body = await duplicate.text();
      expect(JSON.parse(body)).toMatchObject({ code: 'ERR_RESUME_DECISION' });
      expect(body).not.toContain(pendingId);
      expect(body).not.toContain(approveFirst.requestId);

      // A decision that names no request is refused the same way, without the id.
      const unnamed = await post({
        input: '',
        sessionId: 'w409',
        decision: { approved: true, by: 'alice', at: 1 },
      });
      expect(unnamed.status).toBe(409);
      expect(await unnamed.text()).not.toContain(pendingId);
      expect(ran).toEqual([5]);
    } finally {
      await handle.close();
    }
  });
});

// ─── once, when the resume that used the decision then failed ──────────

describe('a consent gate over the wire — a decision whose resume failed after using it', () => {
  /**
   * A check-in on `issue_refund`. While `failing.on` is set, the model call
   * AFTER the refund ran fails — "approve → the tool runs → the next model
   * call fails". Every request the model is sent is recorded in `sent`.
   */
  function flakyRefunds(
    ran: number[],
    failing: { on: boolean },
    sent: (readonly LLMMessage[])[] = [],
    decisionLedger?: DecisionLedger,
    beforeFailing?: () => Promise<void>,
  ): Agent {
    const usage = { input: 1, output: 1 };
    const provider: LLMProvider = {
      name: 'mock',
      complete: async (request) => {
        sent.push([...request.messages]);
        const last = request.messages[request.messages.length - 1];
        if (last?.role === 'tool') {
          if (failing.on) {
            await beforeFailing?.();
            throw new Error('model unavailable');
          }
          return { content: 'refund issued', toolCalls: [], usage, stopReason: 'stop' };
        }
        return String(last?.content ?? '').includes('refund')
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
    return Agent.create({
      provider,
      model: 'test-model',
      maxIterations: 3,
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
          checkIn: 'always',
          execute: ({ amount }) => {
            ran.push(amount);
            return `refunded ${amount}`;
          },
        }),
      )
      .build();
  }

  /** Every assistant tool call in `messages` has a tool message answering it. */
  function everyCallAnswered(messages: readonly LLMMessage[]): boolean {
    const answered = new Set(messages.filter((m) => m.role === 'tool').map((m) => m.toolCallId));
    return messages
      .filter((m) => m.role === 'assistant')
      .every((m) => (m.toolCalls ?? []).every((call) => answered.has(call.id)));
  }

  it('a retry is refused as already answered — the outcome is not known here — and the tool ran once', async () => {
    const ran: number[] = [];
    const failing = { on: true };
    const sessions = memorySessions();
    const host = inProcessHost();
    const handle = await standingAgent({ agent: flakyRefunds(ran, failing), sessions, host });
    try {
      const asked = await host.deliver({ input: 'refund me', sessionId: 'flaky' });
      const decision = checkInApproved({ request: pausedRequest(asked.awaiting), by: 'alice' });
      const failed = await host.deliver({ input: '', sessionId: 'flaky', decision });
      expect(failed.output).toBeUndefined();
      expect(failed.error).toBeDefined();
      expect(ran).toEqual([10]);

      // The stored pause no longer offers the request for an answer.
      expect(readPausedRun(await sessions.hydrate('flaky')).answered).toEqual({
        at: expect.any(Number),
      });

      failing.on = false;
      const retry = await host.deliver({ input: '', sessionId: 'flaky', decision });
      expect(retry.code).toBe('ERR_RESUME_DECISION');
      expect(REFUSAL_STATUS[retry.code!]).toBe(409);
      expect(retry.error).toContain('is not known here');
      expect(retry.error).not.toContain('Nothing was executed');
      expect(ran).toEqual([10]);
    } finally {
      await handle.close();
    }
  });

  it('another process on the same store refuses it too, and the conversation goes on', async () => {
    const ran: number[] = [];
    const sessions = memorySessions();
    const first = inProcessHost();
    const firstHandle = await standingAgent({
      agent: flakyRefunds(ran, { on: true }),
      sessions,
      host: first,
    });
    let decision: unknown;
    try {
      const asked = await first.deliver({ input: 'refund me', sessionId: 'moved' });
      decision = checkInApproved({ request: pausedRequest(asked.awaiting), by: 'alice' });
      await first.deliver({ input: '', sessionId: 'moved', decision });
      expect(ran).toEqual([10]);
    } finally {
      await firstHandle.close();
    }

    // A restart, or a second host: an agent whose memory never saw the first
    // spend (its own fresh ledger) — only the stored pause says it was used.
    const sent: (readonly LLMMessage[])[] = [];
    const second = inProcessHost();
    const secondHandle = await standingAgent({
      agent: flakyRefunds(ran, { on: false }, sent, inMemoryDecisionLedger()),
      sessions,
      host: second,
    });
    try {
      const retry = await second.deliver({ input: '', sessionId: 'moved', decision });
      expect(retry.code).toBe('ERR_RESUME_DECISION');
      expect(ran).toEqual([10]);

      // A new message continues the conversation as this session stored it:
      // the call the run left open is settled as unknown — the host kept no
      // result for it (nothing stored mid-run under the default durability).
      const next = await second.deliver({ input: 'is it done?', sessionId: 'moved' });
      expect(next.output).toBe('noted: is it done?');
      const request = sent[sent.length - 1]!;
      expect(everyCallAnswered(request)).toBe(true);
      expect(request.find((m) => m.role === 'tool' && m.toolCallId === 't1')?.content).toBe(
        OUTCOME_NOT_RECORDED,
      );
      expect(ran).toEqual([10]);
    } finally {
      await secondHandle.close();
    }
  });

  it('with durable writes, the conversation goes on with the result the run kept', async () => {
    const ran: number[] = [];
    const failing = { on: true };
    const sent: (readonly LLMMessage[])[] = [];
    const sessions = memorySessions();
    const host = inProcessHost();
    const handle = await standingAgent({
      agent: flakyRefunds(ran, failing, sent),
      sessions,
      host,
      durability: 'sync',
    });
    try {
      const asked = await host.deliver({ input: 'refund me', sessionId: 'kept' });
      const decision = checkInApproved({ request: pausedRequest(asked.awaiting), by: 'alice' });
      await host.deliver({ input: '', sessionId: 'kept', decision });
      expect(ran).toEqual([10]);
      expect(readPausedRun(await sessions.hydrate('kept')).answered).toBeDefined();

      failing.on = false;
      expect((await host.deliver({ input: '', sessionId: 'kept', decision })).code).toBe(
        'ERR_RESUME_DECISION',
      );
      const next = await host.deliver({ input: 'is it done?', sessionId: 'kept' });
      expect(next.output).toBe('noted: is it done?');
      const request = sent[sent.length - 1]!;
      expect(everyCallAnswered(request)).toBe(true);
      expect(request.find((m) => m.role === 'tool' && m.toolCallId === 't1')?.content).toBe(
        'refunded 10',
      );
      expect(ran).toEqual([10]);
    } finally {
      await handle.close();
    }
  });

  it('an evicted lane with the default factory does not answer it again', async () => {
    const ran: number[] = [];
    const failing = { on: true };
    const host = inProcessHost();
    const handle = await standingAgent({
      agentFactory: () => flakyRefunds(ran, failing),
      sessions: memorySessions(),
      host,
      maxActiveSessions: 1,
    });
    try {
      const asked = await host.deliver({ input: 'refund me', sessionId: 'evicted' });
      const decision = checkInApproved({ request: pausedRequest(asked.awaiting), by: 'alice' });
      await host.deliver({ input: '', sessionId: 'evicted', decision });
      expect(ran).toEqual([10]);
      failing.on = false;
      // Another session takes the only lane: the first session's agent is gone.
      expect((await host.deliver({ input: 'hello', sessionId: 'other' })).output).toBe(
        'noted: hello',
      );
      const retry = await host.deliver({ input: '', sessionId: 'evicted', decision });
      expect(retry.code).toBe('ERR_RESUME_DECISION');
      expect(ran).toEqual([10]);
    } finally {
      await handle.close();
    }
  });

  it('other decisions spent in this process meanwhile — however many — do not keep the pause from being marked', async () => {
    // Between this resume's spend and its failure, more spends than any
    // bounded record of "used" requests could keep. Whether this pause gets
    // marked must not depend on that.
    const { spendDecision } = await import('../../src/core/consentRequest.js');
    const flood = async (): Promise<void> => {
      const ledger = inMemoryDecisionLedger();
      for (let i = 0; i < 10_001; i += 1) {
        await spendDecision(ledger, { requestId: `flood-${i}` } as never, 'checkIn');
      }
    };
    const ran: number[] = [];
    const sessions = memorySessions();
    const host = inProcessHost();
    const handle = await standingAgent({
      agent: flakyRefunds(ran, { on: true }, [], undefined, flood),
      sessions,
      host,
    });
    try {
      const asked = await host.deliver({ input: 'refund me', sessionId: 'flood' });
      const decision = checkInApproved({ request: pausedRequest(asked.awaiting), by: 'alice' });
      const failed = await host.deliver({ input: '', sessionId: 'flood', decision });
      expect(failed.error).toContain('model unavailable');
      expect(ran).toEqual([10]);
      expect(readPausedRun(await sessions.hydrate('flood')).answered).toEqual({
        at: expect.any(Number),
      });
    } finally {
      await handle.close();
    }
  });

  it('a resume that fails before its run starts, on a shared agent, leaves its OWN pause answerable — and never takes another session’s conversation', async () => {
    // The shared agent's last run is another person's. Nothing about this
    // session's pause may come from the agent's own state; and a resume
    // refused before its decision reached a ledger used nothing.
    const ran: number[] = [];
    const inner = memorySessions();
    let poison = false;
    const sessions: SessionLifecycle = {
      async hydrate(id) {
        const stored = await inner.hydrate(id);
        if (!poison || id !== 'b' || stored?.format !== 'flowchart-v1') return stored;
        // A stored state the resume refuses before its run starts (an
        // inherited findings ledger — not the stored data it must be).
        const data = stored.data as PausedRun;
        const sharedState = Object.assign(
          Object.create({ findingsLedger: [] }) as object,
          data.checkpoint.sharedState,
        );
        return {
          ...stored,
          data: { ...data, checkpoint: { ...data.checkpoint, sharedState } },
        } as CheckpointEnvelope;
      },
      persist: (id, envelope) => inner.persist(id, envelope),
    };
    const host = inProcessHost();
    const handle = await standingAgent({ agent: flakyRefunds(ran, { on: false }), sessions, host });
    try {
      const asked = await host.deliver({ input: 'refund me', sessionId: 'b' });
      const decision = checkInApproved({ request: pausedRequest(asked.awaiting), by: 'bob' });
      const other = await host.deliver({ input: 'my secret is 4242', sessionId: 'a' });
      expect(other.output).toBe('noted: my secret is 4242');

      poison = true;
      const failed = await host.deliver({ input: '', sessionId: 'b', decision });
      poison = false;
      expect(failed.error).toBeDefined();
      expect(ran).toEqual([]);

      const stored = readPausedRun(await inner.hydrate('b'));
      expect(stored.answered).toBeUndefined();
      expect(JSON.stringify(stored)).not.toContain('4242');
      expect(stored.conversation.history[0]).toMatchObject({ role: 'user', content: 'refund me' });
      // Nothing was used: the same decision still answers it, once.
      const done = await host.deliver({ input: '', sessionId: 'b', decision });
      expect(done.error).toBeUndefined();
      expect(ran).toEqual([10]);
    } finally {
      await handle.close();
    }
  });

  it.each([
    ['a plain store failure', {}],
    ['an error that calls itself ERR_DECISION_REQUIRED', { code: 'ERR_DECISION_REQUIRED' }],
    ['an error that calls itself ERR_STALE_DECISION', { code: 'ERR_STALE_DECISION' }],
    [
      'an error that calls itself ERR_SESSION_OWNERSHIP_CONFLICT',
      { code: 'ERR_SESSION_OWNERSHIP_CONFLICT' },
    ],
    ['an error that calls itself ERR_RESUME_REDACTION', { code: 'ERR_RESUME_REDACTION' }],
    [
      'an error that calls itself a refused decision',
      { code: 'ERR_RESUME_DECISION', reason: 'other-request' },
    ],
  ])(
    'a resume that ran the tool, then failed to store its result (%s), leaves the pause answered — a retry elsewhere is refused',
    async (_label, fields) => {
      // What failed, and what it calls itself, says nothing about whether the
      // decision was used: where it failed does. This one failed after.
      const ran: number[] = [];
      const inner = memorySessions();
      let armed = false;
      const sessions: SessionLifecycle = {
        hydrate: (id) => inner.hydrate(id),
        async persist(id, envelope) {
          if (armed) {
            armed = false;
            throw Object.assign(new Error('the store refused the write'), fields);
          }
          return inner.persist(id, envelope);
        },
      };
      const host = inProcessHost();
      const handle = await standingAgent({
        agent: flakyRefunds(ran, { on: false }),
        sessions,
        host,
      });
      let decision: unknown;
      try {
        const asked = await host.deliver({ input: 'refund me', sessionId: 'stored' });
        decision = checkInApproved({ request: pausedRequest(asked.awaiting), by: 'alice' });
        armed = true; // the next write is the finished run's
        const failed = await host.deliver({ input: '', sessionId: 'stored', decision });
        expect(failed.output).toBeUndefined();
        expect(ran).toEqual([10]);
        expect(readPausedRun(await inner.hydrate('stored')).answered).toEqual({
          at: expect.any(Number),
        });
      } finally {
        await handle.close();
      }
      // Another process — its own memory — on the same store.
      const elsewhere = inProcessHost();
      const other = await standingAgent({
        agent: flakyRefunds(ran, { on: false }, [], inMemoryDecisionLedger()),
        sessions: inner,
        host: elsewhere,
      });
      try {
        const retry = await elsewhere.deliver({ input: '', sessionId: 'stored', decision });
        expect(retry.code).toBe('ERR_RESUME_DECISION');
        expect(ran).toEqual([10]);
      } finally {
        await other.close();
      }
    },
  );

  it('a door that clones the decision before resuming still marks the pause — and a retry is refused', async () => {
    // A door is free to copy, re-parse or wrap a decision on its way to the
    // resume. Whether the pause gets marked must not depend on that.
    const { afterFailedAnswer, watchAnswer } = await import('../../src/hosting/answeredPause.js');
    const { describePause } = await import('../../src/hosting/pendingAsk.js');
    const ran: number[] = [];
    const store = memorySessions();
    const agent = flakyRefunds(ran, { on: true });
    const out = await agent.run({ message: 'refund me' });
    if (!('checkIn' in out) || out.checkIn === undefined) throw new Error('expected a check-in');
    const paused: PausedRun = {
      checkpoint: out.checkpoint,
      conversation: agent.checkpoint()!,
      pending: describePause(out, 'cloned'),
    };
    await store.persist('cloned', toPausedEnvelope(paused));
    const decision = checkInApproved({ request: out.checkIn, by: 'alice' });
    const watch = watchAnswer(paused);
    try {
      await agent.resume(out.checkpoint, JSON.parse(JSON.stringify(decision)));
      throw new Error('expected the resume to fail');
    } catch {
      await afterFailedAnswer({ store, sessionId: 'cloned', paused, watch });
    } finally {
      watch?.release();
    }
    expect(ran).toEqual([10]);
    expect(readPausedRun(await store.hydrate('cloned')).answered).toEqual({
      at: expect.any(Number),
    });
    const elsewhere = inProcessHost();
    const handle = await standingAgent({
      agent: flakyRefunds(ran, { on: false }, [], inMemoryDecisionLedger()),
      sessions: store,
      host: elsewhere,
    });
    try {
      const retry = await elsewhere.deliver({ input: '', sessionId: 'cloned', decision });
      expect(retry.code).toBe('ERR_RESUME_DECISION');
      expect(ran).toEqual([10]);
    } finally {
      await handle.close();
    }
  });

  it('a store whose read fails while the pause is being marked still ends with it marked — and a retry refused', async () => {
    const ran: number[] = [];
    const inner = memorySessions();
    let failReads = false;
    const sessions: SessionLifecycle = {
      async hydrate(id) {
        if (failReads) throw new Error('read timed out');
        return inner.hydrate(id);
      },
      persist: (id, envelope) => inner.persist(id, envelope),
    };
    const host = inProcessHost();
    const handle = await standingAgent({
      // The resume's own reads are done by the time the model call fails;
      // from then on the store cannot be read.
      agent: flakyRefunds(ran, { on: true }, [], undefined, async () => {
        failReads = true;
      }),
      sessions,
      host,
    });
    let decision: unknown;
    try {
      const asked = await host.deliver({ input: 'refund me', sessionId: 'unread' });
      decision = checkInApproved({ request: pausedRequest(asked.awaiting), by: 'alice' });
      await host.deliver({ input: '', sessionId: 'unread', decision });
      expect(ran).toEqual([10]);
    } finally {
      failReads = false;
      await handle.close();
    }
    expect(readPausedRun(await inner.hydrate('unread')).answered).toEqual({
      at: expect.any(Number),
    });
    const elsewhere = inProcessHost();
    const other = await standingAgent({
      agent: flakyRefunds(ran, { on: false }, [], inMemoryDecisionLedger()),
      sessions: inner,
      host: elsewhere,
    });
    try {
      const retry = await elsewhere.deliver({ input: '', sessionId: 'unread', decision });
      expect(retry.code).toBe('ERR_RESUME_DECISION');
      expect(ran).toEqual([10]);
    } finally {
      await other.close();
    }
  });

  it('a decision delivered after the caller hung up runs nothing and leaves the pause answerable — another process answers it once', async () => {
    const ran: number[] = [];
    const sessions = memorySessions();
    // Two processes share one ledger — two instances over one table, one
    // `storeId` — so a decision is spent in the ledger its request was asked
    // under wherever it is answered.
    const table = new Set<string>();
    const sharedLedger = (): DecisionLedger => ({
      storeId: 'refunds-ledger',
      spend: (key: string) => (table.has(key) ? false : (table.add(key), true)),
      isSpent: (key: string) => table.has(key),
    });
    const host = inProcessHost();
    const handle = await standingAgent({
      agent: flakyRefunds(ran, { on: false }, [], sharedLedger()),
      sessions,
      host,
    });
    let decision: unknown;
    try {
      const asked = await host.deliver({ input: 'refund me', sessionId: 'hung-up' });
      decision = checkInApproved({ request: pausedRequest(asked.awaiting), by: 'alice' });
      const gone = await host.deliver({
        input: '',
        sessionId: 'hung-up',
        decision,
        signal: AbortSignal.abort(),
      });
      expect(gone.output).toBeUndefined();
      await new Promise((done) => setTimeout(done, 20));
      expect(ran).toEqual([]);
    } finally {
      await handle.close();
    }
    // The decision reached no ledger, so the pause is still the person's to answer.
    expect(readPausedRun(await sessions.hydrate('hung-up')).answered).toBeUndefined();
    const elsewhere = inProcessHost();
    const other = await standingAgent({
      agent: flakyRefunds(ran, { on: false }, [], sharedLedger()),
      sessions,
      host: elsewhere,
    });
    try {
      const answered = await elsewhere.deliver({ input: '', sessionId: 'hung-up', decision });
      expect(answered.output).toBe('refund issued');
      expect(ran).toEqual([10]);
    } finally {
      await other.close();
    }
  });

  it('a decline whose resume then fails is recorded as declined — the call did not run', async () => {
    const ran: number[] = [];
    const sessions = memorySessions();
    const host = inProcessHost();
    const sent: (readonly LLMMessage[])[] = [];
    const handle = await standingAgent({
      agent: flakyRefunds(ran, { on: true }, sent),
      sessions,
      host,
    });
    try {
      const asked = await host.deliver({ input: 'refund me', sessionId: 'declined' });
      const decision = checkInDeclined({
        request: pausedRequest(asked.awaiting),
        by: 'alice',
        note: 'wrong account',
      });
      const failed = await host.deliver({ input: '', sessionId: 'declined', decision });
      expect(failed.error).toBeDefined();
      expect(ran).toEqual([]);
      const stored = readPausedRun(await sessions.hydrate('declined'));
      expect(stored.answered).toEqual({ at: expect.any(Number) });
      const results = stored.conversation.history.filter((m) => m.role === 'tool');
      expect(results.map((m) => m.content)).toEqual(['declined by human: wrong account']);
      expect(results[0]?.content).not.toBe(OUTCOME_NOT_RECORDED);
    } finally {
      await handle.close();
    }
  });

  it('a decline refused because an approval already used the request is never recorded as declined — the call may have run', async () => {
    const ran: number[] = [];
    const inner = memorySessions();
    // The approval's mark is refused once: its resume ran the call, failed,
    // and the store did not take the mark.
    let refuseMark = true;
    const sessions: SessionLifecycle = {
      hydrate: (id) => inner.hydrate(id),
      async persist(id, envelope) {
        if (refuseMark && (envelope.data as { answered?: unknown }).answered !== undefined) {
          refuseMark = false;
          throw new Error('store busy');
        }
        return inner.persist(id, envelope);
      },
    };
    const host = inProcessHost();
    const handle = await standingAgent({
      agent: flakyRefunds(ran, { on: true }),
      sessions,
      host,
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const asked = await host.deliver({ input: 'refund me', sessionId: 'raced' });
      const request = pausedRequest(asked.awaiting);
      const approved = await host.deliver({
        input: '',
        sessionId: 'raced',
        decision: checkInApproved({ request, by: 'alice' }),
      });
      expect(approved.error).toBe('model unavailable');
      expect(ran).toEqual([10]);
      const declined = await host.deliver({
        input: '',
        sessionId: 'raced',
        decision: checkInDeclined({ request, by: 'alice', note: 'changed my mind' }),
      });
      expect(declined.code).toBe('ERR_RESUME_DECISION');
      const stored = readPausedRun(await inner.hydrate('raced'));
      expect(stored.answered).toEqual({ at: expect.any(Number) });
      const results = stored.conversation.history.filter((m) => m.role === 'tool');
      expect(results.map((m) => m.content)).toEqual([OUTCOME_NOT_RECORDED]);
    } finally {
      warn.mockRestore();
      await handle.close();
    }
  });

  it('two processes, one shared ledger: a decline that loses to an approval leaves the call not known, not declined', async () => {
    const ran: number[] = [];
    const sessions = memorySessions();
    const shared = inMemoryDecisionLedger();
    // A's next model call after the tool is slow, then fails.
    const slowly = () => new Promise<void>((done) => setTimeout(done, 80));
    const hostA = inProcessHost();
    const a = await standingAgent({
      agent: flakyRefunds(ran, { on: true }, [], shared, slowly),
      sessions,
      host: hostA,
    });
    const hostB = inProcessHost();
    const b = await standingAgent({
      agent: flakyRefunds(ran, { on: false }, [], shared),
      sessions,
      host: hostB,
    });
    try {
      const asked = await hostA.deliver({ input: 'refund me', sessionId: 'two' });
      const request = pausedRequest(asked.awaiting);
      const approving = hostA.deliver({
        input: '',
        sessionId: 'two',
        decision: checkInApproved({ request, by: 'alice' }),
      });
      await new Promise((done) => setTimeout(done, 20));
      const declined = await hostB.deliver({
        input: '',
        sessionId: 'two',
        decision: checkInDeclined({ request, by: 'alice', note: 'no' }),
      });
      expect(declined.code).toBe('ERR_RESUME_DECISION');
      expect((await approving).error).toBe('model unavailable');
      expect(ran).toEqual([10]);
      const stored = readPausedRun(await sessions.hydrate('two'));
      expect(stored.answered).toEqual({ at: expect.any(Number) });
      const results = stored.conversation.history.filter((m) => m.role === 'tool');
      expect(results.map((m) => m.content)).toEqual([OUTCOME_NOT_RECORDED]);
    } finally {
      await a.close();
      await b.close();
    }
  });

  it('an approval whose run ends while the tool’s credential resolves never runs the call — the request is spent', async () => {
    const ran: number[] = [];
    const sessions = memorySessions();
    const host = inProcessHost();
    const usage = { input: 1, output: 1 };
    const agent = Agent.create({
      provider: {
        name: 'mock',
        complete: async (request) =>
          request.messages.some((m) => m.role === 'tool')
            ? { content: 'refund issued', toolCalls: [], usage, stopReason: 'stop' }
            : {
                content: '',
                toolCalls: [{ id: 't1', name: 'issue_refund', args: { amount: 10 } }],
                usage,
                stopReason: 'tool_use',
              },
      },
      model: 'test-model',
      maxIterations: 3,
      credentials: {
        id: 'slow-vault',
        getCredential: async () => {
          await new Promise((done) => setTimeout(done, 120));
          return { status: 'issued', credential: bearer('payments-token') };
        },
      },
    })
      .system('terse')
      .tool(
        defineTool<{ amount: number }, string>({
          name: 'issue_refund',
          description: 'refund a customer',
          inputSchema: { type: 'object', properties: { amount: { type: 'number' } } },
          needs: { credential: 'payments' },
          checkIn: 'always',
          execute: ({ amount }) => {
            ran.push(amount);
            return `refunded ${amount}`;
          },
        }),
      )
      .build();
    const handle = await standingAgent({ agent, sessions, host });
    try {
      const asked = await host.deliver({ input: 'refund me', sessionId: 'left' });
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 30);
      const gone = await host.deliver({
        input: '',
        sessionId: 'left',
        decision: checkInApproved({ request: pausedRequest(asked.awaiting), by: 'alice' }),
        signal: controller.signal,
      });
      expect(gone.output).toBeUndefined();
      await new Promise((done) => setTimeout(done, 200));
      expect(ran).toEqual([]);
      // Spent: no answer reaches it again, and the door says what it knows.
      expect(readPausedRun(await sessions.hydrate('left')).answered).toEqual({
        at: expect.any(Number),
      });
    } finally {
      await handle.close();
    }
  });

  it('when the store cannot take the mark, the process’s ledger still refuses on a rebuilt agent', async () => {
    const ran: number[] = [];
    const failing = { on: true };
    const inner = memorySessions();
    // A store that refuses exactly the write that marks the pause answered.
    const sessions: SessionLifecycle = {
      hydrate: (id) => inner.hydrate(id),
      async persist(id, envelope) {
        if ((envelope.data as { answered?: unknown }).answered !== undefined) {
          throw new Error('store unavailable');
        }
        return inner.persist(id, envelope);
      },
    };
    const host = inProcessHost();
    const handle = await standingAgent({
      agentFactory: () => flakyRefunds(ran, failing),
      sessions,
      host,
      maxActiveSessions: 1,
    });
    try {
      const asked = await host.deliver({ input: 'refund me', sessionId: 'unmarked' });
      const decision = checkInApproved({ request: pausedRequest(asked.awaiting), by: 'alice' });
      const failed = await host.deliver({ input: '', sessionId: 'unmarked', decision });
      // The run's own failure is what the caller hears, not the store's.
      expect(failed.error).toContain('model unavailable');
      expect(readPausedRun(await sessions.hydrate('unmarked')).answered).toBeUndefined();
      failing.on = false;
      await host.deliver({ input: 'hello', sessionId: 'other' }); // evicts the first lane
      const retry = await host.deliver({ input: '', sessionId: 'unmarked', decision });
      expect(retry.code).toBe('ERR_RESUME_DECISION');
      expect(ran).toEqual([10]);
    } finally {
      await handle.close();
    }
  });

  it('over a real socket: the retry is a 409 without the request id, and no answered pause is offered as pending', async () => {
    const { nodeHost } = await import('../../src/hosting/index.js');
    const ran: number[] = [];
    const failing = { on: true };
    const handle = await standingAgent({
      agent: flakyRefunds(ran, failing),
      sessions: memorySessions(),
      host: nodeHost({ port: 0, hostname: '127.0.0.1' }),
    });
    try {
      const post = (body: unknown): Promise<Response> =>
        fetch(`${handle.url}/invoke`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
      const asked = (await (await post({ input: 'refund me', sessionId: 'wire' })).json()) as {
        awaiting: unknown;
      };
      const requestId = pausedRequest(asked.awaiting).id;
      const decision = checkInApproved({ request: pausedRequest(asked.awaiting), by: 'alice' });
      const failed = await post({ input: '', sessionId: 'wire', decision });
      expect(failed.status).toBeGreaterThanOrEqual(500);
      expect(ran).toEqual([10]);

      // Reloading the question finds none: the answered pause is not offered.
      const reload = await post({ op: 'session-pending', sessionId: 'wire' });
      expect(reload.status).toBe(200);
      expect(await reload.json()).toEqual({ pending: null });

      failing.on = false;
      const retry = await post({ input: '', sessionId: 'wire', decision });
      expect(retry.status).toBe(409);
      const body = await retry.text();
      expect(JSON.parse(body)).toMatchObject({ code: 'ERR_RESUME_DECISION' });
      expect(body).not.toContain(requestId);
      expect(ran).toEqual([10]);
    } finally {
      await handle.close();
    }
  });
});

describe('a paused session — a pause no answer can ever reach does not hold the session', () => {
  const usage = { input: 1, output: 1 };

  /** Answers a refund request with one call; anything else is noted back. */
  function refundsModel(sent: (readonly LLMMessage[])[]): LLMProvider {
    return {
      name: 'mock',
      complete: async (request) => {
        sent.push([...request.messages]);
        const last = request.messages[request.messages.length - 1];
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

  function refundTool(ran: number[], checkIn: boolean) {
    return defineTool<{ amount: number }, string>({
      name: 'issue_refund',
      description: 'refund a customer',
      inputSchema: {
        type: 'object',
        properties: { amount: { type: 'number' } },
        required: ['amount'],
      },
      ...(checkIn && { checkIn: 'always' as const }),
      execute: ({ amount }) => {
        ran.push(amount);
        return `refunded ${amount}`;
      },
    });
  }

  /** An agent whose `approval` link asks before every refund, and `later` runs after it. */
  function asking(later: string, ran: number[], sent: (readonly LLMMessage[])[]): Agent {
    return Agent.create({ provider: refundsModel(sent), model: 'test-model', maxIterations: 4 })
      .system('terse')
      .tool(refundTool(ran, false))
      .toolMiddleware(
        { name: 'approval', onToolCall: () => ask({ question: 'Issue this refund?' }) },
        { name: later, onToolCall: () => allow() },
      )
      .build();
  }

  /** What the model was shown for every tool call, in the newest request it got. */
  const toolResultsSeen = (sent: (readonly LLMMessage[])[]): unknown[] =>
    (sent[sent.length - 1] ?? []).filter((m) => m.role === 'tool').map((m) => m.content);

  /** Pause a session on `before`, then serve the same store with `after` (a redeploy). */
  async function redeployed(
    before: Agent,
    after: Agent,
    sessionId: string,
  ): Promise<{
    pending: PendingAsk;
    host: ReturnType<typeof inProcessHost>;
    close: () => Promise<void>;
    sessions: ReturnType<typeof memorySessions>;
  }> {
    const sessions = memorySessions();
    const first = inProcessHost();
    const old = await standingAgent({ agent: before, sessions, host: first });
    let pending: PendingAsk | undefined;
    try {
      pending = (await first.deliver({ input: 'refund me', sessionId })).awaiting;
    } finally {
      await old.close();
    }
    if (pending === undefined) throw new Error('expected a pause');
    const host = inProcessHost();
    const handle = await standingAgent({ agent: after, sessions, host });
    return { pending, host, close: () => handle.close(), sessions };
  }

  it('after a redeploy renamed a rule after the ask, the next message continues — the model is told the call did not run', async () => {
    const ran: number[] = [];
    const sent: (readonly LLMMessage[])[] = [];
    const { host, close, sessions } = await redeployed(
      asking('limit', ran, sent),
      asking('limit-v2', ran, sent),
      'renamed',
    );
    try {
      const next = await host.deliver({ input: 'forget it — my balance?', sessionId: 'renamed' });
      expect(next.code).toBeUndefined();
      expect(next.output).toBe('noted: forget it — my balance?');
      expect(toolResultsSeen(sent)).toEqual([NOT_RUN_UNANSWERABLE]);
      expect(ran).toEqual([]);
      expect((await sessions.hydrate('renamed'))?.format).toBe('conversation-v1');
    } finally {
      await close();
    }
  });

  it('an approval or a decline of it is refused by name — and closes it, so the next message continues', async () => {
    const ran: number[] = [];
    const sent: (readonly LLMMessage[])[] = [];
    const { pending, host, close } = await redeployed(
      asking('limit', ran, sent),
      asking('limit-v2', ran, sent),
      'refused',
    );
    try {
      const approve = await host.deliver({
        input: '',
        sessionId: 'refused',
        decision: checkInApproved({ request: pending.ask!, by: 'alice' }),
      });
      expect(approve.code).toBe('ERR_RESUME_DECISION');
      expect(REFUSAL_STATUS[approve.code!]).toBe(409);
      expect(approve.error).toContain('the next message continues the conversation');
      const decline = await host.deliver({
        input: '',
        sessionId: 'refused',
        decision: checkInDeclined({ request: pending.ask!, by: 'alice' }),
      });
      expect(decline.code).toBe('ERR_NO_PENDING_ASK');
      const next = await host.deliver({ input: 'what else?', sessionId: 'refused' });
      expect(next.output).toBe('noted: what else?');
      expect(toolResultsSeen(sent)).toEqual([NOT_RUN_UNANSWERABLE]);
      expect(ran).toEqual([]);
    } finally {
      await close();
    }
  });

  it('a check-in stored by an earlier release (no request recorded) closes on the next message', async () => {
    const ran: number[] = [];
    const sent: (readonly LLMMessage[])[] = [];
    const agent = () =>
      Agent.create({ provider: refundsModel(sent), model: 'test-model', maxIterations: 4 })
        .system('terse')
        .tool(refundTool(ran, true))
        .build();
    const sessions = memorySessions();
    const host = inProcessHost();
    const handle = await standingAgent({ agent: agent(), sessions, host });
    try {
      await host.deliver({ input: 'refund me', sessionId: 'older' });
      // What an earlier release stored: no request record, and no id to show.
      const stored = readPausedRun(await sessions.hydrate('older'));
      const { pausedRequest: _record, ...state } = stored.checkpoint.sharedState as Record<
        string,
        unknown
      >;
      void _record;
      const { id: _id, ...checkIn } = stored.pending.checkIn as unknown as Record<string, unknown>;
      void _id;
      await sessions.persist(
        'older',
        toPausedEnvelope({
          ...stored,
          checkpoint: { ...stored.checkpoint, sharedState: state },
          pending: { ...stored.pending, checkIn: checkIn as never },
        }),
      );
      const refused = await host.deliver({
        input: '',
        sessionId: 'older',
        decision: { approved: true, by: 'alice', at: 1 },
      });
      expect(refused.code).toBe('ERR_RESUME_DECISION');
      const next = await host.deliver({ input: 'never mind', sessionId: 'older' });
      expect(next.output).toBe('noted: never mind');
      // It names no request, so no ledger can prove a decision for it was
      // never used — an earlier release may have run the call and kept the
      // pause: the outcome is recorded as not known, never as "did not run".
      expect(toolResultsSeen(sent)).toEqual([OUTCOME_UNKNOWN_UNANSWERABLE]);
      expect(ran).toEqual([]);
    } finally {
      await handle.close();
    }
  });

  it('a plain message is enough: no answer has to be tried first', async () => {
    const ran: number[] = [];
    const sent: (readonly LLMMessage[])[] = [];
    const agent = () =>
      Agent.create({ provider: refundsModel(sent), model: 'test-model', maxIterations: 4 })
        .system('terse')
        .tool(refundTool(ran, true))
        .build();
    const sessions = memorySessions();
    const host = inProcessHost();
    const handle = await standingAgent({ agent: agent(), sessions, host });
    try {
      await host.deliver({ input: 'refund me', sessionId: 'plain' });
      const stored = readPausedRun(await sessions.hydrate('plain'));
      const { pausedRequest: _record, ...state } = stored.checkpoint.sharedState as Record<
        string,
        unknown
      >;
      void _record;
      await sessions.persist(
        'plain',
        toPausedEnvelope({ ...stored, checkpoint: { ...stored.checkpoint, sharedState: state } }),
      );
      const next = await host.deliver({ input: 'never mind', sessionId: 'plain' });
      expect(next.output).toBe('noted: never mind');
      // The record removed carried the ledger the request was minted under:
      // nothing can prove the call never ran, so it may have run.
      expect(toolResultsSeen(sent)).toEqual([OUTCOME_UNKNOWN_UNANSWERABLE]);
      // A pause that CAN still be answered keeps holding the session.
      await host.deliver({ input: 'refund me again', sessionId: 'plain' });
      const held = await host.deliver({ input: 'hello?', sessionId: 'plain' });
      expect(held.code).toBe('ERR_AWAITING_DECISION');
      expect(ran).toEqual([]);
    } finally {
      await handle.close();
    }
  });
});

describe('a paused session — no refusal carries the live request id, even serialized whole', () => {
  const usage = { input: 1, output: 1 };

  /**
   * A host that hands back the refusal OBJECT a request ended with — what a
   * logger, a crash reporter or `JSON.stringify(err)` reads, not only its
   * message.
   */
  function refusalHost(): {
    readonly host: AgentHost;
    deliver(request: HostRequest): Promise<{ awaiting?: PendingAsk; failed?: Error }>;
  } {
    let handler: HostHandler | undefined;
    return {
      host: {
        name: 'refusalHost',
        capabilities: [],
        serve(incoming: HostHandler): Promise<HostHandle> {
          handler = incoming;
          return Promise.resolve({ close: () => Promise.resolve() });
        },
      },
      async deliver(request) {
        const seen: { awaiting?: PendingAsk; failed?: Error } = {};
        const reply: HostReply = {
          complete: () => undefined,
          awaiting: (pending) => void (seen.awaiting = pending),
          fail: (err) => void (seen.failed = err),
        };
        try {
          await handler!(request, reply);
        } catch (err) {
          seen.failed = err as Error;
        }
        return seen;
      },
    };
  }

  /** Asks before every refund; after a tool result it fails once when told to. */
  function refundsModel(failAfterTool: { next: boolean }): LLMProvider {
    return {
      name: 'mock',
      complete: async (request) => {
        const last = request.messages[request.messages.length - 1];
        if (last?.role === 'tool' && failAfterTool.next) {
          failAfterTool.next = false;
          throw new Error('model unavailable');
        }
        return last?.role === 'user' && String(last.content).includes('refund')
          ? {
              content: '',
              toolCalls: [{ id: 't1', name: 'issue_refund', args: { amount: 10 } }],
              usage,
              stopReason: 'tool_use',
            }
          : { content: 'noted', toolCalls: [], usage, stopReason: 'stop' };
      },
    };
  }

  it('JSON.stringify of every refusal a client can provoke names no live id — the pending ask still reads', async () => {
    const ran: number[] = [];
    const failAfterTool = { next: false };
    const refund = defineTool<{ amount: number }, string>({
      name: 'issue_refund',
      description: 'refund a customer',
      inputSchema: { type: 'object', properties: { amount: { type: 'number' } } },
      checkIn: 'always',
      execute: ({ amount }) => {
        ran.push(amount);
        return `refunded ${amount}`;
      },
    });
    const { host, deliver } = refusalHost();
    const handle = await standingAgent({
      agent: Agent.create({ provider: refundsModel(failAfterTool), model: 'm', maxIterations: 4 })
        .system('terse')
        .tool(refund)
        .build(),
      sessions: memorySessions(),
      host,
    });
    const refusals: [string, Error | undefined][] = [];
    try {
      const asked = await deliver({ input: 'refund me', sessionId: 'leak' });
      const id = asked.awaiting?.checkIn?.id;
      expect(id).toMatch(/^[0-9a-f]{64}$/);
      const decision = checkInApproved({ request: asked.awaiting!.checkIn!, by: 'maya' });

      const waiting = await deliver({ input: 'hello?', sessionId: 'leak' });
      refusals.push(['a message while a question waits', waiting.failed]);
      refusals.push([
        'an old-format decision',
        (
          await deliver({
            input: '',
            sessionId: 'leak',
            decision: { approved: true, by: 'x', at: 1 },
          })
        ).failed,
      ]);
      refusals.push([
        'a decision for another request',
        (
          await deliver({
            input: '',
            sessionId: 'leak',
            decision: { requestId: 'f'.repeat(64), approved: true, by: 'x', at: 1 },
          })
        ).failed,
      ]);
      refusals.push([
        'a value that is not a decision',
        (await deliver({ input: '', sessionId: 'leak', decision: 'yes' })).failed,
      ]);
      // A resume that used the decision and then failed: the pause is answered.
      failAfterTool.next = true;
      expect((await deliver({ input: '', sessionId: 'leak', decision })).failed?.message).toBe(
        'model unavailable',
      );
      refusals.push([
        'the same decision again',
        (await deliver({ input: '', sessionId: 'leak', decision })).failed,
      ]);
      expect((await deliver({ input: 'thanks', sessionId: 'leak' })).failed).toBeUndefined();
      refusals.push([
        'a decision with nothing pending',
        (await deliver({ input: '', sessionId: 'leak', decision })).failed,
      ]);

      expect(refusals.map(([, err]) => (err as { code?: string } | undefined)?.code)).toEqual([
        'ERR_AWAITING_DECISION',
        'ERR_RESUME_DECISION',
        'ERR_RESUME_DECISION',
        'ERR_DECISION_REQUIRED',
        'ERR_RESUME_DECISION',
        'ERR_NO_PENDING_ASK',
      ]);
      for (const [what, err] of refusals) {
        expect(JSON.stringify(err), what).not.toContain(id);
        expect(`${String(err)} ${err!.message}`, what).not.toContain(id);
      }
      // Kept off the serialized error, not off the error: the code that caught
      // it still reads the pending ask it names.
      expect(waiting.failed).toBeInstanceOf(AwaitingDecisionError);
      expect((waiting.failed as AwaitingDecisionError).pending.checkIn?.id).toBe(id);
      expect(Object.keys(waiting.failed!)).not.toContain('pending');
      expect(ran).toEqual([10]);
    } finally {
      await handle.close();
    }
  });
});

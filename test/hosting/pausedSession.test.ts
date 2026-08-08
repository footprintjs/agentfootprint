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

import { describe, expect, it } from 'vitest';

import { Agent, ask, defineTool } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { askHuman } from '../../src/core/pause.js';
import { checkInApproved, checkInDeclined } from '../../src/core/checkin.js';
import {
  memorySessions,
  readEnvelope,
  readPausedRun,
  standingAgent,
  toEnvelope,
} from '../../src/hosting/index.js';
import type { CheckpointEnvelope, SessionLifecycle, WakeReason } from '../../src/hosting/index.js';
import type { LLMProvider } from '../../src/adapters/types.js';
import { inProcessHost } from './testHost.js';

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
        decision: checkInApproved({ by: 'alice@ops' }),
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
        decision: checkInDeclined({ by: 'alice@ops', note: 'too high' }),
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
      await host.deliver({ input: '', sessionId: 'c', decision: checkInApproved({ by: 'a' }) });
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
        decision: checkInApproved({ by: 'alice' }),
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
      await host.deliver({ input: '', sessionId: 'w', decision: checkInApproved({ by: 'a' }) });
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
      await host.deliver({ input: '', sessionId: 'once', decision: checkInApproved({ by: 'a' }) });
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
        decision: checkInApproved({ by: 'alice' }),
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
      expect(asked.awaiting?.ask).toEqual({ question: 'sure?', middleware: 'four-eyes' });
      expect(ran).toEqual([]);
      const done = await host.deliver({
        input: '',
        sessionId: 'm',
        decision: checkInApproved({ by: 'alice' }),
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
        decision: checkInApproved({ by: 'alice' }),
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
        decision: checkInApproved({ by: 'alice' }),
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
        decision: checkInApproved({ by: 'alice@ops' }),
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

      expect((await post({ input: 'refund me', sessionId: 'h-gate' })).status).toBe(202);

      const wrong = await post({ input: '', sessionId: 'h-gate', decision: 'yes' });
      expect(wrong.status).toBe(400);
      expect((await wrong.json()) as { code: string }).toMatchObject({
        code: 'ERR_DECISION_REQUIRED',
      });

      const done = await post({
        input: '',
        sessionId: 'h-gate',
        decision: checkInApproved({ by: 'alice' }),
      });
      expect(done.status).toBe(200);
    } finally {
      await handle.close();
    }
  });
});

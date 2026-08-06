/**
 * deploy/durable-sessions — a run that survives a crash, and a pause that
 * survives the request.
 *
 * Two things a standing agent needs once it is real, both on the ports
 * `agentfootprint/hosting` already had:
 *
 *   durability      — how often progress becomes crash-survivable.
 *   'flowchart-v1'  — a paused run stored, and continued by a later request.
 *
 * ── durability ──────────────────────────────────────────────────────────────
 *   'exit'  (default) — one write when the run finishes. A crash costs the turn.
 *   'async'           — a write is started whenever the conversation changes and
 *                       never waited on. The run never slows down.
 *   'sync'            — persist-then-proceed: iteration N's TOOLS do not run
 *                       until iteration N-1's write has landed. A crash costs
 *                       the current iteration, and nothing before it.
 *
 * ── a pause ─────────────────────────────────────────────────────────────────
 * A run has three ends: it answered, it asked a person something, or it failed.
 * A pause leaves through `reply.awaiting(...)` — 202 over HTTP — never through
 * `fail`, and the paused run is stored. A later request carrying `decision`
 * continues it. The presence of that field is what makes a request a resume;
 * reading approval out of prose would be a guess.
 *
 * ── unreadable ≠ absent ─────────────────────────────────────────────────────
 * A session with nothing stored is answered fresh. A session whose stored bytes
 * cannot be READ is refused by name instead, because those are different facts
 * and only one of them is safe to answer with a fresh start.
 *
 * This file is its own integration test: it binds an ephemeral port, crashes a
 * run on purpose and shows what survived, holds a human-in-the-loop turn over
 * HTTP end to end, proves an unreadable session is refused rather than restarted,
 * and exits. No credentials, no network.
 *
 * Run:  npm run example examples/deploy/durable-sessions.ts
 */

import { Agent, checkInApproved, defineTool, type LLMProvider } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import {
  memorySessions,
  nodeHost,
  readEnvelope,
  standingAgent,
  toEnvelope,
  type SessionLifecycle,
} from '../../src/doors/hosting.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'deploy/durable-sessions',
  title: 'Durable sessions — a crash-survivable run, and a pause that persists',
  group: 'deploy',
  description:
    "standingAgent({ durability: 'sync' }) makes progress crash-survivable one iteration at a time, and a run that stops to ask a person is stored as 'flowchart-v1' and answered by a later request carrying a decision (202 → 200 over HTTP).",
  defaultInput: 'Refund my order.',
  providerSlots: ['default'],
  tags: ['deploy', 'hosting', 'durability', 'human-in-the-loop', 'pause-resume'],
};

// ─── Part 1: what survives a crash ───────────────────────────────────

/** A tool with a real side effect, so "did it run twice?" is answerable. */
function ledgerTool(entries: string[]) {
  return defineTool<{ note: string }, string>({
    name: 'write_ledger',
    description: 'append one line to the accounting ledger',
    inputSchema: {
      type: 'object',
      properties: { note: { type: 'string' } },
      required: ['note'],
    },
    execute: ({ note }) => {
      entries.push(note);
      return Promise.resolve(`wrote "${note}"`);
    },
  });
}

/** Answers with two tool calls, then the vendor goes away mid-turn. */
function diesAfterTwoIterations(): LLMProvider {
  let calls = 0;
  return {
    name: 'flaky-vendor',
    complete() {
      calls++;
      if (calls >= 3) return Promise.reject(new Error('vendor went away'));
      return Promise.resolve({
        content: '',
        toolCalls: [{ id: `t${calls}`, name: 'write_ledger', args: { note: `entry-${calls}` } }],
        usage: { input: 1, output: 1 },
        stopReason: 'tool_use',
      });
    },
  };
}

// #region durability
/** Serve one agent whose progress is durable one iteration at a time. */
async function serveDurable(agent: Agent, sessions: SessionLifecycle, port: number) {
  return standingAgent({
    agent,
    sessions, // swap for Redis; nothing else changes
    host: nodeHost({ port, hostname: '127.0.0.1' }),
    // 'sync' — iteration N's tools do not run until iteration N-1's write has
    // landed. You pay the store's latency once per iteration, knowingly, and
    // the amount a crash can re-run has a number: the current iteration.
    durability: 'sync',
  });
}
// #endregion durability

async function whatSurvivedTheCrash(): Promise<Record<string, unknown>> {
  const ledger: string[] = [];
  const sessions = memorySessions();
  const agent = Agent.create({
    provider: diesAfterTwoIterations(),
    model: 'mock',
    maxIterations: 5,
  })
    .system('You keep the books.')
    .tool(ledgerTool(ledger))
    .build();

  const handle = await serveDurable(agent, sessions, 0);
  let failure = '';
  try {
    const response = await fetch(`${handle.url}/invoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: 'reconcile the books', sessionId: 'books' }),
    });
    failure = ((await response.json()) as { error?: string }).error ?? '';
  } finally {
    // The "crash": everything but the store goes away.
    await handle.close();
  }

  const stored = await sessions.hydrate('books');
  const conversation = readEnvelope(stored);
  const toolResults = conversation.history.filter((m) => m.role === 'tool').map((m) => m.content);

  return {
    theRunFailedWith: failure.slice(0, 40),
    sideEffectsPerformed: ledger,
    // The tool results are IN the store. A replay reads them and does not
    // re-issue those calls — which is what paying the latency buys.
    toolResultsThatSurvived: toolResults,
    nothingWasLost: toolResults.length === ledger.length,
  };
}

// ─── Part 2: a pause that persists ───────────────────────────────────

function refundAgent(): Agent {
  const refund = defineTool<{ amount: number }, string>({
    name: 'refund',
    description: 'refund a customer',
    inputSchema: {
      type: 'object',
      properties: { amount: { type: 'number' } },
      required: ['amount'],
    },
    // `checkIn` asks a person BEFORE the money moves, and the ask carries the
    // receipts: what this will do, what context the run read, what drove it.
    checkIn: 'always',
    execute: ({ amount }) => Promise.resolve(`refunded $${amount}`),
  });
  return Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'r1', name: 'refund', args: { amount: 40 } }] },
        { content: "Done — I've refunded $40 to your card." },
      ],
    }),
    model: 'mock',
    maxIterations: 3,
  })
    .system('You handle refunds. Always refund when asked.')
    .tool(refund)
    .build();
}

// #region hitl
/** One request. `decision` is what makes it a resume rather than a new message. */
async function invoke(
  base: string,
  sessionId: string,
  body: { input: string; decision?: unknown },
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(`${base}/invoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, sessionId }),
  });
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}
// #endregion hitl

async function aPauseThatPersists(input: string): Promise<Record<string, unknown>> {
  const sessions = memorySessions();
  const handle = await standingAgent({
    agent: refundAgent(),
    sessions,
    host: nodeHost({ port: 0, hostname: '127.0.0.1' }),
  });

  try {
    // 1. The run stops to ask. 202 Accepted: understood, acted on, unfinished.
    const asked = await invoke(handle.url, 'r-1', { input });
    const pending = asked.json.awaiting as {
      tool?: string;
      checkIn?: { evidence: { willDo: string } };
    };

    // 2. It is STORED. An old runtime would refuse this format by name rather
    //    than half-restore it — which is what the format field is for.
    const storedFormat = (await sessions.hydrate('r-1'))?.format;

    // 3. A plain message while a question is outstanding is refused, naming the
    //    ask. The message is not run and the pause is not discarded.
    const nudged = await invoke(handle.url, 'r-1', { input: 'hello? anyone there?' });

    // 4. A person decides, and the run finishes. The REAL tool runs now — the
    //    human's answer is a decision, never the tool's result.
    const done = await invoke(handle.url, 'r-1', {
      input: '',
      decision: checkInApproved({ by: 'alice@ops', note: 'verified with customer' }),
    });

    return {
      askedWithStatus: asked.status, // 202, not 200 and not 500
      askedAboutTool: pending?.tool,
      theReceipts: pending?.checkIn?.evidence.willDo,
      storedAs: storedFormat, // 'flowchart-v1'
      // The reply carries the question. It never carries the run's state.
      replyCarriedNoCheckpoint: !('checkpoint' in (pending ?? {})),
      nudgeWasRefusedWith: nudged.json.code, // ERR_AWAITING_DECISION
      resumedWithStatus: done.status, // 200
      answer: done.json.output,
      sessionIsAConversationAgain: (await sessions.hydrate('r-1'))?.format,
    };
  } finally {
    await handle.close();
  }
}

// ─── Part 3: unreadable is not absent ────────────────────────────────
//
// The third thing a standing agent needs once it is real: a store that hands
// back bytes this runtime cannot read must NOT be answered with a fresh
// conversation. An unreadable stored conversation and an absent one are
// different facts, and only one of them is safe to answer with a fresh start.

// #region unreadable
/**
 * A store holding a session it can no longer read — what you get from a backend
 * that stringified the envelope in its own format on the way in.
 */
function aStoreThatMangledIt(): SessionLifecycle & { writes: () => number } {
  let writes = 0;
  return {
    writes: () => writes,
    hydrate: (sessionId) =>
      Promise.resolve(
        sessionId === 'mangled'
          ? // Present, and not an envelope. NOT `undefined` — that would be a
            // claim this session has never been used.
            ('{format=conversation-v1, data={version=1, history=[]}}' as unknown as ReturnType<
              typeof toEnvelope
            >)
          : undefined,
      ),
    persist: () => {
      writes++;
      return Promise.resolve();
    },
  };
}

async function unreadableIsNotAbsent(): Promise<Record<string, unknown>> {
  let modelCalls = 0;
  const inner = mock({ reply: 'this must never be produced' });
  const provider: LLMProvider = {
    name: inner.name,
    complete: (request) => {
      modelCalls++;
      return inner.complete(request);
    },
  };
  const sessions = aStoreThatMangledIt();
  const handle = await standingAgent({
    agent: Agent.create({ provider, model: 'mock' }).system('You are terse.').build(),
    sessions,
    host: nodeHost({ port: 0, hostname: '127.0.0.1' }),
  });

  try {
    const refused = await invoke(handle.url, 'mangled', { input: 'where were we?' });
    // Read the counters HERE: the fresh turn below legitimately calls the model
    // and writes, and folding the two together would prove nothing.
    const calledTheModel = modelCalls > 0;
    const wroteAnything = sessions.writes() > 0;

    // A session this store has nothing for is still answered fresh — that is
    // the other fact, and it has to keep working.
    const fresh = await invoke(handle.url, 'brand-new', { input: 'hello' });

    return {
      // 500, and deliberately: unlike every other hosting refusal this one is
      // something broken on the server's side, not a conflict the caller can
      // resolve by sending something else.
      refusedWithStatus: refused.status,
      refusedWithCode: refused.json.code, // ERR_UNREADABLE_ENVELOPE
      refusalNamesTheSession: String(refused.json.error).includes("session 'mangled'"),
      // The two things a silent fresh start would have done, and neither did.
      modelWasNeverCalled: !calledTheModel,
      nothingWasWrittenOverIt: !wroteAnything,
      // …while a session with nothing stored is ordinary.
      aBrandNewSessionStillAnswers: fresh.status === 200 && typeof fresh.json.output === 'string',
    };
  } finally {
    await handle.close();
  }
}
// #endregion unreadable

export async function run(input: string, _provider?: LLMProvider): Promise<unknown> {
  return {
    crashSurvival: await whatSurvivedTheCrash(),
    humanInTheLoop: await aPauseThatPersists(input),
    unreadableIsNotAbsent: await unreadableIsNotAbsent(),
  };
}

if (isCliEntry(import.meta.url)) {
  void run(meta.defaultInput!).then(printResult);
}

/**
 * deploy/sqlite-sessions — conversations and paused runs that outlive the
 * process, in one file, with nothing to install.
 *
 * `memorySessions()` keeps conversations in a `Map` and says what that costs in
 * its own docstring: restart and they are gone. The next step used to be "bring
 * a Redis". `sqliteSessions({ file })` is the step in between — the same
 * `SessionLifecycle` port, backed by Node's built-in `node:sqlite`, so a
 * restart, a crash or a deploy does not lose the conversation.
 *
 * ── What it is, and what it is not ──────────────────────────────────────────
 * One process (or a few) on ONE machine, writing ONE file. It survives anything
 * that ends the process and leaves the disk alone. It is **not** a distributed
 * store: WAL gives you readers plus one writer at a time, which is plenty for a
 * box and is not a fleet. When you outgrow it you change one argument to
 * `standingAgent`, which is the entire point of the port.
 *
 * ── The version floor, said out loud ────────────────────────────────────────
 * `node:sqlite` ships with Node 22.5+. This package still supports Node 20, so
 * the store refuses BY NAME on a Node that does not have it rather than falling
 * back to memory — a store that silently forgot every conversation on restart
 * looks, from the outside, exactly like a brand-new user. This example prints
 * that refusal instead of failing when it runs on Node 20.
 *
 * This file is its own integration test: it binds an ephemeral port, throws
 * away everything but the file and serves the same session again, holds a
 * human-in-the-loop turn across that boundary, proves an unreadable store is
 * refused rather than restarted, and cleans up after itself. No credentials, no
 * network.
 *
 * Run:  npm run example examples/deploy/sqlite-sessions.ts
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Agent, defineTool, isPaused, type LLMProvider } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { askHuman } from '../../src/core/pause.js';
import { checkInApproved } from '../../src/core/checkin.js';
import {
  nodeHost,
  readEnvelope,
  readPausedRun,
  sqliteSessions,
  standingAgent,
  toPausedEnvelope,
  SqliteUnavailableError,
  UnreadableSessionFileError,
  type SqliteSessions,
} from '../../src/hosting/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'deploy/sqlite-sessions',
  title: 'SQLite sessions — a conversation, and a paused run, that survive a restart',
  group: 'deploy',
  description:
    'sqliteSessions({ file }) is the SessionLifecycle port backed by Node\'s built-in node:sqlite: conversations and runs paused waiting on a person live in one file, so a restart or a deploy does not lose them. Zero dependencies; one machine, one file, one writer at a time.',
  defaultInput: 'Refund my order.',
  providerSlots: ['default'],
  tags: ['deploy', 'hosting', 'sessions', 'durability', 'sqlite', 'pause-resume'],
};

// ─── Part 1: a conversation that survives the process ────────────────

// #region store
/** The whole change from an in-memory deployment: which store gets passed. */
function openStore(file: string): SqliteSessions {
  return sqliteSessions({
    file, // created if missing, along with its parent directory
    busyTimeoutMs: 5000, // how long a write waits for another writer's lock
  });
}
// #endregion store

async function aConversationThatSurvivesARestart(file: string): Promise<Record<string, unknown>> {
  // One provider across both "processes" — a stand-in for the fact that a real
  // model is stateless and the conversation is what the store is keeping.
  const provider = mock({
    replies: [{ content: 'Nice to meet you, Ada.' }, { content: 'You told me: Ada.' }],
  });
  const newAgent = (): Agent =>
    Agent.create({ provider, model: 'mock' }).system('You remember names.').build();

  const before = openStore(file);
  const first = await standingAgent({
    agent: newAgent(),
    sessions: before,
    host: nodeHost({ port: 0, hostname: '127.0.0.1' }),
  });
  const hello = await invoke(first.url, 'user-7', { input: 'my name is Ada' });
  await first.close();
  before.close(); // ← the process ends. Everything but the file is gone.

  // A new process: new host, new agent, new store — same path on disk.
  const after = openStore(file);
  const second = await standingAgent({
    agent: newAgent(),
    sessions: after,
    host: nodeHost({ port: 0, hostname: '127.0.0.1' }),
  });
  try {
    const recall = await invoke(second.url, 'user-7', { input: 'what is my name?' });
    const stored = readEnvelope(await after.hydrate('user-7'));
    return {
      journalMode: after.journalMode, // 'wal' — read back, not assumed
      firstProcessSaid: hello.json.output,
      secondProcessSaid: recall.json.output,
      // The proof: the second process answered from a conversation it never had.
      conversationSurvived: stored.history.some((m) => String(m.content).includes('Ada')),
      turnsInTheStore: stored.history.length,
    };
  } finally {
    await second.close();
    after.close();
  }
}

// ─── Part 2: a pause that outlives the process ───────────────────────

function refundAgent(ran: string[], replies: Parameters<typeof mock>[0]): Agent {
  const refund = defineTool<{ amount: number }, string>({
    name: 'refund',
    description: 'refund a customer',
    inputSchema: {
      type: 'object',
      properties: { amount: { type: 'number' } },
      required: ['amount'],
    },
    execute: ({ amount }) => {
      ran.push(`refund:${amount}`); // a real side effect, so "twice?" is answerable
      return askHuman({ question: `Approve a $${amount} refund?` });
    },
  });
  return Agent.create({ provider: mock(replies), model: 'mock', maxIterations: 3 })
    .system('You handle refunds.')
    .tool(refund)
    .build();
}

// #region pause
/**
 * Store a run that stopped to ask a person. `toPausedEnvelope` packs the three
 * pieces a session needs — what continues it, what it has said, what it waits
 * on — and the store keeps them under the session id.
 */
async function keepThePause(
  sessions: SqliteSessions,
  sessionId: string,
  agent: Agent,
  paused: { checkpoint: unknown; pauseData: unknown },
): Promise<void> {
  await sessions.persist(
    sessionId,
    toPausedEnvelope({
      checkpoint: paused.checkpoint as never,
      conversation: agent.checkpoint()!,
      pending: { sessionId, tool: 'refund', pauseData: paused.pauseData },
    }),
  );
}
// #endregion pause

async function aPauseThatOutlivesTheProcess(
  file: string,
  input: string,
): Promise<Record<string, unknown>> {
  const ran: string[] = [];

  // ── the process that asks ───────────────────────────────────────────
  const asking = refundAgent(ran, {
    replies: [
      { toolCalls: [{ id: 'r1', name: 'refund', args: { amount: 40 } }] },
      { content: "Done — I've refunded $40." },
    ],
  });
  const outcome = await asking.run({ message: input });
  if (!isPaused(outcome)) throw new Error('expected the refund tool to ask a person');

  const writer = openStore(file);
  await keepThePause(writer, 'refund-1', asking, outcome);
  const storedAs = (await writer.hydrate('refund-1'))?.format;
  writer.close(); // …and this process ends, holding a question open.

  // ── the process that answers, a deploy later ────────────────────────
  const reader = openStore(file);
  try {
    const paused = readPausedRun(await reader.hydrate('refund-1'));
    // A fresh agent: its model answers from the restored conversation, which
    // already contains the tool call and the decision now attached to it.
    const answering = refundAgent(ran, { replies: [{ content: "Done — I've refunded $40." }] });
    const answer = await answering.resume(
      paused.checkpoint,
      checkInApproved({ by: 'alice@ops', note: 'verified with the customer' }),
    );

    return {
      askedWith: (outcome.pauseData as { question?: string }).question,
      storedAs, // 'flowchart-v1'
      answeredInAnotherProcess: answer,
      // A resume is not a replay: the tool that ran before the pause did not
      // run a second time on the way back.
      sideEffectsPerformed: ran,
      theToolRanExactlyOnce: ran.length === 1,
    };
  } finally {
    reader.close();
  }
}

// ─── Part 3: unreadable is not absent ────────────────────────────────

// #region unreadable
/**
 * A store whose file exists and is not a database. Opening it as an EMPTY one
 * would hand every returning user a blank slate and log nothing — so it refuses
 * by name, at construction, where the caller can still act.
 */
async function unreadableIsNotAbsent(directory: string): Promise<Record<string, unknown>> {
  const wrong = join(directory, 'not-a-database.db');
  await writeFile(wrong, 'a log file somebody pointed the store at\n'.repeat(10), 'utf8');

  try {
    openStore(wrong);
    return { refused: false };
  } catch (err) {
    if (!(err instanceof UnreadableSessionFileError)) throw err;
    return {
      refused: true,
      code: err.code, // ERR_UNREADABLE_SESSION_FILE
      problem: err.problem, // 'cannot-open' — vs 'newer-schema' / 'not-our-schema'
      refusalNamesTheFile: err.message.includes(wrong),
    };
  }
}
// #endregion unreadable

// ─── Plumbing ────────────────────────────────────────────────────────

/** One request. `decision` is what would make it a resume rather than a message. */
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

export async function run(input: string, _provider?: LLMProvider): Promise<unknown> {
  const directory = await mkdtemp(join(tmpdir(), 'afp-sqlite-example-'));
  const file = join(directory, 'sessions.db');
  try {
    return {
      restartProofConversation: await aConversationThatSurvivesARestart(file),
      pauseThatOutlivesTheProcess: await aPauseThatOutlivesTheProcess(file, input),
      unreadableIsNotAbsent: await unreadableIsNotAbsent(directory),
    };
  } catch (err) {
    if (!(err instanceof SqliteUnavailableError)) throw err;
    // Node 20 has no `node:sqlite`. The refusal IS the lesson: no fallback to a
    // store that forgets, and a message naming what to do about it.
    return {
      ranOnThisNode: false,
      nodeVersion: err.nodeVersion,
      code: err.code, // ERR_SQLITE_UNAVAILABLE
      refusal: err.message,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (isCliEntry(import.meta.url)) {
  void run(meta.defaultInput!).then(printResult);
}

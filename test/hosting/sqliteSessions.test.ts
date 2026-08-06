/**
 * sqliteSessions — 7-pattern tests
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * The laws being pinned:
 *   • A real file, written and read back — including by a SECOND store instance
 *     that never saw the first. That is the whole claim of the feature, and a
 *     second instance on the same path is the only honest way to state it.
 *   • A run that PAUSED, stored, reloaded from the file by a new store, and
 *     RESUMED to completion — with the tool that ran before the pause not
 *     running a second time.
 *   • Unreadable ≠ absent, at both levels: a file that is not a database is
 *     refused BY NAME, and so is a row whose payload this runtime cannot read.
 *     Only a session that was never written hydrates as `undefined`.
 *   • A store written by a newer runtime, and somebody else's table of the same
 *     name, are both refused by name rather than half-used.
 *   • Two stores on one file see each other's writes (WAL), and the journal
 *     mode the file actually got is readable rather than assumed.
 *   • No `node:sqlite` ⇒ a named, actionable refusal — never a silent fallback
 *     to a store that forgets.
 *
 * ── Why some of this is gated ───────────────────────────────────────────────
 * `node:sqlite` ships with Node 22.5+. This package supports Node 20, so the
 * tests that need a real database are gated on the module being present, and
 * the refusal tests are NOT — those run everywhere, including on the Node where
 * the refusal is not a simulation but what every caller actually meets.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { askHuman, isPaused } from '../../src/core/pause.js';
import { checkInApproved } from '../../src/core/checkin.js';
import {
  memorySessions,
  readEnvelope,
  readPausedRun,
  sqliteSessions,
  standingAgent,
  toEnvelope,
  toPausedEnvelope,
  SqliteUnavailableError,
  UnreadableEnvelopeError,
  UnreadableSessionFileError,
  type SqliteSessions,
} from '../../src/hosting/index.js';
// The `node:sqlite` shape types are not on the public barrel — they type the
// adapter's internal seam, and this suite reaches for one to write the damage a
// store has to refuse to read.
import type { SqliteDatabaseLike } from '../../src/hosting/sqliteSessions.js';
import type { AgentRunCheckpoint } from '../../src/core/runCheckpoint.js';
import { expectWithinTimes } from '../helpers/perf.js';
import { inProcessHost } from './testHost.js';

// ─── Is there a database to test against? ────────────────────────────

const sqliteAvailable = await (async (): Promise<boolean> => {
  try {
    const mod = (await import('node:sqlite')) as { DatabaseSync?: unknown };
    return typeof mod.DatabaseSync === 'function';
  } catch {
    return false;
  }
})();

/** Node 20 has no `node:sqlite`; the refusal block at the bottom covers it. */
const onSqlite = describe.skipIf(!sqliteAvailable);

/** A raw connection, for writing the damage a store must refuse to read. */
async function rawDatabase(file: string): Promise<SqliteDatabaseLike> {
  const { DatabaseSync } = (await import('node:sqlite')) as unknown as {
    DatabaseSync: new (path: string) => SqliteDatabaseLike;
  };
  return new DatabaseSync(file);
}

// ─── Fixtures ────────────────────────────────────────────────────────

function conversation(text: string): AgentRunCheckpoint {
  return {
    version: 1,
    runId: `run-${text.replace(/\W+/g, '-')}`,
    history: [
      { role: 'user', content: text },
      { role: 'assistant', content: `re: ${text}` },
    ],
    lastCompletedIteration: 1,
    originalInput: { message: text },
    checkpointedAt: Date.now(),
  } as AgentRunCheckpoint;
}

const temps: string[] = [];
const opened: SqliteSessions[] = [];

afterEach(async () => {
  closeAll();
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Everything but the disk goes away — which is what a restart is. */
function closeAll(): void {
  for (const store of opened.splice(0)) store.close();
}

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'afp-sqlite-'));
  temps.push(dir);
  return dir;
}

async function tempFile(name = 'sessions.db'): Promise<string> {
  return join(await tempDir(), name);
}

/** Open a store the suite will close for you. */
function open(file: string): SqliteSessions {
  const store = sqliteSessions({ file });
  opened.push(store);
  return store;
}

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

/**
 * The agent in the process that ASKS: the model calls the tool, the tool stops
 * for a person.
 */
function askingAgent(ran: string[]): Agent {
  return buildRefundAgent(ran, [
    { toolCalls: [{ id: 't1', name: 'approve_refund', args: { amount: 40 } }] },
    { content: 'refund issued' },
  ]);
}

/**
 * The agent in the process that ANSWERS — a genuinely fresh one, which is why
 * its model is scripted from the top.
 *
 * It answers with content rather than a tool call because that is what a real
 * model does here: the restored conversation already contains the tool call and
 * its now-decided result, so there is nothing left to call. Scripting a second
 * tool call would be scripting a model that ignored its own history.
 */
function answeringAgent(ran: string[]): Agent {
  return buildRefundAgent(ran, [{ content: 'refund issued' }]);
}

function buildRefundAgent(
  ran: string[],
  replies: Parameters<typeof mock>[0] extends { replies?: infer R } ? R : never,
): Agent {
  return Agent.create({
    provider: mock({ replies }),
    model: 'test-model',
    maxIterations: 3,
  })
    .system('terse')
    .tool(refundTool(ran))
    .build();
}

// ─── unit — the file, written and read back ──────────────────────────

onSqlite('sqliteSessions — a real file', () => {
  it('round-trips a conversation through a real database file', async () => {
    const store = open(await tempFile());

    expect(await store.hydrate('s1')).toBeUndefined(); // never written: absent
    await store.persist('s1', toEnvelope(conversation('hello')));

    const back = await store.hydrate('s1');
    expect(back?.format).toBe('conversation-v1');
    expect(readEnvelope(back).history).toEqual(conversation('hello').history);
  });

  it('round-trips a paused run, and keeps the two formats apart', async () => {
    const store = open(await tempFile());
    await store.persist(
      'paused',
      toPausedEnvelope({
        checkpoint: {
          pausedStageId: 'tool-calls#1',
          subflowPath: [],
          sharedState: { input: 'refund me' },
        } as never,
        conversation: conversation('refund me'),
        pending: { pauseData: { question: 'Approve $40?' } },
      }),
    );

    const back = await store.hydrate('paused');
    expect(back?.format).toBe('flowchart-v1');
    expect(readPausedRun(back).checkpoint.pausedStageId).toBe('tool-calls#1');
    // The reader for the OTHER format refuses it and points at its sibling.
    expect(() => readEnvelope(back)).toThrow(/PAUSED RUN/);
  });

  it('last write wins, and forget() removes one session only', async () => {
    const store = open(await tempFile());
    await store.persist('a', toEnvelope(conversation('first')));
    await store.persist('a', toEnvelope(conversation('second')));
    await store.persist('b', toEnvelope(conversation('other')));

    expect(readEnvelope(await store.hydrate('a')).originalInput.message).toBe('second');
    await store.forget('a');
    expect(await store.hydrate('a')).toBeUndefined();
    expect(await store.hydrate('b')).toBeDefined();
    await expect(store.forget('never-existed')).resolves.toBeUndefined();
  });

  it('creates the file AND its parent directories — nothing to set up first', async () => {
    const file = join(await tempDir(), 'nested', 'deeper', 'sessions.db');
    const store = open(file);
    await store.persist('s', toEnvelope(conversation('made the dirs')));
    expect((await readFile(file)).byteLength).toBeGreaterThan(0);
  });

  it('reports the journal mode the file ACTUALLY got, rather than the one asked for', async () => {
    expect(open(await tempFile()).journalMode).toBe('wal');
  });

  it('close() is idempotent, and using a closed store refuses by name', async () => {
    const store = open(await tempFile());
    await store.persist('s', toEnvelope(conversation('bye')));
    store.close();
    store.close(); // no throw: a shutdown hook and an explicit close can coexist

    await expect(store.hydrate('s')).rejects.toThrow(/is closed/);
    await expect(store.persist('s', toEnvelope(conversation('x')))).rejects.toThrow(/is closed/);
    await expect(store.forget('s')).rejects.toThrow(/is closed/);
  });

  it("refuses ':memory:' — a store that looks durable and is not", () => {
    expect(() => sqliteSessions({ file: ':memory:' })).toThrow(/not a durable store/);
    expect(() => sqliteSessions({ file: '  ' })).toThrow(/not a durable store/);
  });
});

// ─── scenario — the restart ──────────────────────────────────────────

onSqlite('sqliteSessions — a restart', () => {
  it('a SECOND store instance on the same file reads what the first one wrote', async () => {
    const file = await tempFile();

    const before = open(file);
    await before.persist('s1', toEnvelope(conversation('what we said before the deploy')));
    closeAll(); // the process ends here

    // A new store that never saw the old one. This is the whole feature.
    const after = open(file);
    expect(readEnvelope(await after.hydrate('s1')).originalInput.message).toBe(
      'what we said before the deploy',
    );
  });

  it('a standing agent continues the conversation across a full restart', async () => {
    const file = await tempFile();
    const provider = mock({ replies: [{ content: 'first' }, { content: 'second' }] });
    const newAgent = (): Agent =>
      Agent.create({ provider, model: 'test-model' }).system('terse').build();

    const host1 = inProcessHost();
    const first = await standingAgent({ agent: newAgent(), sessions: open(file), host: host1 });
    await host1.deliver({ input: 'my name is Ada', sessionId: 'user-7' });
    await first.close();
    closeAll();

    // New process: new host, new agent, new store — same file on disk.
    const host2 = inProcessHost();
    const second = await standingAgent({ agent: newAgent(), sessions: open(file), host: host2 });
    try {
      await host2.deliver({ input: 'what is my name?', sessionId: 'user-7' });
      const said = readEnvelope(await open(file).hydrate('user-7')).history.map((m) =>
        String(m.content),
      );
      expect(said).toContain('my name is Ada');
      expect(said).toContain('what is my name?');
    } finally {
      await second.close();
    }
  });
});

// ─── integration — THE headline claim ────────────────────────────────

onSqlite('sqliteSessions — a run that stopped to ask a person', () => {
  it('a paused run reloaded from the file by a NEW store resumes to completion, and the pre-pause tool does not run twice', async () => {
    const file = await tempFile();
    const ran: string[] = [];

    // ── the process that asked ──────────────────────────────────────
    const asking = askingAgent(ran);
    const out = await asking.run({ message: 'refund me' });
    expect(isPaused(out)).toBe(true);
    if (!isPaused(out)) throw new Error('unreachable');
    expect(ran).toEqual(['refund:40']);

    const writer = open(file);
    await writer.persist(
      'refund-1',
      toPausedEnvelope({
        checkpoint: out.checkpoint,
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        conversation: asking.checkpoint()!,
        pending: { pauseData: out.pauseData, tool: 'approve_refund' },
      }),
    );
    closeAll(); // …and the process ends, holding a question open

    // ── the process that answers, a deploy later ────────────────────
    const reader = open(file);
    const stored = await reader.hydrate('refund-1');
    expect(stored?.format).toBe('flowchart-v1');
    const paused = readPausedRun(stored);
    expect(paused.pending.tool).toBe('approve_refund');

    const answering = answeringAgent(ran); // a NEW agent, as a new process has
    const answer = await answering.resume(
      paused.checkpoint,
      checkInApproved({ by: 'alice@ops', note: 'verified with customer' }),
    );

    expect(answer).toBe('refund issued');
    // The claim that makes this a resume rather than a replay: the tool that
    // ran before the pause did NOT run again on the way back.
    expect(ran).toEqual(['refund:40']);
  });

  it('serves that same pause through standingAgent, across a restart', async () => {
    const file = await tempFile();
    const ran: string[] = [];

    const host1 = inProcessHost();
    const first = await standingAgent({
      agent: askingAgent(ran),
      sessions: open(file),
      host: host1,
    });
    const asked = await host1.deliver({ input: 'refund me', sessionId: 'r-1' });
    expect(asked.awaiting).toBeDefined();
    await first.close();
    closeAll();

    const host2 = inProcessHost();
    const second = await standingAgent({
      agent: answeringAgent(ran),
      sessions: open(file),
      host: host2,
    });
    try {
      const done = await host2.deliver({
        input: '',
        sessionId: 'r-1',
        decision: checkInApproved({ by: 'alice' }),
      });
      expect(done.output).toBe('refund issued');
      expect(ran).toEqual(['refund:40']); // once, across two processes
    } finally {
      await second.close();
    }
  });
});

// ─── security — unreadable is never answered with a fresh start ──────

onSqlite('sqliteSessions — unreadable is not absent', () => {
  it('refuses a file that is not a database, naming it, at construction', async () => {
    const file = await tempFile('not-a-db.db');
    await writeFile(file, 'this is a text file somebody renamed\n'.repeat(20), 'utf8');

    try {
      open(file);
      expect.unreachable('a corrupt store must not open as an empty one');
    } catch (err) {
      expect(err).toBeInstanceOf(UnreadableSessionFileError);
      const refusal = err as UnreadableSessionFileError;
      expect(refusal.code).toBe('ERR_UNREADABLE_SESSION_FILE');
      expect(refusal.problem).toBe('cannot-open');
      expect(refusal.file).toBe(file);
      expect(refusal.message).toContain('different facts');
    }
  });

  it('refuses a row this runtime cannot read — never `undefined`', async () => {
    const file = await tempFile();
    const store = open(file);
    await store.persist('s1', toEnvelope(conversation('real')));
    closeAll();

    // Something wrote its own encoding into the row — the field failure the
    // envelope law exists for, one level down.
    const raw = await rawDatabase(file);
    raw
      .prepare('UPDATE agent_sessions SET envelope = ? WHERE session_id = ?')
      .run('{format=conversation-v1, data={version=1}}', 's1');
    raw.close();

    const reopened = open(file);
    await expect(reopened.hydrate('s1')).rejects.toBeInstanceOf(UnreadableEnvelopeError);
    await expect(reopened.hydrate('s1')).rejects.toThrow(/session 's1'/);
    // …while a session that was never written is still ordinary.
    expect(await reopened.hydrate('never-written')).toBeUndefined();
  });

  it('refuses an envelope format this runtime does not know, by name', async () => {
    const store = open(await tempFile());
    await expect(
      store.persist('s', { format: 'flowchart-v2', data: {}, savedAt: 1 } as never),
    ).rejects.toThrow(/unknown checkpoint format 'flowchart-v2'/);
    // …and nothing was written, so the next read is honestly absent.
    expect(await store.hydrate('s')).toBeUndefined();
  });

  it('refuses a store written by a NEWER runtime rather than half-reading it', async () => {
    const file = await tempFile();
    open(file);
    closeAll();

    const raw = await rawDatabase(file);
    raw.prepare("UPDATE agent_store_meta SET value = '2' WHERE key = 'schema_version'").run();
    raw.close();

    try {
      open(file);
      expect.unreachable('a newer schema must be refused');
    } catch (err) {
      expect((err as UnreadableSessionFileError).problem).toBe('newer-schema');
      expect((err as Error).message).toContain('schema version 2');
    }
  });

  it("refuses somebody else's table of the same name", async () => {
    const file = await tempFile('app.db');
    const raw = await rawDatabase(file);
    raw.exec('CREATE TABLE agent_sessions (id TEXT PRIMARY KEY, whatever TEXT)');
    raw.close();

    try {
      open(file);
      expect.unreachable("another app's table must not be written into");
    } catch (err) {
      expect((err as UnreadableSessionFileError).problem).toBe('not-our-schema');
      expect((err as Error).message).toContain('session_id');
    }
  });
});

// ─── property — two stores, one file ─────────────────────────────────

onSqlite('sqliteSessions — two stores on one file (WAL)', () => {
  it('each sees the other one writes, in both directions', async () => {
    const file = await tempFile();
    const a = open(file);
    const b = open(file);

    expect(a.journalMode).toBe('wal');
    expect(b.journalMode).toBe('wal');

    await a.persist('from-a', toEnvelope(conversation('written by a')));
    expect(readEnvelope(await b.hydrate('from-a')).originalInput.message).toBe('written by a');

    await b.persist('from-b', toEnvelope(conversation('written by b')));
    expect(readEnvelope(await a.hydrate('from-b')).originalInput.message).toBe('written by b');

    // Closing one does not take the other down with it.
    a.close();
    expect(await b.hydrate('from-a')).toBeDefined();
  });

  it('interleaved writes to one session settle on a last write, never a mixture', async () => {
    const file = await tempFile();
    const a = open(file);
    const b = open(file);

    for (let i = 0; i < 20; i++) {
      await (i % 2 === 0 ? a : b).persist('shared', toEnvelope(conversation(`turn-${i}`)));
    }
    const settled = readEnvelope(await open(file).hydrate('shared'));
    expect(settled.originalInput.message).toBe('turn-19');
    expect(settled.history).toHaveLength(2); // a whole envelope, never a splice of two
  });
});

// ─── performance ─────────────────────────────────────────────────────

onSqlite('sqliteSessions — what it costs', () => {
  it('finding one session does not get slower as the store fills up', async () => {
    // The claim worth defending, and the reason this is a database rather than
    // a JSON file: lookup goes through the primary key, so a store with a
    // hundred times more sessions in it answers in about the same time. A file
    // this store replaces would read and parse all of them.
    const small = open(await tempFile('small.db'));
    const large = open(await tempFile('large.db'));
    for (let i = 0; i < 20; i++) {
      await small.persist(`s-${i}`, toEnvelope(conversation(`m${i}`)));
    }
    for (let i = 0; i < 2000; i++) {
      await large.persist(`s-${i}`, toEnvelope(conversation(`m${i}`)));
    }

    await expectWithinTimes({
      baseline: () => small.hydrate('s-10'),
      subject: () => large.hydrate('s-1000'),
      // An index makes this ~1×; 3 leaves room for a deeper B-tree and for the
      // page cache being colder on the bigger file, and still fails loudly if
      // lookup ever becomes a scan (which at 100× the rows would be ~100×).
      times: 3,
      why: 'hydrate is an indexed lookup, not a scan over every stored session',
    });
  });
});

// ─── the refusal, on every Node ──────────────────────────────────────

describe('sqliteSessions — when Node has no sqlite', () => {
  it('refuses by name, with the version and what to do — never a silent fallback', () => {
    // On Node 20 this refusal is not a simulation: it is what every caller
    // meets. The message is the whole deliverable, so it is asserted piece by
    // piece rather than merely "it threw".
    const refusal = new SqliteUnavailableError('v20.19.1', 'No such built-in module: node:sqlite');
    expect(refusal.code).toBe('ERR_SQLITE_UNAVAILABLE');
    expect(refusal.name).toBe('SqliteUnavailableError');
    expect(refusal.nodeVersion).toBe('v20.19.1');
    expect(refusal.message).toContain('22.5'); // the version that has it
    expect(refusal.message).toContain('--experimental-sqlite'); // the flag, for 22.5–22.12
    expect(refusal.message).toContain('memorySessions()'); // the honest alternative
    expect(refusal.message).toContain('brand-new user'); // why it does not fall back
  });

  it('raises that refusal on the real load path, and touches no disk on the way', async () => {
    // The REAL path, exercised on a Node that has the module: the loader is
    // replaced so `node:sqlite` is missing exactly the way it is missing on
    // Node 20. Anything less would be asserting a message nothing produces.
    vi.resetModules();
    vi.doMock('../../src/lib/lazyRequire.js', async () => {
      const actual = await vi.importActual<typeof import('../../src/lib/lazyRequire.js')>(
        '../../src/lib/lazyRequire.js',
      );
      return {
        lazyRequire: (specifier: string): unknown => {
          if (specifier === 'node:sqlite') {
            throw new Error('No such built-in module: node:sqlite');
          }
          return actual.lazyRequire(specifier);
        },
      };
    });

    try {
      const fresh = await import('../../src/hosting/sqliteSessions.js');
      const file = join(await tempDir(), 'never', 'created.db');
      expect(() => fresh.sqliteSessions({ file })).toThrow(fresh.SqliteUnavailableError);
      // The refusal comes BEFORE the filesystem is touched: a store that could
      // not open anything has no business leaving directories behind.
      expect(existsSync(join(file, '..'))).toBe(false);
    } finally {
      vi.doUnmock('../../src/lib/lazyRequire.js');
      vi.resetModules();
    }
  });

  it('an injected module that cannot open the file is refused, not returned half-built', async () => {
    // What the `_sqlite` seam is for: a driver that fails at construction must
    // not yield a store object that looks usable.
    const failing = function (): never {
      throw new Error('unable to open database file');
    } as unknown as NonNullable<Parameters<typeof sqliteSessions>[0]['_sqlite']>;
    const file = join(await tempDir(), 'x.db');

    expect(() => sqliteSessions({ file, _sqlite: failing })).toThrow(UnreadableSessionFileError);
  });

  it('the fallback it refuses to make is a real store you can choose instead', async () => {
    // Stated as a test because it is the alternative the refusal points at:
    // same port, same standing agent, and it forgets on restart.
    const sessions = memorySessions();
    await sessions.persist('s', toEnvelope(conversation('kept in a Map')));
    expect(readEnvelope(await sessions.hydrate('s')).originalInput.message).toBe('kept in a Map');
    expect(await memorySessions().hydrate('s')).toBeUndefined();
  });
});

// ─── ROI ─────────────────────────────────────────────────────────────

onSqlite('sqliteSessions — what it buys', () => {
  it('a hosted conversation becomes restart-proof by changing one argument', async () => {
    // The ROI statement, executable: the ONLY difference from the
    // memorySessions deployment is which store is passed.
    const file = await tempFile();
    const host = inProcessHost();
    const handle = await standingAgent({
      agent: Agent.create({ provider: mock({ reply: 'hi' }), model: 'test-model' })
        .system('terse')
        .build(),
      sessions: open(file), // ← the whole diff
      host,
    });
    try {
      await host.deliver({ input: 'hello', sessionId: 'roi' });
    } finally {
      await handle.close();
    }
    closeAll();
    expect((await open(file).hydrate('roi'))?.format).toBe('conversation-v1');
  });

  it('the file is inspectable with the tools already on the box', async () => {
    // `format` and `saved_at` are columns as well as JSON fields, so an oncall
    // can ask "which sessions are waiting on a person?" without this library.
    const file = await tempFile();
    const store = open(file);
    await store.persist('a', toEnvelope(conversation('answered')));
    await store.persist(
      'b',
      toPausedEnvelope({
        checkpoint: { pausedStageId: 's#1', subflowPath: [], sharedState: {} } as never,
        conversation: conversation('asked'),
        pending: { pauseData: 'approve?' },
      }),
    );
    closeAll();

    const raw = await rawDatabase(file);
    const waiting = raw
      .prepare("SELECT session_id FROM agent_sessions WHERE format = 'flowchart-v1'")
      .all() as { session_id?: unknown }[];
    raw.close();
    expect(waiting.map((r) => String(r.session_id))).toEqual(['b']);
  });
});

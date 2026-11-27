/**
 * TWO PROCESSES, ONE SEQ — the compare-and-swap holds across processes (case table 4.8).
 *
 * Real child processes, each with its own `fileLedgerStore` over one directory and one key,
 * append at the SAME expected seq at the same instant. Exactly one is `appended`; every other gets
 * `'conflict'`; and the file verifies afterwards, holding the winner's entries and nothing of the
 * losers'. Repeated over several rounds, with single entries and with batches, so a lock that did
 * not hold would show as two winners or a file that no longer verifies.
 *
 * The children run the folder's own source, bundled once with esbuild (the precedent is
 * `test/time/partial-window-resume.test.ts`); the key reaches them through a 0600 file, never argv.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { noteEntry, openedEntry } from '../../src/llm-ledger/build.js';
import { fileLedgerStore } from '../../src/llm-ledger/fileStore.js';
import { mintSessionId } from '../../src/llm-ledger/session.js';
import { LedgerStoreError } from '../../src/llm-ledger/store.js';
import type { LedgerEntry } from '../../src/llm-ledger/types.js';

const ROOT = resolve(__dirname, '../..');
const folder = mkdtempSync(join(tmpdir(), 'af-llm-ledger-procs-'));
const api = join(folder, 'fileStore.cjs');
const worker = join(folder, 'worker.cjs');

const WORKER = String.raw`
const { readFileSync } = require('node:fs');
const [api, dir, keyFile, session, expectedSeq, entriesFile, startAt] = process.argv.slice(2);
const { fileLedgerStore } = require(api);
const store = fileLedgerStore({ dir, key: new Uint8Array(readFileSync(keyFile)), uid: process.getuid() });
const entries = JSON.parse(readFileSync(entriesFile, 'utf8'));
const go = () => store.append(session, Number(expectedSeq), entries)
  .then((result) => process.stdout.write(JSON.stringify({ result })))
  .catch((error) => process.stdout.write(JSON.stringify({ error: error.code ?? String(error) })));
const wait = () => (Date.now() >= Number(startAt) ? go() : setTimeout(wait, 1));
wait();
`;

/** A writer killed (SIGKILL) after its write reached the disk with only the FIRST line of its batch. */
const KILLED = String.raw`
const fsp = require('node:fs/promises');
const { readFileSync } = require('node:fs');
const realOpen = fsp.open;
fsp.open = async (...args) => {
  const handle = await realOpen(...args);
  if (String(args[0]).endsWith('.jsonl')) {
    const write = handle.write.bind(handle);
    handle.write = async (data, offset) => {
      await write(data, offset, data.indexOf(10, offset) + 1 - offset);
      process.kill(process.pid, 'SIGKILL');
      return new Promise(() => undefined);
    };
  }
  return handle;
};
const [api, dir, keyFile, session, expectedSeq, entriesFile] = process.argv.slice(2);
const { fileLedgerStore } = require(api);
const store = fileLedgerStore({ dir, key: new Uint8Array(readFileSync(keyFile)), uid: process.getuid() });
store.append(session, Number(expectedSeq), JSON.parse(readFileSync(entriesFile, 'utf8')));
`;
const killed = join(folder, 'killed.cjs');

beforeAll(async () => {
  writeFileSync(worker, WORKER);
  writeFileSync(killed, KILLED);
  await build({
    entryPoints: [join(ROOT, 'src/llm-ledger/fileStore.ts')],
    outfile: api,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    packages: 'external',
    logLevel: 'silent',
  });
}, 30_000);
afterAll(() => rmSync(folder, { recursive: true, force: true }));

const AT = '2026-11-25T10:00:00Z';
function unwrap<E extends LedgerEntry>(built: { ok: boolean; entry?: E }): E {
  if (!built.ok) throw new Error('fixture refused');
  return built.entry as E;
}
const note = (seq: number, text: string) =>
  unwrap(noteEntry({ seq, at: AT }, { kind: 'claim', text, cites: [] }));

let attempt = 0;
function child(args: {
  dir: string;
  keyFile: string;
  session: string;
  expectedSeq: number;
  entries: LedgerEntry[];
  startAt: number;
}) {
  const entriesFile = join(folder, `entries-${++attempt}.json`);
  writeFileSync(entriesFile, JSON.stringify(args.entries));
  return new Promise<{ result?: number | 'conflict'; error?: string }>((done, fail) => {
    const proc = spawn(
      process.execPath,
      [
        worker,
        api,
        args.dir,
        args.keyFile,
        args.session,
        String(args.expectedSeq),
        entriesFile,
        String(args.startAt),
      ],
      {
        env: { PATH: process.env.PATH, NODE_PATH: join(ROOT, 'node_modules') },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let out = '';
    let err = '';
    proc.stdout.on('data', (chunk: Buffer) => (out += chunk));
    proc.stderr.on('data', (chunk: Buffer) => (err += chunk));
    proc.on('error', fail);
    proc.on('close', (code) =>
      code === 0 ? done(JSON.parse(out)) : fail(new Error(`child exited ${code}: ${err}`)),
    );
  });
}

describe('two real processes append at one seq', () => {
  it.each([
    ['one entry each', 2, 1],
    ['a batch each', 3, 4],
  ])(
    '%s: exactly one wins, every other gets conflict, and the file verifies',
    async (_name, writers, batch) => {
      const dir = join(folder, `store-${writers}-${batch}`);
      const key = randomBytes(32);
      const keyFile = join(folder, `key-${writers}-${batch}`);
      writeFileSync(keyFile, key, { mode: 0o600 });
      const session = mintSessionId();
      const store = fileLedgerStore({ dir, key, uid: process.getuid!() });
      await store.append(session, 0, [unwrap(openedEntry({ seq: 1, at: AT }, {}))]);
      let seq = 1;
      for (let round = 0; round < 6; round++) {
        const batches = Array.from({ length: writers }, (_, w) =>
          Array.from({ length: batch }, (_, i) =>
            note(seq + i + 1, `round ${round} writer ${w} item ${i} ${1000 + w}`),
          ),
        );
        const startAt = Date.now() + 400;
        const results = await Promise.all(
          batches.map((entries) =>
            child({ dir, keyFile, session, expectedSeq: seq, entries, startAt }),
          ),
        );
        const winners = results.flatMap((r, w) => (r.result === seq + batch ? [w] : []));
        expect(
          results.filter((r) => r.error !== undefined),
          JSON.stringify(results),
        ).toEqual([]);
        expect(winners, JSON.stringify(results)).toHaveLength(1);
        expect(results.filter((r) => r.result === 'conflict')).toHaveLength(writers - 1);
        const log = await store.load(session);
        seq += batch;
        expect(log.seq).toBe(seq);
        expect(log.entries.slice(seq - batch)).toEqual(batches[winners[0]!]);
      }
    },
    60_000,
  );
});

describe('a writer killed in the middle of a batch', () => {
  it('leaves an unfinished batch, which is refused whole and can never be extended', async () => {
    const dir = join(folder, 'store-killed');
    const key = randomBytes(32);
    const keyFile = join(folder, 'key-killed');
    writeFileSync(keyFile, key, { mode: 0o600 });
    const session = mintSessionId();
    const store = fileLedgerStore({ dir, key, uid: process.getuid!() });
    await store.append(session, 0, [unwrap(openedEntry({ seq: 1, at: AT }, {}))]);
    const entriesFile = join(folder, 'entries-killed.json');
    writeFileSync(
      entriesFile,
      JSON.stringify([note(2, 'first of two 1111'), note(3, 'second of two 2222')]),
    );
    const run = spawnSync(
      process.execPath,
      [killed, api, dir, keyFile, session, '1', entriesFile],
      {
        env: { PATH: process.env.PATH, NODE_PATH: join(ROOT, 'node_modules') },
        encoding: 'utf8',
        timeout: 20_000,
      },
    );
    expect(run.signal, run.stderr).toBe('SIGKILL');
    const file = join(dir, `${session}.jsonl`);
    const left = readFileSync(file);
    expect(left.toString('utf8').split('\n')).toHaveLength(3); // opened, one line of two, the end
    const code = (work: Promise<unknown>) =>
      work.then(
        (v) => String(v),
        (e: unknown) => (e instanceof LedgerStoreError ? e.code : Promise.reject(e)),
      );
    expect(await code(store.load(session))).toBe('torn-line'); // waits out the dead writer's lock first
    const lock = join(dir, `${session}.lock`);
    const then = Date.now() / 1000 - 31;
    utimesSync(lock, then, then); // the dead writer's lock, gone stale
    expect(await code(store.append(session, 1, [note(2, 'a retry 3333')]))).toBe('torn-line');
    expect(await code(store.append(session, 2, [note(3, 'after the half 4444')]))).toBe(
      'torn-line',
    );
    expect(readFileSync(file).equals(left)).toBe(true);
  }, 30_000);
});

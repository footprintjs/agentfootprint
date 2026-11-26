/**
 * fileStore — the batch mark, the line's exact shape and the caps on the read path (case table
 * 4.4, 4.6, 6.5; the second read's P2-2 and its batch recommendation).
 *
 * Security: every line carries its batch's end inside the MAC'd bytes, so a log cut inside a batch
 * is refused (`torn-line`) at every cut point and can never be extended; a line with a fourth key
 * or an upper-case MAC is refused even with a MAC that verifies; the entry, line and log caps hold
 * when a file is READ, not only when one is written. Lines here are written by an independent
 * writer (`node:crypto`), so each case is the bytes a key holder or a crash could leave.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalizeJson } from 'foottrace/canonical-json';
import { afterAll, describe, expect, it } from 'vitest';

import { noteEntry, openedEntry } from './build.js';
import { fileLedgerStore } from './fileStore.js';
import { LEDGER_LIMITS } from './limits.js';
import { mintSessionId } from './session.js';
import { LedgerStoreError } from './store.js';
import type { LedgerEntry } from './types.js';

const AT = '2026-11-25T10:00:00Z';
const UID = process.getuid!();
const made: string[] = [];
afterAll(() => made.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function unwrap<E extends LedgerEntry>(built: { ok: boolean; entry?: E }): E {
  if (!built.ok) throw new Error('fixture refused');
  return built.entry as E;
}
const OPENED = unwrap(openedEntry({ seq: 1, at: AT }, {}));
const note = (seq: number, text = `note ${seq} 1234`) =>
  unwrap(noteEntry({ seq, at: AT }, { kind: 'claim', text, cites: [] }));

const BIG = { maxBytes: 4_194_304, maxNodes: 100_000, maxFields: 100_000 };

/** An independent writer: one line `{ end, entry, mac }` per entry, with the MAC chain. */
function writer(key: Uint8Array, session: string) {
  let prev = '';
  let seq = 0;
  return (entry: unknown, end: number, extra: Record<string, unknown> = {}) => {
    seq++;
    const input = canonicalizeJson({ session, seq, prev, end, entry }, BIG);
    const mac = createHmac('sha256', key).update(input, 'utf8').digest('hex');
    prev = mac;
    return `${canonicalizeJson({ end, entry, mac, ...extra }, BIG)}\n`;
  };
}

function fresh() {
  const root = mkdtempSync(join(tmpdir(), 'af-llm-ledger-format-'));
  made.push(root);
  const dir = join(root, 'store');
  mkdirSync(dir, { mode: 0o700 });
  const key = randomBytes(32);
  const session = mintSessionId();
  const store = fileLedgerStore({ dir, key, uid: UID });
  return { dir, key, session, store, file: join(dir, `${session}.jsonl`) };
}

async function codeOf(work: Promise<unknown>): Promise<string> {
  try {
    const value = await work;
    return typeof value === 'object' && value !== null
      ? `seq ${(value as { seq: number }).seq}`
      : String(value);
  } catch (error) {
    if (error instanceof LedgerStoreError) return error.code;
    throw error;
  }
}

describe('the batch mark', () => {
  it('every line names its batch’s last seq', async () => {
    const { store, session, file } = fresh();
    await store.append(session, 0, [OPENED]);
    await store.append(session, 1, [note(2), note(3), note(4)]);
    await store.append(session, 4, [note(5)]);
    const ends = readFileSync(file, 'utf8')
      .split('\n')
      .slice(0, -1)
      .map((line) => (JSON.parse(line) as { end: number }).end);
    expect(ends).toEqual([1, 4, 4, 4, 5]);
  });

  it('a log cut at EVERY point inside a three-line batch is torn-line, on load and on append', async () => {
    const { store, session, file } = fresh();
    await store.append(session, 0, [OPENED]);
    await store.append(session, 1, [note(2), note(3), note(4)]);
    const bytes = readFileSync(file);
    const batchStart = bytes.indexOf(0x0a) + 1;
    for (let cut = batchStart; cut <= bytes.length; cut++) {
      const part = bytes.subarray(0, cut);
      writeFileSync(file, part);
      const expected = cut === batchStart ? 'seq 1' : cut === bytes.length ? 'seq 4' : 'torn-line';
      expect(await codeOf(store.load(session)), `cut at ${cut}`).toBe(expected);
      if (expected === 'torn-line') {
        // Nothing may ever be appended after an unfinished batch — at its seq or any other.
        for (const at of [1, 2, 3])
          expect(
            await codeOf(store.append(session, at, [note(at + 1)])),
            `append@${at} cut ${cut}`,
          ).toBe('torn-line');
        expect(readFileSync(file).equals(part), `unchanged at ${cut}`).toBe(true);
      }
    }
  }, 120_000);

  it('a load waits for the writer of an unfinished batch, then reads it whole', async () => {
    const { store, session, file, dir } = fresh();
    await store.append(session, 0, [OPENED]);
    await store.append(session, 1, [note(2), note(3)]);
    const whole = readFileSync(file);
    const lastBreak = whole.lastIndexOf(0x0a, whole.length - 2) + 1;
    writeFileSync(file, whole.subarray(0, lastBreak)); // one line of the two: a batch mid-write
    const lock = join(dir, `${session}.lock`);
    writeFileSync(lock, '', { mode: 0o600 });
    setTimeout(() => {
      writeFileSync(file, whole);
      rmSync(lock);
    }, 200);
    expect((await store.load(session)).seq).toBe(3);
  });

  it('an end that breaks its batch is malformed, even with a MAC that verifies', async () => {
    const { key, session, store, file } = fresh();
    const write = writer(key, session);
    writeFileSync(
      file,
      write(OPENED, 1) + write(note(2), 3) + write(note(3), 4) + write(note(4), 4),
      {
        mode: 0o600,
      },
    );
    expect(await codeOf(store.load(session))).toBe('malformed');
    const again = writer(key, session);
    writeFileSync(file, again(OPENED, 1) + again(note(2), 1));
    expect(await codeOf(store.load(session))).toBe('malformed'); // an end before its own seq
    const tail = writer(key, session);
    writeFileSync(file, tail(OPENED, 1) + tail(note(2), 1));
    expect(await codeOf(store.append(session, 2, [note(3)]))).toBe('malformed');
  });

  it('an end changed without the key is mac-mismatch: the end is inside the MAC', async () => {
    const { store, session, file } = fresh();
    await store.append(session, 0, [OPENED]);
    await store.append(session, 1, [note(2), note(3)]);
    const text = readFileSync(file, 'utf8');
    writeFileSync(file, text.replace('{"end":3,', '{"end":2,')); // claim the batch ended at seq 2
    expect(await codeOf(store.load(session))).toBe('mac-mismatch');
  });
});

describe('the line’s exact shape', () => {
  it('a fourth key is refused even when the MAC verifies (r10)', async () => {
    const { key, session, store, file } = fresh();
    const write = writer(key, session);
    writeFileSync(file, write(OPENED, 1, { extra: 1 }), { mode: 0o600 });
    expect(await codeOf(store.load(session))).toBe('mac-mismatch');
    expect(await codeOf(store.append(session, 1, [note(2)]))).toBe('mac-mismatch');
  });

  it('an upper-case MAC on the last line is refused, though the chain has no successor to break (r11)', async () => {
    const { store, session, file } = fresh();
    await store.append(session, 0, [OPENED]);
    await store.append(session, 1, [note(2)]);
    const lines = readFileSync(file, 'utf8').split('\n');
    lines[1] = lines[1]!.replace(
      /"mac":"([0-9a-f]{64})"/,
      (_, mac: string) => `"mac":"${mac.toUpperCase()}"`,
    );
    writeFileSync(file, lines.join('\n'));
    expect(await codeOf(store.load(session))).toBe('mac-mismatch');
    expect(await codeOf(store.append(session, 2, [note(3)]))).toBe('mac-mismatch');
  });

  it('append checks the last entry’s shape, not only its MAC (r1)', async () => {
    const { key, session, store, file } = fresh();
    const write = writer(key, session);
    const bad = { ...note(2), tokens: ['not', 'a', 'note', 'field'] };
    writeFileSync(file, write(OPENED, 1) + write(bad, 2), { mode: 0o600 });
    expect(await codeOf(store.append(session, 2, [note(3)]))).toBe('malformed');
    expect(readFileSync(file, 'utf8').split('\n')).toHaveLength(3);
  });

  it('an empty session file is torn-line for append as for load — never a new session (r13)', async () => {
    const { store, session, file } = fresh();
    writeFileSync(file, '', { mode: 0o600 });
    expect(await codeOf(store.append(session, 0, [OPENED]))).toBe('torn-line');
    expect(readFileSync(file).length).toBe(0);
    expect(await codeOf(store.load(session))).toBe('torn-line');
  });
});

describe('the caps hold on the read path', () => {
  it('a file of 10,001 lines, every one with a good MAC, is too-large (r4)', async () => {
    const { key, session, store, file } = fresh();
    const write = writer(key, session);
    const end = LEDGER_LIMITS.maxEntries + 1;
    let text = write(OPENED, end);
    for (let seq = 2; seq <= end; seq++) text += write(note(seq, 'n 1234'), end);
    writeFileSync(file, text, { mode: 0o600 });
    expect(await codeOf(store.load(session))).toBe('too-large');
  }, 60_000);

  it('a line one byte past 256 KiB, with a good MAC, is too-large on load and on append (r5)', async () => {
    const { key, session, store, file } = fresh();
    const check = (pad: string) => ({
      v: 1,
      seq: 2,
      kind: 'check',
      by: 'ledger',
      how: 'observed',
      at: AT,
      submit: 1,
      subject: { draft: true },
      rule: 'cited@1',
      disposition: 'not-applicable',
      restsOn: [],
      counts: { visible: 0, missing: 0, supplied: 0, incomplete: 0 },
      decision: { pad },
    });
    // Size the second line to exactly the cap plus one byte, newline included.
    const probe = (n: number) => {
      const w = writer(key, session);
      w(OPENED, 1);
      return Buffer.byteLength(w(check('x'.repeat(n)), 2));
    };
    const n = LEDGER_LIMITS.maxLineBytes + 1 - probe(0);
    expect(probe(n)).toBe(LEDGER_LIMITS.maxLineBytes + 1);
    const w = writer(key, session);
    writeFileSync(file, w(OPENED, 1) + w(check('x'.repeat(n)), 2), { mode: 0o600 });
    expect(await codeOf(store.load(session))).toBe('too-large');
    expect(await codeOf(store.append(session, 2, [note(3)]))).toBe('too-large');
  });

  it('a file one byte past 32 MiB is too-large before it is read, on load and on append (r6)', async () => {
    const { session, store, file } = fresh();
    await store.append(session, 0, [OPENED]);
    truncateSync(file, LEDGER_LIMITS.maxLogBytes + 1); // sparse: no 32 MiB is written
    expect(await codeOf(store.load(session))).toBe('too-large');
    expect(await codeOf(store.append(session, 1, [note(2)]))).toBe('too-large');
  });
});

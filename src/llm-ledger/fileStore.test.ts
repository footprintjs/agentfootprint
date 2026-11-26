/**
 * fileStore — the bytes on disk, the MAC chain, and every way a changed file is refused (case
 * table 4.4, 4.6, 4.9).
 *
 * Security: the MAC is recomputed here with `node:crypto`, independently of the adapter; every
 * byte of a log is edited in turn; lines are swapped, removed, copied from another session; a file
 * is renamed to another session; the last line is cut at EVERY byte offset. Each is refused, and
 * nothing is ever repaired. Permissions, links and the lock are in `fileStore.safety.test.ts`.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CanonicalJsonError, canonicalizeJson } from 'foottrace/canonical-json';
import { afterAll, describe, expect, it } from 'vitest';

import { noteEntry, openedEntry, receiptEntry } from './build.js';
import { fileLedgerStore } from './fileStore.js';
import { mintSessionId } from './session.js';
import {
  LINE_CANONICAL,
  LedgerStoreError,
  admitEntry,
  entryCanonical,
  lineBytesOf,
  withHighWater,
} from './store.js';
import type { LedgerEntry } from './types.js';

const AT = '2026-11-25T10:00:00Z';
const UID = process.getuid!();
const made: string[] = [];
afterAll(() => made.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function fresh(key: Uint8Array = randomBytes(32)) {
  const root = mkdtempSync(join(tmpdir(), 'af-llm-ledger-file-'));
  made.push(root);
  const dir = join(root, 'store');
  return { dir, key, store: fileLedgerStore({ dir, key, uid: UID }) };
}

function unwrap<E extends LedgerEntry>(built: { ok: boolean; entry?: E }): E {
  if (!built.ok) throw new Error('fixture refused');
  return built.entry as E;
}
const at = (seq: number) => ({ seq, at: AT });
const ENTRIES: LedgerEntry[] = [
  unwrap(openedEntry(at(1), { rules: ['cited@1'] })),
  unwrap(receiptEntry(at(2), { source: 'perf', text: 'esx01a 41,200 IOPS' })),
  unwrap(noteEntry(at(3), { kind: 'claim', text: 'esx01a did 41,200', cites: [2] })),
  unwrap(receiptEntry(at(4), { source: 'logs', text: 'run-77ab ok', how: 'reported' })),
  unwrap(noteEntry(at(5), { kind: 'question', text: 'which window?', cites: [] })),
];

/** The independent MAC: HMAC-SHA-256 over canonical `{ session, seq, prev, entry }`. */
const macOf = (key: Uint8Array, session: string, seq: number, prev: string, entry: unknown) =>
  createHmac('sha256', key)
    .update(canonicalizeJson({ session, seq, prev, entry }, { maxBytes: 300_000 }), 'utf8')
    .digest('hex');

/** The lines an honest writer with `key` would write for `entries` in `session`. */
function linesFor(key: Uint8Array, session: string, entries: readonly unknown[]): string {
  let prev = '';
  return entries
    .map((entry, i) => {
      const mac = macOf(key, session, i + 1, prev, entry);
      prev = mac;
      return `${canonicalizeJson({ entry, mac }, { maxBytes: 300_000 })}\n`;
    })
    .join('');
}

async function written(entries = ENTRIES) {
  const where = fresh();
  const session = mintSessionId();
  await where.store.append(session, 0, entries);
  const file = join(where.dir, `${session}.jsonl`);
  return { ...where, session, file, bytes: readFileSync(file) };
}

async function codeOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    if (error instanceof LedgerStoreError) return error.code;
    throw error;
  }
  return 'loaded';
}

describe('fileStore — the bytes on disk', () => {
  it('one canonical line per entry, MAC-chained exactly as specified (recomputed independently)', async () => {
    const { key, session, bytes, file, dir } = await written();
    expect(bytes.toString('utf8')).toBe(linesFor(key, session, ENTRIES));
    const lines = bytes.toString('utf8').split('\n').slice(0, -1);
    expect(lines).toHaveLength(5);
    lines.forEach((line, i) => {
      expect(Buffer.byteLength(line) + 1).toBe(lineBytesOf(canonicalizeJson(ENTRIES[i])));
      expect(line).toMatch(/^\{"entry":\{.*\},"mac":"[0-9a-f]{64}"\}$/);
    });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it('splitting appends across reopened stores writes the same bytes', async () => {
    const key = randomBytes(32);
    const one = fresh(key);
    const session = mintSessionId();
    await one.store.append(session, 0, ENTRIES);
    const split = fresh(key);
    for (let i = 0; i < ENTRIES.length; i++) {
      const reopened = fileLedgerStore({ dir: split.dir, key, uid: UID });
      expect(await reopened.append(session, i, [ENTRIES[i]!])).toBe(i + 1);
    }
    const file = (dir: string) => readFileSync(join(dir, `${session}.jsonl`));
    expect(file(split.dir).equals(file(one.dir))).toBe(true);
    expect(
      (await fileLedgerStore({ dir: split.dir, key, uid: UID }).load(session)).entries,
    ).toEqual(ENTRIES);
  });

  it('the key and the store path are never in the file', async () => {
    const { key, bytes, dir } = await written();
    const text = bytes.toString('latin1');
    for (const form of [
      Buffer.from(key).toString('hex'),
      Buffer.from(key).toString('base64'),
      Buffer.from(key).toString('latin1'),
      dir,
    ])
      expect(text.includes(form)).toBe(false);
  });
});

describe('fileStore — tamper: every change is mac-mismatch, nothing loads in part', () => {
  it('an edited byte anywhere: mac-mismatch (torn-line only inside the last line)', async () => {
    const { store, session, file, bytes } = await written();
    const lastStart = bytes.lastIndexOf(0x0a, bytes.length - 2) + 1;
    const seen = new Set<string>();
    for (let i = 0; i < bytes.length; i++) {
      for (const flip of [0x01, 0x80]) {
        const edited = Buffer.from(bytes);
        edited[i] = edited[i]! ^ flip;
        writeFileSync(file, edited);
        const code = await codeOf(store.load(session));
        seen.add(code);
        // The newline that ends the line before the last one merges the two into a last line
        // that is not JSON: the case table's `torn-line`. Every byte before it is a middle line.
        if (i < lastStart - 1) expect(code, `byte ${i} ^ ${flip}`).toBe('mac-mismatch');
        else expect(['mac-mismatch', 'torn-line'], `byte ${i} ^ ${flip}`).toContain(code);
      }
    }
    expect(seen).toEqual(new Set(['mac-mismatch', 'torn-line']));
    writeFileSync(file, bytes);
    expect((await store.load(session)).seq).toBe(5);
  }, 60_000);

  it('swapped lines, a removed middle line, or a removed first line: mac-mismatch', async () => {
    const { store, session, file, bytes } = await written();
    const lines = bytes.toString('utf8').split('\n').slice(0, -1);
    const rewrite = (list: string[]) => writeFileSync(file, `${list.join('\n')}\n`);
    rewrite([lines[0]!, lines[2]!, lines[1]!, lines[3]!, lines[4]!]);
    expect(await codeOf(store.load(session))).toBe('mac-mismatch');
    rewrite([lines[0]!, lines[1]!, lines[3]!, lines[4]!]);
    expect(await codeOf(store.load(session))).toBe('mac-mismatch');
    rewrite(lines.slice(1));
    expect(await codeOf(store.load(session))).toBe('mac-mismatch');
    rewrite([lines[0]!, lines[1]!, lines[1]!, lines[2]!, lines[3]!, lines[4]!]);
    expect(await codeOf(store.load(session))).toBe('mac-mismatch');
  });

  it('a line from another session — same key, same entry, same place: mac-mismatch', async () => {
    const key = randomBytes(32);
    const a = fresh(key);
    const sa = mintSessionId();
    const sb = mintSessionId();
    await a.store.append(sa, 0, ENTRIES);
    await a.store.append(sb, 0, ENTRIES);
    const linesA = readFileSync(join(a.dir, `${sa}.jsonl`), 'utf8').split('\n');
    const linesB = readFileSync(join(a.dir, `${sb}.jsonl`), 'utf8').split('\n');
    expect(linesA[2]).not.toBe(linesB[2]); // identical entries, different MACs: the session is in the input
    linesA[2] = linesB[2]!;
    writeFileSync(join(a.dir, `${sa}.jsonl`), linesA.join('\n'));
    expect(await codeOf(a.store.load(sa))).toBe('mac-mismatch');
  });

  it('a file renamed (or copied) to another session: mac-mismatch', async () => {
    const { store, file, dir } = await written();
    const other = mintSessionId();
    copyFileSync(file, join(dir, `${other}.jsonl`));
    expect(await codeOf(store.load(other))).toBe('mac-mismatch');
    expect(
      await codeOf(
        store.append(
          other,
          5,
          [ENTRIES[1]!].map((e) => ({ ...e, seq: 6 })),
        ),
      ),
    ).toBe('mac-mismatch');
  });

  it('another key: mac-mismatch on load, and append refuses to extend the file', async () => {
    const { dir, session, file, bytes } = await written();
    const stranger = fileLedgerStore({ dir, key: randomBytes(32), uid: UID });
    expect(await codeOf(stranger.load(session))).toBe('mac-mismatch');
    const next = unwrap(noteEntry(at(6), { kind: 'claim', text: 'forged 9999', cites: [] }));
    expect(await codeOf(stranger.append(session, 5, [next]))).toBe('mac-mismatch');
    expect(readFileSync(file).equals(bytes)).toBe(true);
  });

  it('a line that is not canonical is refused even with its own MAC', async () => {
    const { store, session, file, bytes } = await written();
    writeFileSync(file, bytes.toString('utf8').replace('{"entry":{', '{"entry": {'));
    expect(await codeOf(store.load(session))).toBe('mac-mismatch');
    writeFileSync(
      file,
      bytes
        .toString('utf8')
        .replace(/"mac":"([0-9a-f]{64})"/, (_, m: string) => `"mac":"${m.toUpperCase()}"`),
    );
    expect(await codeOf(store.load(session))).toBe('mac-mismatch');
  });

  it('a forged line at the canonical node bound is mac-mismatch, never a raw error', async () => {
    const { store, session, file, bytes } = await written();
    const lines = bytes.toString('utf8').split('\n');
    for (let nodes = 98_990; nodes <= 99_010; nodes++) {
      const entry = `[${new Array(nodes).fill(0).join(',')}]`;
      lines[2] = `{"entry":${entry},"mac":"${'0'.repeat(64)}"}`;
      writeFileSync(file, lines.join('\n'));
      expect(await codeOf(store.load(session)), `${nodes} nodes`).toBe('mac-mismatch');
    }
  }, 30_000);

  it('a line whose MAC verifies but whose entry is not a shape is malformed (a key holder wrote it)', async () => {
    const { key, store, session, file } = await written();
    const bad = [ENTRIES[0], { ...ENTRIES[1], tokens: ['NOT A TOKEN'] }];
    writeFileSync(file, linesFor(key, session, bad));
    expect(await codeOf(store.load(session))).toBe('malformed');
    writeFileSync(file, linesFor(key, session, [ENTRIES[0], { ...ENTRIES[1], seq: 3 }]));
    expect(await codeOf(store.load(session))).toBe('malformed');
  });

  it('append reads the tail only: the full chain is the load’s to verify', async () => {
    const { store, session, file, bytes } = await written();
    const lines = bytes.toString('utf8').split('\n');
    lines[1] = lines[1]!.replace('"perf"', '"porf"'); // a middle line edited
    writeFileSync(file, lines.join('\n'));
    const next = unwrap(noteEntry(at(6), { kind: 'claim', text: 'later 4321', cites: [] }));
    expect(await store.append(session, 5, [next])).toBe(6);
    expect(await codeOf(store.load(session))).toBe('mac-mismatch');
    lines[4] = lines[4]!.replace('which', 'whose'); // the LAST line edited: append refuses
    writeFileSync(file, `${lines.slice(0, 5).join('\n')}\n`);
    expect(await codeOf(store.append(session, 5, [next]))).toBe('mac-mismatch');
  });
});

describe('fileStore — a torn tail is refused, never repaired', () => {
  it('the last line cut at EVERY byte offset: torn-line on load and on append, the file unchanged', async () => {
    const { store, session, file, bytes } = await written();
    const lastStart = bytes.lastIndexOf(0x0a, bytes.length - 2) + 1;
    const next = unwrap(noteEntry(at(6), { kind: 'claim', text: 'after the cut 5555', cites: [] }));
    for (let cut = lastStart + 1; cut < bytes.length; cut++) {
      const torn = bytes.subarray(0, cut);
      writeFileSync(file, torn);
      expect(await codeOf(store.load(session)), `cut at ${cut}`).toBe('torn-line');
      expect(await codeOf(store.append(session, 5, [next])), `append at ${cut}`).toBe('torn-line');
      expect(readFileSync(file).equals(torn), `never truncated or extended at ${cut}`).toBe(true);
    }
  }, 60_000);

  it('a cut exactly at a line boundary is an earlier log: only the high-water mark can see it', async () => {
    const { store, session, file, bytes, dir, key } = await written();
    const guarded = withHighWater(store);
    expect((await guarded.load(session)).seq).toBe(5);
    const lastStart = bytes.lastIndexOf(0x0a, bytes.length - 2) + 1;
    writeFileSync(file, bytes.subarray(0, lastStart));
    expect(await codeOf(guarded.load(session))).toBe('rolled-back');
    expect((await fileLedgerStore({ dir, key, uid: UID }).load(session)).seq).toBe(4);
  });

  it('an empty file, a last line that is not JSON, and a middle line that is not JSON', async () => {
    const { store, session, file, bytes } = await written();
    writeFileSync(file, '');
    expect(await codeOf(store.load(session))).toBe('torn-line');
    writeFileSync(file, Buffer.concat([bytes, Buffer.from('not json\n')]));
    expect(await codeOf(store.load(session))).toBe('torn-line');
    const lines = bytes.toString('utf8').split('\n');
    lines[2] = 'not json';
    writeFileSync(file, lines.join('\n'));
    expect(await codeOf(store.load(session))).toBe('mac-mismatch');
  });

  it('restoring a saved earlier copy: rolled-back for this instance, invisible to a fresh one', async () => {
    const { store, session, file, dir, key } = await written(ENTRIES.slice(0, 3));
    const early = readFileSync(file);
    await store.append(session, 3, ENTRIES.slice(3));
    const guarded = withHighWater(store);
    expect((await guarded.load(session)).seq).toBe(5);
    writeFileSync(file, early);
    expect(await codeOf(guarded.load(session))).toBe('rolled-back');
    expect((await withHighWater(fileLedgerStore({ dir, key, uid: UID })).load(session)).seq).toBe(
      3,
    );
  });
});

describe('fileStore — the canonical bounds nest: an entry at an edge still reads back', () => {
  const ZERO = { visible: 0, missing: 0, supplied: 0, incomplete: 0 };
  /** An object of `n` 40-character keys and one nested pair of `pad`-long keys: heavy to sort. */
  const sortHeavy = (n: number, pad: number) => {
    const o: Record<string, unknown> = {};
    for (let i = 0; i < n; i++) o[String(i).padStart(40, '0')] = 0;
    o['~'] = { ['a'.repeat(pad)]: 0, ['b'.repeat(pad)]: 0 };
    return o;
  };
  /**
   * A check entry carrying `decision`, the one free-form field a stored entry has — with its keys
   * already in canonical order at every depth, so its parsed copy sorts exactly as dearly as the
   * caller's object did (a key order the parse would tidy could hide a bound with no margin).
   */
  const checkWith = (decision: unknown) =>
    canonicalCopy({
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
      counts: ZERO,
      decision,
    });
  const canonicalCopy = (value: unknown) =>
    JSON.parse(
      canonicalizeJson(value, {
        maxBytes: 4_194_304,
        maxNodes: 100_000,
        maxFields: 100_000,
        maxSortWork: 2_000_000,
        maxDepth: 128,
      }),
    ) as LedgerEntry;
  const admits = (entry: LedgerEntry) => {
    try {
      admitEntry(entry, 2);
      return true;
    } catch {
      return false;
    }
  };
  /** The largest x in [lo, hi] for which the monotone `ok` holds. */
  const edge = (lo: number, hi: number, ok: (x: number) => boolean) => {
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (ok(mid)) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const refusedFor = (value: unknown, bounds: object) => {
    try {
      canonicalizeJson(value, bounds);
      return 'ok';
    } catch (error) {
      return (error as CanonicalJsonError).code;
    }
  };

  async function appendsAndReadsBack(entry: LedgerEntry) {
    const { store } = fresh();
    const session = mintSessionId();
    await store.append(session, 0, [ENTRIES[0]!]);
    expect(await store.append(session, 1, [entry])).toBe(2);
    expect((await store.load(session)).entries[1]).toEqual(entry);
  }

  it('an entry admitted at the SORT-WORK edge is appended and reads back', async () => {
    const n = edge(100, 8_000, (k) => admits(checkWith(sortHeavy(k, 1))));
    const pad = edge(1, 5_000, (p) => admits(checkWith(sortHeavy(n, p))));
    expect(refusedFor(checkWith(sortHeavy(n, pad + 1)), entryCanonical())).toBe('sort-work');
    await appendsAndReadsBack(checkWith(sortHeavy(n, pad)));
  }, 30_000);

  it('an entry admitted at the NODE edge is appended and reads back', async () => {
    const m = edge(1_000, 99_900, (k) => admits(checkWith({ list: new Array(k).fill(0) })));
    expect(refusedFor(checkWith({ list: new Array(m + 1).fill(0) }), entryCanonical())).toBe(
      'nodes',
    );
    await appendsAndReadsBack(checkWith({ list: new Array(m).fill(0) }));
  }, 30_000);

  it('an entry admitted at the DEPTH edge is appended and reads back', async () => {
    const nested = (depth: number): unknown => (depth === 0 ? 0 : { d: nested(depth - 1) });
    const d = edge(1, 120, (k) => admits(checkWith(nested(k))));
    expect(refusedFor(checkWith(nested(d + 1)), entryCanonical())).toBe('depth');
    await appendsAndReadsBack(checkWith(nested(d)));
  }, 30_000);

  it("a forged line at the LINE's sort-work edge is mac-mismatch, never a raw error", async () => {
    const wraps = (e: unknown) =>
      refusedFor({ entry: e, mac: '0'.repeat(64) }, LINE_CANONICAL) === 'ok';
    const n = edge(100, 8_000, (k) => wraps(sortHeavy(k, 1)));
    const pad = edge(1, 5_000, (p) => wraps(sortHeavy(n, p)));
    expect(wraps(sortHeavy(n, pad + 1))).toBe(false);
    const { store, session, file, bytes } = await written();
    const lines = bytes.toString('utf8').split('\n');
    lines[2] = canonicalizeJson({ entry: sortHeavy(n, pad), mac: '0'.repeat(64) }, LINE_CANONICAL);
    writeFileSync(file, lines.join('\n'));
    expect(await codeOf(store.load(session))).toBe('mac-mismatch');
  }, 30_000);
});

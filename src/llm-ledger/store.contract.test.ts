/**
 * THE STORE CONTRACT — one suite, run on every adapter (case table 4.1–4.3, 4.9, 6.5).
 *
 * Contract: the same calls give the same answers on `memoryLedgerStore()` and on
 * `fileLedgerStore()`: an unknown session is seq 0; numbering is the caller's and anything else
 * is `malformed`; a stale `expectedSeq` is `'conflict'` and writes nothing; a malformed batch is
 * refused before the seq is compared; the caps (entries, line, log) are `too-large`, exactly at
 * the edge; loads are deep-frozen copies; and splitting appends any way gives the same log.
 * The file store's own cases (bytes, MAC, tamper, permissions, lock) are in `fileStore*.test.ts`.
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalizeJson } from 'foottrace/canonical-json';
import { afterAll, describe, expect, it } from 'vitest';

import { noteEntry, openedEntry } from './build.js';
import { fileLedgerStore } from './fileStore.js';
import { LEDGER_LIMITS } from './limits.js';
import { memoryLedgerStore } from './memoryStore.js';
import { mintSessionId } from './session.js';
import { LINE_OVERHEAD_BYTES, LedgerStoreError, withHighWater } from './store.js';
import type { LedgerStore } from './store.js';
import type { LedgerEntry } from './types.js';

const AT = '2026-11-25T10:00:00Z';
const made: string[] = [];
afterAll(() => made.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const ADAPTERS: ReadonlyArray<readonly [string, () => LedgerStore]> = [
  ['memoryLedgerStore', () => memoryLedgerStore()],
  [
    'fileLedgerStore',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'af-llm-ledger-contract-'));
      made.push(dir);
      return fileLedgerStore({
        dir: join(dir, 'store'),
        key: randomBytes(32),
        uid: process.getuid!(),
      });
    },
  ],
];

function unwrap<E extends LedgerEntry>(built: { ok: boolean; entry?: E }): E {
  if (!built.ok) throw new Error('fixture refused');
  return built.entry as E;
}
const opened = (seq = 1): LedgerEntry =>
  unwrap(openedEntry({ seq, at: AT }, { rules: ['cited@1'] }));
const note = (seq: number, text = `note ${seq} 1234`): LedgerEntry =>
  unwrap(noteEntry({ seq, at: AT }, { kind: 'claim', text, cites: [] }));
const notes = (from: number, count: number): LedgerEntry[] =>
  Array.from({ length: count }, (_, i) => note(from + i));

/** A check entry whose stored line is exactly `lineBytes` bytes. */
function lineOf(seq: number, lineBytes: number): LedgerEntry {
  const make = (label: string) => ({
    v: 1,
    seq,
    kind: 'check',
    by: 'ledger',
    how: 'observed',
    at: AT,
    submit: 1,
    subject: { draft: true },
    rule: 'cited@1',
    disposition: 'not-applicable',
    restsOn: [],
    decision: { label },
    counts: { visible: 0, missing: 0, supplied: 0, incomplete: 0 },
  });
  const base = new TextEncoder().encode(canonicalizeJson(make(''))).length + LINE_OVERHEAD_BYTES;
  return make('x'.repeat(lineBytes - base)) as unknown as LedgerEntry;
}

async function refusedWith(work: Promise<unknown>): Promise<{ code: string; field?: string }> {
  try {
    await work;
  } catch (error) {
    expect(error).toBeInstanceOf(LedgerStoreError);
    const { code, field } = error as LedgerStoreError;
    return field === undefined ? { code } : { code, field };
  }
  throw new Error('expected a LedgerStoreError');
}

for (const [name, makeStore] of ADAPTERS) {
  describe(`store contract — ${name}`, () => {
    it('an unknown session loads as seq 0, no entries, frozen', async () => {
      const log = await makeStore().load(mintSessionId());
      expect(log).toEqual({ seq: 0, entries: [] });
      expect(Object.isFrozen(log)).toBe(true);
      expect(Object.isFrozen(log.entries)).toBe(true);
    });

    it('a session opens with append(s, 0, [opened]) and loads back deep-frozen, as a copy', async () => {
      const store = makeStore();
      const s = mintSessionId();
      const first = opened();
      expect(await store.append(s, 0, [first])).toBe(1);
      const log = await store.load(s);
      expect(log.seq).toBe(1);
      expect(log.entries).toEqual([first]);
      expect(log.entries[0]).not.toBe(first);
      expect(Object.isFrozen(log.entries[0])).toBe(true);
      expect(Object.isFrozen((log.entries[0] as { rules: unknown }).rules)).toBe(true);
      expect(await store.append(s, 1, notes(2, 3))).toBe(4);
      expect((await store.load(s)).entries.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    });

    it('a session id is checked before anything else: malformed, on load and on append', async () => {
      const store = makeStore();
      for (const bad of [
        '../escape',
        `ls_${'0'.repeat(25)}`,
        '',
        'ls_0000000000000000000000000/',
      ]) {
        expect(await refusedWith(store.load(bad))).toEqual({ code: 'malformed', field: 'session' });
        expect(await refusedWith(store.append(bad, 0, [opened()]))).toEqual({
          code: 'malformed',
          field: 'session',
        });
      }
    });

    it('the caller numbers; any other numbering is malformed', async () => {
      const store = makeStore();
      const s = mintSessionId();
      await store.append(s, 0, [opened()]);
      expect(await refusedWith(store.append(s, 1, [note(3)]))).toEqual({
        code: 'malformed',
        field: 'seq',
      });
      expect(await refusedWith(store.append(s, 1, [note(2), note(2)]))).toEqual({
        code: 'malformed',
        field: 'seq',
      });
      expect(await refusedWith(store.append(s, 1, [note(2), note(4)]))).toEqual({
        code: 'malformed',
        field: 'seq',
      });
      expect((await store.load(s)).seq).toBe(1);
    });

    it('seq 1 is the session’s opened, and no other entry is', async () => {
      const store = makeStore();
      const s = mintSessionId();
      expect(await refusedWith(store.append(s, 0, [note(1)]))).toEqual({
        code: 'malformed',
        field: 'kind',
      });
      await store.append(s, 0, [opened()]);
      expect(await refusedWith(store.append(s, 1, [opened(2)]))).toEqual({
        code: 'malformed',
        field: 'kind',
      });
    });

    it('a stale expectedSeq is conflict, and writes nothing', async () => {
      const store = makeStore();
      const s = mintSessionId();
      await store.append(s, 0, [opened()]);
      await store.append(s, 1, notes(2, 2));
      expect(await store.append(s, 0, [opened()])).toBe('conflict');
      expect(await store.append(s, 1, [note(2)])).toBe('conflict');
      expect(await store.append(s, 7, [note(8)])).toBe('conflict');
      const log = await store.load(s);
      expect(log.seq).toBe(3);
      expect(log.entries.map((e) => e.kind)).toEqual(['opened', 'note', 'note']);
      expect(await store.append(mintSessionId(), 2, [note(3)])).toBe('conflict');
    });

    it('a malformed batch is refused before the seq is compared', async () => {
      const store = makeStore();
      const s = mintSessionId();
      await store.append(s, 0, [opened()]);
      const bad = { ...note(1), text: '' } as unknown as LedgerEntry;
      expect(await refusedWith(store.append(s, 0, [bad]))).toEqual({
        code: 'malformed',
        field: 'text',
      });
    });

    it.each([
      ['an empty batch', 0, [], 'entries'],
      ['not an array', 0, 'opened' as unknown as LedgerEntry[], 'entries'],
      ['a negative expectedSeq', -1, [], 'expectedSeq'],
      ['a fractional expectedSeq', 0.5, [], 'expectedSeq'],
      [
        'a value JSON cannot hold',
        0,
        [{ ...{ v: 1 }, bad: () => 1 }] as unknown as LedgerEntry[],
        'entry',
      ],
      ['an entry with a sparse hole', 0, new Array(1) as LedgerEntry[], 'entries'],
    ])('%s is malformed', async (_name, expectedSeq, entries, field) => {
      expect(await refusedWith(makeStore().append(mintSessionId(), expectedSeq, entries))).toEqual({
        code: 'malformed',
        field,
      });
    });

    it('an entry is read as data: a getter is never called, a cycle never followed', async () => {
      let called = false;
      const sly = { ...opened() } as Record<string, unknown>;
      Object.defineProperty(sly, 'confirm', {
        enumerable: true,
        get() {
          called = true;
          return false;
        },
      });
      const store = makeStore();
      expect(
        (await refusedWith(store.append(mintSessionId(), 0, [sly as unknown as LedgerEntry]))).code,
      ).toBe('malformed');
      expect(called).toBe(false);
      const cyclic = { ...opened() } as Record<string, unknown>;
      cyclic.self = cyclic;
      expect(
        (await refusedWith(store.append(mintSessionId(), 0, [cyclic as unknown as LedgerEntry])))
          .code,
      ).toBe('malformed');
    });

    it('the stored copy does not follow the caller’s object after append', async () => {
      const store = makeStore();
      const s = mintSessionId();
      const mine = JSON.parse(JSON.stringify(opened())) as { rules: string[] };
      await store.append(s, 0, [mine as unknown as LedgerEntry]);
      mine.rules.push('acme/late@1');
      expect((await store.load(s)).entries[0]).toEqual(opened());
    });

    it('a line is at most 256 KiB, exactly at the edge', async () => {
      const store = makeStore();
      const s = mintSessionId();
      await store.append(s, 0, [opened()]);
      expect(
        await refusedWith(store.append(s, 1, [lineOf(2, LEDGER_LIMITS.maxLineBytes + 1)])),
      ).toEqual({
        code: 'too-large',
      });
      expect(await store.append(s, 1, [lineOf(2, LEDGER_LIMITS.maxLineBytes)])).toBe(2);
      expect((await store.load(s)).seq).toBe(2);
    });

    it('a session holds at most 10,000 entries; at the cap every append is refused', async () => {
      const store = makeStore();
      const s = mintSessionId();
      await store.append(s, 0, [opened()]);
      await store.append(s, 1, notes(2, LEDGER_LIMITS.maxEntries - 2));
      expect(
        await store.append(s, LEDGER_LIMITS.maxEntries - 1, [note(LEDGER_LIMITS.maxEntries)]),
      ).toBe(LEDGER_LIMITS.maxEntries);
      expect(await refusedWith(store.append(s, LEDGER_LIMITS.maxEntries, [note(10_001)]))).toEqual({
        code: 'too-large',
      });
      const log = await store.load(s);
      expect(log.seq).toBe(LEDGER_LIMITS.maxEntries);
      expect(
        await refusedWith(store.append(mintSessionId(), 0, [opened(), ...notes(2, 10_000)])),
      ).toEqual({
        code: 'too-large',
      });
    }, 60_000);

    it('a session holds at most 32 MiB of lines, exactly at the edge; past it nothing is written', async () => {
      const store = makeStore();
      const s = mintSessionId();
      await store.append(s, 0, [opened()]);
      const openedBytes =
        new TextEncoder().encode(canonicalizeJson(opened())).length + LINE_OVERHEAD_BYTES;
      const full = Array.from({ length: 127 }, (_, i) => lineOf(i + 2, LEDGER_LIMITS.maxLineBytes));
      expect(await store.append(s, 1, full)).toBe(128);
      const left = LEDGER_LIMITS.maxLogBytes - openedBytes - 127 * LEDGER_LIMITS.maxLineBytes;
      expect(await refusedWith(store.append(s, 128, [lineOf(129, left + 1)]))).toEqual({
        code: 'too-large',
      });
      expect(await store.append(s, 128, [lineOf(129, left)])).toBe(129);
      expect(await refusedWith(store.append(s, 129, [note(130)]))).toEqual({ code: 'too-large' });
      expect((await store.load(s)).seq).toBe(129);
    }, 120_000);

    it('splitting the appends any way gives the same log', async () => {
      const entries = [opened(), ...notes(2, 9)];
      const logs = [];
      for (const cuts of [[10], [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], [1, 4, 5], [3, 7]]) {
        const store = makeStore();
        const s = mintSessionId();
        let at = 0;
        for (const size of cuts) {
          expect(await store.append(s, at, entries.slice(at, at + size))).toBe(at + size);
          at += size;
        }
        logs.push((await store.load(s)).entries);
      }
      for (const log of logs) expect(log).toEqual(logs[0]);
      expect(logs[0]).toEqual(entries);
    });

    it('two appends at one seq, at once: exactly one wins', async () => {
      const store = makeStore();
      const s = mintSessionId();
      await store.append(s, 0, [opened()]);
      const results = await Promise.all([
        store.append(s, 1, [note(2, 'first 1111')]),
        store.append(s, 1, [note(2, 'second 2222')]),
        store.append(s, 1, [note(2, 'third 3333')]),
      ]);
      expect(results.filter((r) => r === 2)).toHaveLength(1);
      expect(results.filter((r) => r === 'conflict')).toHaveLength(2);
      expect((await store.load(s)).seq).toBe(2);
    });

    it('withHighWater passes an honest store through unchanged', async () => {
      const store = withHighWater(makeStore());
      const s = mintSessionId();
      expect(await store.append(s, 0, [opened()])).toBe(1);
      expect(await store.append(s, 1, notes(2, 2))).toBe(3);
      expect((await store.load(s)).seq).toBe(3);
      expect(await store.append(s, 1, [note(2)])).toBe('conflict');
      expect((await store.load(mintSessionId())).seq).toBe(0);
    });
  });
}

describe('withHighWater — a load below what this instance has seen is rolled-back', () => {
  /** A store whose next load answers from an earlier copy, as a restored backup would. */
  function rewindable() {
    const real = memoryLedgerStore();
    let rewindTo: number | undefined;
    const store: LedgerStore = {
      async load(session) {
        const log = await real.load(session);
        if (rewindTo === undefined) return log;
        return { seq: rewindTo, entries: log.entries.slice(0, rewindTo) };
      },
      append: (session, expectedSeq, entries) =>
        rewindTo === undefined
          ? real.append(session, expectedSeq, entries)
          : Promise.resolve(expectedSeq === rewindTo ? expectedSeq + entries.length : 'conflict'),
    };
    return { store, rewind: (seq: number) => (rewindTo = seq) };
  }

  it('refuses a load below the highest seq seen, through load or append', async () => {
    const { store, rewind } = rewindable();
    const guarded = withHighWater(store);
    const s = mintSessionId();
    await guarded.append(s, 0, [opened()]);
    await guarded.append(s, 1, notes(2, 3));
    rewind(2);
    expect(await refusedWith(guarded.load(s))).toEqual({ code: 'rolled-back' });
  });

  it('a caller behind the mark gets conflict without the store being asked', async () => {
    const { store, rewind } = rewindable();
    const guarded = withHighWater(store);
    const s = mintSessionId();
    await guarded.append(s, 0, [opened()]);
    await guarded.append(s, 1, notes(2, 3));
    rewind(2);
    // The rewound store would accept an append at 2 — the mark refuses to ask it.
    expect(await store.append(s, 2, [note(3)])).toBe(3);
    expect(await guarded.append(s, 2, [note(3)])).toBe('conflict');
  });

  it('the mark is per session and per instance', async () => {
    const { store, rewind } = rewindable();
    const s = mintSessionId();
    await withHighWater(store).append(s, 0, [opened()]);
    await store.append(s, 1, notes(2, 3));
    rewind(2);
    const fresh = withHighWater(store);
    // A fresh instance cannot know what another one saw: the bound the README states.
    expect((await fresh.load(s)).seq).toBe(2);
    const seen = withHighWater(store);
    rewind(4);
    expect((await seen.load(s)).seq).toBe(4);
    const other = mintSessionId();
    rewind(0);
    expect((await seen.load(other)).seq).toBe(0); // another session's mark is its own
    expect(await refusedWith(seen.load(s))).toEqual({ code: 'rolled-back' });
  });
});

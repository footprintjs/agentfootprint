/**
 * NEVER STORED — the log holds facts, not content (case table 5.5).
 *
 * The property: plant marker strings in every text input a session takes — the text of a read, a
 * supplied value, a note's text and values, a draft, a delivered answer — and in the store's
 * directory name and key. After the whole session is built and written, a marker appears ONLY in
 * `note.text`, `note.values` and token sets (`receipt.tokens`, `supplied.tokens`), and the key and
 * the path appear nowhere in the file. Two markers per run: one no token rule can see (letters
 * only, so it may live in a note and nowhere else), one that IS a token (so a token set may keep
 * it, which is the design). A refusal never carries a marker either.
 *
 * Inputs: seeded, so every run checks the same sessions.
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
  deliveredEntry,
  noteEntry,
  openedEntry,
  receiptEntry,
  submitEntry,
  suppliedEntry,
  withdrawalEntry,
} from '../../src/llm-ledger/build.js';
import { fileLedgerStore } from '../../src/llm-ledger/fileStore.js';
import { memoryLedgerStore } from '../../src/llm-ledger/memoryStore.js';
import { mintSessionId } from '../../src/llm-ledger/session.js';
import { LedgerStoreError } from '../../src/llm-ledger/store.js';
import type { LedgerEntry } from '../../src/llm-ledger/types.js';
import { seeded } from '../helpers/seededText.js';

const made: string[] = [];
afterAll(() => made.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const AT = '2026-11-25T10:00:00Z';
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

function unwrap<E extends LedgerEntry>(built: { ok: boolean; entry?: E; refused?: string }): E {
  if (!built.ok) throw new Error(`fixture refused: ${built.refused}`);
  return built.entry as E;
}

/** Every string in a value, with the path it sits at (`note.text`, `receipt.tokens[]`, …). */
function stringsOf(value: unknown, path: string, out: Array<[string, string]>): void {
  if (typeof value === 'string') out.push([path, value]);
  else if (Array.isArray(value)) value.forEach((v) => stringsOf(v, `${path}[]`, out));
  else if (typeof value === 'object' && value !== null)
    for (const [k, v] of Object.entries(value)) stringsOf(v, `${path}.${k}`, out);
}

/** Where text read from a result may be kept: the agent's own note, which quotes it. Nowhere else. */
const MAY_HOLD_ANY = new Set(['note.text', 'note.values[]']);
/** Where the other free text is stored BY DESIGN: a withdrawal's reason and the host's query. */
const MAY_HOLD_ASKED = new Set(['withdrawal.why', 'receipt.query']);
const MAY_HOLD_TOKEN = new Set([...MAY_HOLD_ANY, 'receipt.tokens[]', 'supplied.tokens[]']);

async function sessionWithMarkers(next: () => number) {
  const word = (n: number) =>
    Array.from({ length: n }, () => LETTERS[Math.floor(next() * 26)]).join('');
  // A marker no rule can see (letters only) and one that is a token (digit-bearing, ≥ 4 chars).
  const hidden = `zq${word(10)}`;
  // A third marker, for the two other free-text fields: it may live there and nowhere else.
  const asked = `xk${word(10)}`;
  const token = `mk${word(4)}${Math.floor(next() * 9000) + 1000}`;
  const prose = (n: number) =>
    Array.from({ length: n }, () =>
      next() < 0.15 ? hidden : next() < 0.15 ? token : word(1 + Math.floor(next() * 8)),
    ).join(' ');
  const surround = (n: number) => `${prose(n)} ${hidden} ${token} ${prose(n)}`;
  const at = (seq: number) => ({ seq, at: AT });
  const draft = surround(30);
  const submit = unwrap(await submitEntry(at(6), { draft, claims: [4] }));
  const entries: LedgerEntry[] = [
    unwrap(openedEntry(at(1), { rules: ['cited@1'] })),
    unwrap(
      receiptEntry(at(2), {
        source: 'search_logs',
        text: surround(200),
        query: `errors near ${asked}`,
        hidden: Math.floor(next() * 3),
      }),
    ),
    unwrap(await suppliedEntry(at(3), { from: 'person', text: surround(20) })),
    unwrap(
      noteEntry(at(4), { kind: 'claim', text: surround(10), values: [token, hidden], cites: [2] }),
    ),
    unwrap(
      receiptEntry(at(5), {
        source: 'perf',
        text: JSON.stringify({ rows: [{ note: surround(15), id: token }] }),
      }),
    ),
    submit,
    unwrap(
      await deliveredEntry(
        at(7),
        { text: `${draft} ${surround(5)}` },
        { seq: 6, draftDigest: submit.draftDigest },
      ),
    ),
    unwrap(
      await deliveredEntry(at(8), { text: draft }, { seq: 6, draftDigest: submit.draftDigest }),
    ),
    unwrap(withdrawalEntry(at(9), { note: 4, why: `misread ${asked} as a value` })),
  ];
  return { hidden, token, asked, entries, dirName: `ledger-${hidden}` };
}

describe('never stored: markers land only in note text, note values and token sets', () => {
  it('holds for seeded sessions, in the entries and in the bytes of the file', async () => {
    const next = seeded(55);
    for (let run = 0; run < 40; run++) {
      const { hidden, token, asked, entries, dirName } = await sessionWithMarkers(next);
      const root = mkdtempSync(join(tmpdir(), 'af-llm-ledger-markers-'));
      made.push(root);
      const dir = join(root, dirName);
      const key = randomBytes(32);
      const session = mintSessionId();
      await fileLedgerStore({ dir, key, uid: process.getuid!() }).append(session, 0, entries);
      const memory = memoryLedgerStore();
      await memory.append(session, 0, entries);
      const loaded = (await fileLedgerStore({ dir, key, uid: process.getuid!() }).load(session))
        .entries;
      expect(loaded).toEqual((await memory.load(session)).entries);

      let hiddenSeen = 0;
      for (const entry of loaded) {
        const strings: Array<[string, string]> = [];
        stringsOf(entry, entry.kind, strings);
        for (const [path, value] of strings) {
          if (value.includes(hidden)) {
            expect(MAY_HOLD_ANY.has(path), `${hidden} at ${path}`).toBe(true);
            hiddenSeen += value.split(hidden).length - 1;
          }
          if (value.includes(token))
            expect(MAY_HOLD_TOKEN.has(path), `${token} at ${path}`).toBe(true);
          if (value.includes(asked))
            expect(MAY_HOLD_ASKED.has(path), `${asked} at ${path}`).toBe(true);
        }
      }
      // The token marker is kept where the design keeps it: the read's tokens, the supplied tokens, the note.
      expect(loaded.find((e) => e.kind === 'receipt')).toMatchObject({
        tokens: expect.arrayContaining([token]),
      });
      expect(loaded.find((e) => e.kind === 'supplied')).toMatchObject({
        tokens: expect.arrayContaining([token]),
      });

      // The file holds no copy the entries do not: the hidden marker only as often as the notes hold it.
      const bytes = readFileSync(join(dir, `${session}.jsonl`));
      const text = bytes.toString('latin1');
      expect(text.split(hidden).length - 1).toBe(hiddenSeen);
      expect(text.includes(dirName)).toBe(false);
      expect(text.includes(dir)).toBe(false);
      for (const form of ['hex', 'base64', 'base64url', 'latin1'] as const)
        expect(text.includes(Buffer.from(key).toString(form)), form).toBe(false);
    }
  }, 60_000);

  it('a refusal never carries a marker', async () => {
    const { hidden, entries } = await sessionWithMarkers(seeded(3));
    const store = memoryLedgerStore();
    const session = mintSessionId();
    await store.append(session, 0, entries.slice(0, 1));
    // The marker as a field NAME too: a refusal names a field by a fixed word, never by the key.
    const smuggled = { ...entries[3]!, stray: hidden, [hidden]: 1 } as unknown as LedgerEntry;
    for (const attempt of [
      store.append(session, 1, [{ ...smuggled, seq: 2 } as LedgerEntry]),
      store.append(session, 1, [
        { ...entries[3]!, seq: 2, text: `${hidden}\ud800` } as LedgerEntry,
      ]),
      store.append(`ls_${hidden}`, 0, entries.slice(0, 1)),
    ]) {
      const error = await attempt.then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(LedgerStoreError);
      expect(String((error as Error).message)).not.toContain(hidden);
      expect(JSON.stringify(error)).not.toContain(hidden);
    }
    const refused = await noteEntry(
      { seq: 9, at: AT },
      { kind: 'claim', text: `${hidden}`.repeat(300), cites: [] },
    );
    expect(JSON.stringify(refused)).not.toContain(hidden);
  });
});

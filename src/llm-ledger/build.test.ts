/**
 * build — the record-time builders (case table 5, 5.1, 5.5, 6.4's input words).
 *
 * Unit: each builder makes an entry `entryFault` passes, drops the text it was handed, and refuses
 * with the closed word its case names. The generated marker property is in
 * `test/llm-ledger/never-stored.test.ts`.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  deliveredEntry,
  noteEntry,
  openedEntry,
  receiptEntry,
  submitEntry,
  suppliedEntry,
  withdrawalEntry,
} from './build.js';
import { entryFault, isIncomplete } from './entries.js';
import type { LedgerEntry } from './types.js';

const AT = '2026-11-25T10:00:00Z';
const at = (seq: number) => ({ seq, at: AT });
const sha = (text: string) => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;

function entryOf<E extends LedgerEntry>(built: { ok: boolean; entry?: E; refused?: string }): E {
  expect(built.ok, `refused: ${built.refused}`).toBe(true);
  expect(entryFault(built.entry)).toBeUndefined();
  expect(Object.isFrozen(built.entry)).toBe(true);
  return built.entry as E;
}
const refusal = (built: { ok: boolean; refused?: string }) => (built.ok ? 'built' : built.refused);

describe('openedEntry', () => {
  it('defaults to no rules, no confirm, ask runs no rules', () => {
    expect(entryOf(openedEntry(at(1), {}))).toEqual({
      v: 1,
      seq: 1,
      kind: 'opened',
      by: 'host',
      how: 'observed',
      at: AT,
      rules: [],
      confirm: false,
      askRunsRules: false,
    });
  });

  it('refuses a rule name that is not id@version, and an unknown option', () => {
    expect(refusal(openedEntry(at(1), { rules: ['cited'] }))).toBe('bad-input');
    expect(refusal(openedEntry(at(1), { rules: ['cited@1', 'cited@1'] }))).toBe('bad-input');
    expect(refusal(openedEntry(at(1), { confirm: 'yes' as unknown as boolean }))).toBe('bad-input');
    expect(refusal(openedEntry(at(1), { session: 'x' } as never))).toBe('bad-input');
    expect(
      refusal(openedEntry(at(1), { rules: Array.from({ length: 17 }, () => 'cited@1') })),
    ).toBe('too-large');
  });
});

describe('receiptEntry — tokens at record time, never the text', () => {
  it('keeps the tokens, the byte count and the facts; the text is gone', () => {
    const text = 'host esx01a zebrafinch 41,200 IOPS (secret: hunter-two)';
    const e = entryOf(
      receiptEntry(at(2), {
        source: 'perf_query',
        text,
        query: 'iops by host',
        window: { from: '2026-11-25T09:00:00Z', to: AT },
        limit: { rows: 50, hit: false },
        hidden: 0,
        ref: { uri: 'perf://q/1', digest: sha(text) },
        externalId: 'call-1',
      }),
    );
    expect(e).toMatchObject({
      kind: 'receipt',
      by: 'host',
      how: 'observed',
      source: 'perf_query',
      bytes: new TextEncoder().encode(text).length,
      nothingFound: false,
      tokens: ['esx01a'], // `41,200` is no token: it is counted, and the receipt is incomplete
      groupedNumbers: 1,
    });
    expect(isIncomplete(e)).toBe(true);
    expect(e).not.toHaveProperty('hidden'); // 0 masked is written as nothing masked
    expect(e).not.toHaveProperty('cut');
    expect(JSON.stringify(e)).not.toContain('hunter');
    expect(JSON.stringify(e)).not.toContain('zebrafinch');
  });

  it('how is the host statement; reported when the host says so', () => {
    expect(entryOf(receiptEntry(at(2), { source: 's', text: '', how: 'reported' })).how).toBe(
      'reported',
    );
    expect(
      refusal(receiptEntry(at(2), { source: 's', text: '', how: 'guessed' as 'observed' })),
    ).toBe('bad-input');
  });

  it('over the cap it keeps what fits and says what it left out', () => {
    const text = Array.from({ length: 2_049 }, (_, i) => `t${String(i).padStart(7, '0')}`).join(
      ' ',
    );
    const e = entryOf(receiptEntry(at(2), { source: 's', text, hidden: 3, nothingFound: true }));
    expect(e.tokens).toHaveLength(2_048);
    expect(e.cut).toEqual({ tokensDropped: 1, bytesUnread: 0 });
    expect(e.hidden).toBe(3);
    expect(e.nothingFound).toBe(true);
  });

  it.each([
    ['no source', { text: 'x' }, 'bad-input'],
    ['an empty source', { source: '', text: 'x' }, 'bad-input'],
    ['a source with a newline', { source: 'a\nb', text: 'x' }, 'bad-input'],
    ['a source past 128', { source: 's'.repeat(129), text: 'x' }, 'too-large'],
    ['no text', { source: 's' }, 'bad-input'],
    ['a text that is not a string', { source: 's', text: 42 }, 'bad-input'],
    ['a query past 1,024', { source: 's', text: 'x', query: 'q'.repeat(1_025) }, 'too-large'],
    ['a bad window', { source: 's', text: 'x', window: { from: AT, to: AT } }, 'bad-window'],
    ['a window that is a string', { source: 's', text: 'x', window: AT }, 'bad-window'],
    ['a limit of 0 rows', { source: 's', text: 'x', limit: { rows: 0, hit: true } }, 'bad-input'],
    ['a negative hidden', { source: 's', text: 'x', hidden: -1 }, 'bad-input'],
    ['a ref without a digest', { source: 's', text: 'x', ref: { uri: 'u' } }, 'bad-input'],
    [
      'a ref uri past 512',
      { source: 's', text: 'x', ref: { uri: 'u'.repeat(513), digest: sha('') } },
      'too-large',
    ],
    [
      'an externalId past 256',
      { source: 's', text: 'x', externalId: 'e'.repeat(257) },
      'too-large',
    ],
    ['an unknown field', { source: 's', text: 'x', session: 'ls_x' }, 'bad-input'],
  ])('%s is %s', (_name, input, word) => {
    expect(refusal(receiptEntry(at(2), input as never))).toBe(word);
  });

  it('reads own data fields only: a getter is refused, never called', () => {
    let called = false;
    const input = {
      source: 's',
      get text() {
        called = true;
        return 'x';
      },
    };
    expect(refusal(receiptEntry(at(2), input))).toBe('bad-input');
    expect(called).toBe(false);
    // An accessor on an OPTIONAL field is refused too — never read, never silently dropped.
    const optional = {
      source: 's',
      text: 'x',
      get query() {
        called = true;
        return 'q';
      },
    };
    expect(refusal(receiptEntry(at(2), optional))).toBe('bad-input');
    expect(called).toBe(false);
    expect(refusal(receiptEntry(at(2), Object.create({ source: 's', text: 'x' })))).toBe(
      'bad-input',
    );
  });
});

describe('suppliedEntry — host only, tokens and a digest', () => {
  it('keeps tokens, bytes and the digest; never the text', async () => {
    const text = 'the person said the window is 2026-11-01 and PIN 9911';
    const e = entryOf(await suppliedEntry(at(3), { from: 'person', text }));
    expect(e).toMatchObject({
      kind: 'supplied',
      by: 'host',
      from: 'person',
      tokens: ['2026-11-01', '9911'],
    });
    expect(e.digest).toBe(sha(text));
    expect(JSON.stringify(e)).not.toContain('person said');
  });

  it('a value that would be cut is refused whole: a supplied entry has no cut', async () => {
    const many = Array.from({ length: 2_049 }, (_, i) => `t${String(i).padStart(7, '0')}`).join(
      ' ',
    );
    expect(refusal(await suppliedEntry(at(3), { from: 'app', text: many }))).toBe('too-large');
    expect(refusal(await suppliedEntry(at(3), { from: 'app', text: `a${'1'.repeat(64)}` }))).toBe(
      'too-large',
    );
    expect(refusal(await suppliedEntry(at(3), { from: 'app', text: 'x'.repeat(1_048_577) }))).toBe(
      'too-large',
    );
    expect(refusal(await suppliedEntry(at(3), { from: 'agent' as 'app', text: 'x' }))).toBe(
      'bad-input',
    );
    expect(refusal(await suppliedEntry(at(3), { from: 'app', text: 'a\udc00' }))).toBe('bad-input');
  });
});

describe('noteEntry and withdrawalEntry — the agent’s own words', () => {
  it('keeps the text and values as written; cites become a set', () => {
    const e = entryOf(
      noteEntry(at(9), {
        kind: 'claim',
        text: 'esx01a peaked at 41,200',
        values: ['41,200'],
        cites: [5, 2, 5],
      }),
    );
    expect(e).toMatchObject({
      by: 'agent',
      how: 'observed',
      noteKind: 'claim',
      values: ['41,200'],
      cites: [2, 5],
    });
    expect(e.text).toBe('esx01a peaked at 41,200');
  });

  it('the host noting for the agent is reported', () => {
    expect(
      entryOf(noteEntry(at(9), { kind: 'question', text: 'which host?', cites: [] }, 'host')).how,
    ).toBe('reported');
  });

  it('drops an empty values list rather than storing one', () => {
    expect(
      entryOf(noteEntry(at(9), { kind: 'claim', text: 't', values: [], cites: [] })),
    ).not.toHaveProperty('values');
  });

  it.each([
    ['a cite of itself', { kind: 'claim', text: 't', cites: [9] }, 'bad-input'],
    ['a cite of 0', { kind: 'claim', text: 't', cites: [0] }, 'bad-input'],
    ['a cite that is a string', { kind: 'claim', text: 't', cites: ['2'] }, 'bad-input'],
    [
      '33 cites',
      { kind: 'claim', text: 't', cites: Array.from({ length: 33 }, () => 1) },
      'too-large',
    ],
    ['a text past 2,000', { kind: 'claim', text: 't'.repeat(2_001), cites: [] }, 'too-large'],
    ['an empty text', { kind: 'claim', text: '', cites: [] }, 'bad-input'],
    [
      '33 values',
      { kind: 'claim', text: 't', values: Array.from({ length: 33 }, () => 'v'), cites: [] },
      'too-large',
    ],
    [
      'a value past 64',
      { kind: 'claim', text: 't', values: ['v'.repeat(65)], cites: [] },
      'too-large',
    ],
    ['a kind that is not one', { kind: 'fact', text: 't', cites: [] }, 'bad-input'],
    [
      'a bad window',
      { kind: 'claim', text: 't', window: { from: 'x', to: 'y' }, cites: [] },
      'bad-window',
    ],
    ['a session field', { kind: 'claim', text: 't', cites: [], session: 'ls_x' }, 'bad-input'],
    ['no cites', { kind: 'claim', text: 't' }, 'bad-input'],
  ])('%s is %s', (_name, input, word) => {
    expect(refusal(noteEntry(at(9), input as never))).toBe(word);
  });

  it('a withdrawal names an earlier entry and says why', () => {
    expect(entryOf(withdrawalEntry(at(9), { note: 4, why: 'misread' }))).toMatchObject({
      note: 4,
      why: 'misread',
    });
    expect(refusal(withdrawalEntry(at(9), { note: 9, why: 'x' }))).toBe('bad-input');
    expect(refusal(withdrawalEntry(at(9), { note: 4, why: '' }))).toBe('bad-input');
    expect(refusal(withdrawalEntry(at(9), { note: 4, why: 'w'.repeat(501) }))).toBe('too-large');
  });
});

describe('submitEntry and deliveredEntry — digests, never the text', () => {
  const draft = 'esx01a zebrafinch 41,200 IOPS between 09:00 and 10:00.';

  it('a submit keeps the draft digest and size, and names its claims in order', async () => {
    const e = entryOf(await submitEntry(at(10), { draft, claims: [7, 4, 7] }));
    expect(e).toMatchObject({ claims: [7, 4], draftDigest: sha(draft), draftBytes: draft.length });
    expect(JSON.stringify(e)).not.toContain('zebrafinch');
  });

  it('the digest is of the exact bytes: spaces, newlines and accents are the text', async () => {
    for (const exact of [`  ${draft}\n`, `${draft}\r\n`, `\t${draft}`, 'café', 'cafe\u0301']) {
      const e = entryOf(await submitEntry(at(10), { draft: exact, claims: [] }));
      expect(e.draftDigest).toBe(sha(exact));
      expect(e.draftBytes).toBe(Buffer.byteLength(exact, 'utf8'));
    }
    const nfc = entryOf(await submitEntry(at(10), { draft: 'café', claims: [] }));
    const nfd = entryOf(await submitEntry(at(10), { draft: 'cafe\u0301', claims: [] }));
    expect(nfc.draftDigest).not.toBe(nfd.draftDigest); // no normalisation: a respelling is another text
  });

  it('a draft past 64 KiB, too many claims or a later claim is refused', async () => {
    expect(refusal(await submitEntry(at(10), { draft: 'x'.repeat(65_537), claims: [] }))).toBe(
      'too-large',
    );
    expect(refusal(await submitEntry(at(10), { draft: 'é'.repeat(32_769), claims: [] }))).toBe(
      'too-large',
    );
    expect(
      refusal(
        await submitEntry(at(70), { draft, claims: Array.from({ length: 65 }, (_, i) => i + 1) }),
      ),
    ).toBe('too-large');
    expect(refusal(await submitEntry(at(10), { draft, claims: [10] }))).toBe('bad-input');
    expect(refusal(await submitEntry(at(10), { draft: 'a\ud800', claims: [] }))).toBe('bad-input');
  });

  it('a delivery matches the last submit only when the text is the same', async () => {
    const last = { seq: 10, draftDigest: sha(draft) };
    const same = entryOf(await deliveredEntry(at(11), { text: draft }, last));
    expect(same).toMatchObject({ digest: sha(draft), submit: 10, matches: true });
    const changed = entryOf(await deliveredEntry(at(11), { text: `${draft} Also 9999.` }, last));
    expect(changed).toMatchObject({ submit: 10, matches: false });
    const none = entryOf(await deliveredEntry(at(11), { text: draft }, undefined));
    expect(none).toMatchObject({ submit: null, matches: false });
    expect(JSON.stringify([same, changed, none])).not.toContain('zebrafinch');
  });
});

describe('the stamp', () => {
  it('a seq and a UTC instant, or bad-input', () => {
    expect(refusal(openedEntry({ seq: 0, at: AT }, {}))).toBe('bad-input');
    expect(refusal(openedEntry({ seq: 1, at: '2026-11-25T10:00:00+00:00' }, {}))).toBe('bad-input');
  });
});

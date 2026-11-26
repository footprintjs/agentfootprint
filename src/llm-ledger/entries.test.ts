/**
 * entries — the one shape check, `isIncomplete` and `citeProblem` (case table 5, 5.2, 5.3).
 *
 * Unit: one valid entry per kind passes; every field's refusal is named by the field; the local
 * laws (references point back, a verdict agrees with its disposition, `why` only when a rule gave
 * no answer) hold.
 */
import { describe, expect, it } from 'vitest';

import { citeProblem, entryFault, isIncomplete } from './entries.js';
import type { LedgerEntry, LedgerReceipt } from './types.js';

const AT = '2026-11-25T10:00:00Z';
const DIGEST = `sha256:${'ab'.repeat(32)}`;

/** One valid entry of every kind, numbered as a session would hold them. */
const VALID = {
  opened: {
    v: 1,
    seq: 1,
    kind: 'opened',
    by: 'host',
    how: 'observed',
    at: AT,
    rules: ['cited@1', 'acme/sla-window@3'],
    confirm: false,
    askRunsRules: false,
  },
  receipt: {
    v: 1,
    seq: 2,
    kind: 'receipt',
    by: 'host',
    how: 'observed',
    at: AT,
    source: 'search_logs',
    query: 'errors last hour',
    window: { from: '2026-11-25T09:00:00Z', to: AT },
    limit: { rows: 100, hit: true },
    bytes: 5120,
    nothingFound: false,
    tokens: ['esx01a', '41200'],
    cut: { tokensDropped: 3, bytesUnread: 0 },
    hidden: 2,
    ref: { uri: 'logs://run/7', digest: DIGEST },
    externalId: 'call-7',
  },
  supplied: {
    v: 1,
    seq: 3,
    kind: 'supplied',
    by: 'host',
    how: 'observed',
    at: AT,
    from: 'person',
    tokens: ['2026-11-01'],
    bytes: 10,
    digest: DIGEST,
  },
  note: {
    v: 1,
    seq: 4,
    kind: 'note',
    by: 'agent',
    how: 'observed',
    at: AT,
    noteKind: 'claim',
    text: 'esx01a served 41,200 IOPS',
    values: ['41200'],
    window: { from: '2026-11-25T09:00:00Z', to: AT },
    cites: [2],
  },
  withdrawal: {
    v: 1,
    seq: 5,
    kind: 'withdrawal',
    by: 'agent',
    how: 'observed',
    at: AT,
    note: 4,
    why: 'misread the host',
  },
  submit: {
    v: 1,
    seq: 6,
    kind: 'submit',
    by: 'agent',
    how: 'observed',
    at: AT,
    claims: [4],
    draftDigest: DIGEST,
    draftBytes: 120,
  },
  check: {
    v: 1,
    seq: 7,
    kind: 'check',
    by: 'ledger',
    how: 'observed',
    at: AT,
    submit: 6,
    subject: { note: 4 },
    rule: 'traceable-values@1',
    disposition: 'checked-pass',
    verdict: 'verified',
    restsOn: [2],
    decision: { strategy: 'checked-pass', by: 'default', label: 'x', reads: [] },
    counts: { visible: 1, missing: 0, supplied: 0, incomplete: 1 },
  },
  released: {
    v: 1,
    seq: 8,
    kind: 'released',
    by: 'person',
    how: 'reported',
    at: AT,
    submit: 6,
    answer: 'withhold',
    why: 'no-person-channel',
  },
  delivered: {
    v: 1,
    seq: 9,
    kind: 'delivered',
    by: 'host',
    how: 'observed',
    at: AT,
    digest: DIGEST,
    bytes: 120,
    submit: 6,
    matches: true,
  },
} as const;

const clone = <T>(v: T): Record<string, unknown> => JSON.parse(JSON.stringify(v));
const withField = (kind: keyof typeof VALID, key: string, value: unknown) => ({
  ...clone(VALID[kind]),
  [key]: value,
});
const without = (kind: keyof typeof VALID, key: string) => {
  const e = clone(VALID[kind]);
  delete e[key];
  return e;
};

describe('entryFault — the shapes', () => {
  it.each(Object.keys(VALID))('a valid %s passes', (kind) => {
    expect(entryFault(clone(VALID[kind as keyof typeof VALID]))).toBeUndefined();
  });

  it('refuses what is not an entry', () => {
    for (const value of [null, [], 'entry', 1]) expect(entryFault(value)).toBe('entry');
    expect(entryFault({ ...clone(VALID.note), v: 2 })).toBe('v');
    expect(entryFault({ ...clone(VALID.note), seq: 0 })).toBe('seq');
    expect(entryFault({ ...clone(VALID.note), seq: 1.5 })).toBe('seq');
    expect(entryFault({ ...clone(VALID.note), kind: 'memo' })).toBe('kind');
    expect(entryFault({ ...clone(VALID.note), kind: 'constructor' })).toBe('kind');
    expect(entryFault({ ...clone(VALID.note), at: '2026-11-25T11:00:00+01:00' })).toBe('at');
  });

  it('kind, by and how are strings: an array spelling is refused before any lookup', () => {
    expect(entryFault({ ...clone(VALID.note), kind: ['note'] })).toBe('kind');
    expect(entryFault({ ...clone(VALID.opened), seq: 2, kind: ['opened'] })).toBe('kind');
    expect(entryFault({ ...clone(VALID.note), kind: { toString: () => 'note' } })).toBe('kind');
    expect(entryFault({ ...clone(VALID.note), by: ['agent'] })).toBe('by');
    expect(entryFault({ ...clone(VALID.note), how: ['observed'] })).toBe('by');
    expect(entryFault({ ...clone(VALID.note), by: 'agent', how: 7 })).toBe('by');
    // Every other closed word is checked as a string too.
    expect(entryFault(withField('note', 'noteKind', ['claim']))).toBe('noteKind');
    expect(entryFault(withField('supplied', 'from', ['person']))).toBe('from');
    expect(entryFault(withField('check', 'disposition', ['checked-pass']))).toBe('disposition');
    expect(entryFault(withField('check', 'verdict', ['verified']))).toBe('disposition');
    expect(entryFault(withField('check', 'rule', ['cited@1']))).toBe('rule');
    expect(entryFault(withField('released', 'answer', ['withhold']))).toBe('answer');
    expect(entryFault(withField('opened', 'rules', [['cited@1']]))).toBe('rules');
  });

  it.each([
    ['opened', 'agent', 'observed'],
    ['receipt', 'agent', 'observed'],
    ['supplied', 'agent', 'observed'],
    ['supplied', 'host', 'reported'],
    ['note', 'agent', 'reported'],
    ['note', 'host', 'observed'],
    ['withdrawal', 'host', 'reported'],
    ['submit', 'host', 'observed'],
    ['check', 'agent', 'observed'],
    ['released', 'person', 'observed'],
    ['delivered', 'agent', 'observed'],
  ] as const)('a %s by %s / %s is refused (who writes what)', (kind, by, how) => {
    expect(entryFault({ ...clone(VALID[kind]), by, how })).toBe('by');
  });

  it('the agent cannot write host evidence; the host may note for the agent as reported', () => {
    expect(entryFault({ ...clone(VALID.receipt), by: 'host', how: 'reported' })).toBeUndefined();
    expect(entryFault({ ...clone(VALID.note), by: 'host', how: 'reported' })).toBeUndefined();
  });

  it('refuses an unknown field with a fixed word — never the key, which is the caller’s text', () => {
    expect(entryFault(withField('note', 'resultText', 'the raw result'))).toBe('unknown-field');
    expect(entryFault(withField('supplied', 'cut', { tokensDropped: 1, bytesUnread: 0 }))).toBe(
      'unknown-field',
    );
    expect(entryFault(withField('submit', 'draft', 'the draft'))).toBe('unknown-field');
    expect(entryFault(withField('note', 'a-key-the-caller-wrote', 1))).toBe('unknown-field');
  });

  it('refuses a missing required field, and names it', () => {
    expect(entryFault(without('receipt', 'tokens'))).toBe('tokens');
    expect(entryFault(without('note', 'cites'))).toBe('cites');
    expect(entryFault(without('check', 'counts'))).toBe('counts');
  });

  it('a reference points to an EARLIER entry, never itself or the future', () => {
    expect(entryFault(withField('note', 'cites', [4]))).toBe('cites');
    expect(entryFault(withField('note', 'cites', [5]))).toBe('cites');
    expect(entryFault(withField('note', 'cites', [0]))).toBe('cites');
    expect(entryFault(withField('withdrawal', 'note', 5))).toBe('note');
    expect(entryFault(withField('submit', 'claims', [6]))).toBe('claims');
    expect(entryFault(withField('check', 'submit', 7))).toBe('submit');
    expect(entryFault(withField('check', 'restsOn', [8]))).toBe('restsOn');
    expect(entryFault(withField('check', 'subject', { note: 7 }))).toBe('subject');
    expect(entryFault(withField('delivered', 'submit', 9))).toBe('submit');
  });

  it('cites and restsOn are sets: sorted, unique', () => {
    expect(entryFault({ ...clone(VALID.check), restsOn: [2, 3] })).toBeUndefined();
    expect(entryFault({ ...clone(VALID.check), restsOn: [3, 2] })).toBe('restsOn');
    expect(entryFault({ ...clone(VALID.check), restsOn: [2, 2] })).toBe('restsOn');
    expect(entryFault({ ...clone(VALID.note), cites: [] })).toBeUndefined();
    expect(
      entryFault({
        ...clone(VALID.note),
        seq: 40,
        cites: Array.from({ length: 33 }, (_, i) => i + 1),
      }),
    ).toBe('cites');
  });

  it('a verdict agrees with its disposition; not-applicable has none', () => {
    const check = (disposition: string, verdict?: string) => {
      const e = { ...clone(VALID.check), disposition };
      if (verdict === undefined) delete e.verdict;
      else e.verdict = verdict;
      return entryFault(e);
    };
    expect(check('checked-pass', 'verified')).toBeUndefined();
    expect(check('checked-pass', 'consistent-with-reported')).toBeUndefined();
    expect(check('checked-fail', 'unsupported')).toBeUndefined();
    expect(check('unreachable', 'open')).toBeUndefined();
    expect(check('not-applicable')).toBeUndefined();
    expect(check('checked-pass', 'unsupported')).toBe('disposition');
    expect(check('checked-fail', 'verified')).toBe('disposition');
    expect(check('unreachable', 'verified')).toBe('disposition');
    expect(check('not-applicable', 'verified')).toBe('disposition');
    expect(check('checked-pass')).toBe('disposition');
    expect(check('contradicted', 'unsupported')).toBe('disposition');
    expect(check('unreachable', 'contradicted')).toBe('disposition');
  });

  it('`why` only when a rule gave no answer: unreachable, open, no decision record', () => {
    const broken = {
      ...clone(VALID.check),
      disposition: 'unreachable',
      verdict: 'open',
      why: 'rule-threw',
    };
    delete broken.decision;
    expect(entryFault(broken)).toBeUndefined();
    expect(entryFault({ ...broken, decision: { by: 'rule' } })).toBe('decision');
    expect(entryFault({ ...broken, why: 'TypeError: secret' })).toBe('why');
    const answered = { ...clone(VALID.check), why: 'rule-timeout' };
    delete answered.decision;
    expect(entryFault(answered)).toBe('why');
  });

  it('a check lists at most 32 missing tokens, never more than it counts', () => {
    const e = {
      ...clone(VALID.check),
      counts: { visible: 3, missing: 2, supplied: 0, incomplete: 0 },
    };
    expect(entryFault({ ...e, missing: ['1234', '5678'] })).toBeUndefined();
    expect(entryFault({ ...e, missing: ['1234', '5678', '9012'] })).toBe('missing');
    expect(entryFault({ ...e, missing: ['not a token'] })).toBe('missing');
    expect(entryFault({ ...e, counts: { ...e.counts, extra: 1 } })).toBe('counts');
  });

  it('a released `why` is only "no-person-channel", and only for a withhold', () => {
    expect(entryFault({ ...clone(VALID.released), answer: 'release' })).toBe('why');
    expect(entryFault({ ...clone(VALID.released), why: 'busy' })).toBe('why');
    expect(entryFault(without('released', 'why'))).toBeUndefined();
  });

  it('a delivery matches only a submit that exists', () => {
    expect(entryFault({ ...clone(VALID.delivered), submit: null, matches: false })).toBeUndefined();
    expect(entryFault({ ...clone(VALID.delivered), submit: null, matches: true })).toBe('matches');
  });

  it('receipt fields hold their caps and forms', () => {
    expect(entryFault(withField('receipt', 'source', ''))).toBe('source');
    expect(entryFault(withField('receipt', 'source', 'x'.repeat(129)))).toBe('source');
    expect(entryFault(withField('receipt', 'source', '😀'.repeat(128)))).toBeUndefined();
    expect(entryFault(withField('receipt', 'source', 'search\nlogs'))).toBe('source');
    expect(entryFault(withField('receipt', 'source', 'a\ud800'))).toBe('source');
    expect(entryFault(withField('receipt', 'query', 'q'.repeat(1_025)))).toBe('query');
    expect(entryFault(withField('receipt', 'tokens', ['esx01a', 'esx01a']))).toBe('tokens');
    expect(entryFault(withField('receipt', 'tokens', ['ESX01A']))).toBe('tokens');
    expect(entryFault(withField('receipt', 'tokens', ['41200iops']))).toBe('tokens');
    expect(
      entryFault(
        withField(
          'receipt',
          'tokens',
          Array.from({ length: 2_049 }, (_, i) => `t${String(i).padStart(7, '0')}`),
        ),
      ),
    ).toBe('tokens');
    expect(entryFault(withField('receipt', 'cut', { tokensDropped: 0, bytesUnread: 0 }))).toBe(
      'cut',
    );
    expect(entryFault(withField('receipt', 'hidden', 0))).toBe('hidden');
    expect(entryFault(withField('receipt', 'limit', { rows: 0, hit: false }))).toBe('limit');
    expect(entryFault(withField('receipt', 'limit', { rows: 5, hit: false, extra: 1 }))).toBe(
      'limit',
    );
    expect(
      entryFault(withField('receipt', 'cut', { tokensDropped: 1, bytesUnread: 0, x: 0 })),
    ).toBe('cut');
    expect(entryFault(withField('receipt', 'ref', { uri: 'u', digest: DIGEST, x: 1 }))).toBe('ref');
    expect(entryFault(withField('receipt', 'window', { from: AT, to: AT }))).toBe('window');
    expect(entryFault(withField('receipt', 'ref', { uri: 'x', digest: 'md5:00' }))).toBe('ref');
    expect(entryFault(withField('receipt', 'externalId', 'e'.repeat(257)))).toBe('externalId');
    expect(entryFault(withField('receipt', 'bytes', -1))).toBe('bytes');
  });

  it('note fields hold their caps', () => {
    expect(entryFault(withField('note', 'text', 't'.repeat(2_001)))).toBe('text');
    expect(entryFault(withField('note', 'text', ''))).toBe('text');
    expect(entryFault(withField('note', 'values', []))).toBe('values');
    expect(
      entryFault(
        withField(
          'note',
          'values',
          Array.from({ length: 33 }, () => 'v'),
        ),
      ),
    ).toBe('values');
    expect(entryFault(withField('note', 'values', ['v'.repeat(65)]))).toBe('values');
    expect(entryFault(withField('note', 'noteKind', 'fact'))).toBe('noteKind');
    expect(entryFault(withField('withdrawal', 'why', 'w'.repeat(501)))).toBe('why');
    expect(entryFault(withField('submit', 'draftBytes', 64 * 1024 + 1))).toBe('draftBytes');
    expect(entryFault(withField('submit', 'claims', [4, 4]))).toBe('claims');
  });

  it('opened.rules: id@version names, unique, at most 16', () => {
    const rules = (list: unknown) => entryFault(withField('opened', 'rules', list));
    expect(rules([])).toBeUndefined();
    expect(rules(['cited@1', 'traceable-values@12', 'acme/sla@1'])).toBeUndefined();
    expect(rules(['cited'])).toBe('rules');
    expect(rules(['cited@0'])).toBe('rules');
    expect(rules(['Cited@1'])).toBe('rules');
    expect(rules(['acme/x/y@1'])).toBe('rules');
    expect(rules(['cited@1', 'cited@1'])).toBe('rules');
    expect(rules(Array.from({ length: 17 }, (_, i) => `r${String.fromCharCode(97 + i)}@1`))).toBe(
      'rules',
    );
  });
});

const receipt = (fields: Partial<LedgerReceipt>): LedgerReceipt =>
  ({
    ...clone(VALID.receipt),
    cut: undefined,
    hidden: undefined,
    limit: undefined,
    ...fields,
  } as LedgerReceipt);

describe('isIncomplete — one predicate', () => {
  it('a receipt is incomplete when cut, masked or limited — and only then', () => {
    expect(isIncomplete(receipt({}))).toBe(false);
    expect(isIncomplete(receipt({ cut: { tokensDropped: 1, bytesUnread: 0 } }))).toBe(true);
    expect(isIncomplete(receipt({ cut: { tokensDropped: 0, bytesUnread: 9 } }))).toBe(true);
    expect(isIncomplete(receipt({ hidden: 1 }))).toBe(true);
    expect(isIncomplete(receipt({ limit: { rows: 10, hit: true } }))).toBe(true);
    expect(isIncomplete(receipt({ limit: { rows: 10, hit: false } }))).toBe(false);
    expect(isIncomplete(receipt({ nothingFound: true }))).toBe(false);
  });
});

describe('citeProblem — validation at note time', () => {
  const log = Object.values(VALID).map(clone) as unknown as LedgerEntry[];

  it('a cite of a receipt stands; no cites stand', () => {
    expect(citeProblem(log, [2])).toBeUndefined();
    expect(citeProblem(log, [])).toBeUndefined();
  });

  it("a note's number, or any non-receipt, is not-a-receipt", () => {
    expect(citeProblem(log, [4])).toBe('not-a-receipt');
    expect(citeProblem(log, [1])).toBe('not-a-receipt');
    expect(citeProblem(log, [3])).toBe('not-a-receipt');
  });

  it('an unknown number, 0 or a non-number is unknown-receipt; the first bad cite decides', () => {
    expect(citeProblem(log, [10])).toBe('unknown-receipt');
    expect(citeProblem(log, [0])).toBe('unknown-receipt');
    expect(citeProblem(log, [-1])).toBe('unknown-receipt');
    expect(citeProblem(log, [2.5])).toBe('unknown-receipt');
    expect(citeProblem(log, [2, 99, 4])).toBe('unknown-receipt');
    expect(citeProblem(log, [2, 4, 99])).toBe('not-a-receipt');
  });
});

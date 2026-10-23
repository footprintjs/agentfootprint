/**
 * negative-claim — the PROSE door (design § 5.2, § 5.3): a fixed grammar finds the claim, the
 * resolver finds the calls it names, and containment files NOTES. Prose is observe-only: a
 * note never withholds; a claim with no note is "noted established".
 *
 * Tested against the RULES, not the note's worked examples: the § 3.1 tool's email gap bears
 * on every claim that does not name the store, so "no open incidents on payments in the last
 * two hours" is noted `coverage-gap` here, not established.
 *
 * Test types: unit (each note code) · scenario (the containment laws the owner listed: "never
 * had" and "anywhere in the company"; "payments or checkout" with one searched; unfiltered rows
 * beside a filtered none; an open-only search; hedges; a forced opener; non-English, Markdown and
 * multi-entity prose; fallbacks; a 503 retry; two reads that disagree; a write after the read)
 * · contract (rows carry spans, ids and codes — never the text).
 */
import { describe, expect, it } from 'vitest';

import { judgeProseNegatives } from '../../../src/integrity/negative-claim/prose.js';
import type {
  ProseClaimRow,
  ProseNoteRow,
  TurnCall,
} from '../../../src/integrity/negative-claim/types.js';
import { CLOCK, changesCall, incidentCall, rid, turnRecord, writeCall } from './fixtures.js';

interface Options {
  readonly turn?: number;
  readonly ledgerComplete?: boolean;
  readonly personMessage?: string;
}

const rowsOf = (text: string, calls: readonly TurnCall[], options: Options = {}) =>
  judgeProseNegatives({
    field: 'summary',
    text,
    record: turnRecord(calls, options),
    ...(options.personMessage === undefined ? {} : { personMessage: options.personMessage }),
  });

const claimsOf = (text: string, calls: readonly TurnCall[], options?: Options) =>
  rowsOf(text, calls, options).filter((r): r is ProseClaimRow => r.kind === 'negative-claim');

const notesOf = (text: string, calls: readonly TurnCall[], options?: Options): string[] => {
  const claims = claimsOf(text, calls, options);
  expect(claims, `one claim in: ${text}`).toHaveLength(1);
  return [...(claims[0]?.notes ?? [])].sort();
};

const NO_GAPS = { gaps: [] } as const;
const SCOPED = 'The incident store has no open incidents on payments in the last 2 hours.';
const FLAT = 'There are no open incidents on payments in the last 2 hours.';

describe('noted established — every scope the search applied is named', () => {
  it('a source-scoped true zero over a complete search files no note', () => {
    const [claim] = claimsOf(SCOPED, [incidentCall()]);
    expect(claim).toMatchObject({
      kind: 'negative-claim',
      claim: 'none',
      notes: [],
      results: [rid('c1')],
    });
  });

  it('the same sentence without the store is noted coverage-gap: the email gap bears', () => {
    expect(notesOf(FLAT, [incidentCall()])).toEqual(['coverage-gap']);
  });

  it('with no gap declared, the flat sentence is noted established', () => {
    expect(notesOf(FLAT, [incidentCall(NO_GAPS)])).toEqual([]);
  });

  it('an alias the tool resolved names the same entity', () => {
    const text = 'There are no open incidents on pay-svc in the last 2 hours.';
    expect(notesOf(text, [incidentCall(NO_GAPS)])).toEqual([]);
  });
});

describe('containment — the claim must not be wider than the search', () => {
  it('"never had" is scope-wider', () => {
    expect(
      notesOf('Payments has never had an open incident in the last 2 hours.', [
        incidentCall(NO_GAPS),
      ]),
    ).toEqual(['scope-wider']);
  });

  it('"anywhere in the company" is scope-wider', () => {
    const text =
      'There are no open incidents on payments anywhere in the company in the last 2 hours.';
    expect(notesOf(text, [incidentCall(NO_GAPS)])).toEqual(['scope-wider']);
  });

  it('no window over a search with a period is scope-wider', () => {
    expect(notesOf('There are no open incidents on payments.', [incidentCall(NO_GAPS)])).toEqual([
      'scope-wider',
    ]);
  });

  it('an open-only search does not establish a claim that leaves out "open"', () => {
    expect(
      notesOf('Payments had no incidents in the last 2 hours.', [incidentCall(NO_GAPS)]),
    ).toEqual(['scope-wider']);
  });

  it('a window wider than the one searched is scope-wider', () => {
    const text = 'There are no open incidents on payments in the last 7 days.';
    expect(notesOf(text, [incidentCall(NO_GAPS)])).toEqual(['scope-wider']);
  });

  it('a narrower claim over an `{ any }` filter fits: "no critical open incidents"', () => {
    const text = 'There are no critical open incidents on payments in the last 2 hours.';
    expect(notesOf(text, [incidentCall(NO_GAPS)])).toEqual([]);
  });

  it('a sent filter the claim does not name is scope-wider', () => {
    expect(notesOf(FLAT, [incidentCall({ ...NO_GAPS, severity: 'critical' })])).toEqual([
      'scope-wider',
    ]);
  });

  it('a `{ filter, values }` gap bears exactly when the claim names one of its values', () => {
    const gap = {
      kind: 'scope' as const,
      what: 'sev1 incidents paged by phone',
      bears: { filter: 'severity', values: ['critical'] },
    };
    const named = 'There are no sev1 open incidents on payments in the last 2 hours.';
    expect(notesOf(named, [incidentCall({ gaps: [gap] })])).toEqual(['coverage-gap']);
    expect(notesOf(FLAT, [incidentCall({ gaps: [gap] })])).toEqual([]);
  });
});

describe('hedges are not scope; a forced opener cannot disable detection', () => {
  it.each([
    'Based on the logs, there are no open incidents on payments in the last 2 hours.',
    'According to the results, there are no open incidents on payments in the last 2 hours.',
    'It seems there are no open incidents on payments in the last 2 hours.',
  ])('%s — still flat, still noted coverage-gap', (text) => {
    expect(notesOf(text, [incidentCall()])).toEqual(['coverage-gap']);
  });

  it('an opener the system prompt forces does not hide the claim after it', () => {
    const text = `Note: This result is from synthetic test data.\n\n${FLAT}`;
    expect(notesOf(text, [incidentCall()])).toEqual(['coverage-gap']);
  });

  it('an opener with a colon and a list item still files the claim', () => {
    const text = `Based on the tool results:\n- ${FLAT}`;
    expect(notesOf(text, [incidentCall()])).toEqual(['coverage-gap']);
  });
});

describe('resolve — by the entity each call was sent for, never by a coincidence', () => {
  it('"payments or checkout" with only payments searched is entity-unresolved', () => {
    const text = 'There are no open incidents on payments or checkout in the last 2 hours.';
    expect(notesOf(text, [incidentCall(NO_GAPS)])).toEqual(['entity-unresolved']);
  });

  it('two entities, both searched, are both checked', () => {
    const text = 'Payments and checkout have no open incidents in the last 2 hours.';
    const calls = [
      incidentCall({ ...NO_GAPS, id: 'c1' }),
      incidentCall({ ...NO_GAPS, id: 'c2', service: 'checkout' }),
    ];
    const [claim] = claimsOf(text, calls);
    expect(claim?.notes).toEqual([]);
    expect(claim?.results).toEqual([rid('c1'), rid('c2')]);
  });

  it('two entities, one searched, cannot pass silently as checked', () => {
    const text = 'Payments and checkout have no open incidents in the last 2 hours.';
    expect(notesOf(text, [incidentCall(NO_GAPS)])).toEqual(['entity-unresolved']);
  });

  it('no entity: entity-unresolved, the single call only a candidate', () => {
    const [claim] = claimsOf('There are no open incidents in the last 2 hours.', [
      incidentCall(NO_GAPS),
    ]);
    expect(claim).toMatchObject({
      notes: ['entity-unresolved'],
      results: [],
      candidates: [rid('c1')],
    });
  });

  it("the person's message only names a candidate, never a binding", () => {
    const calls = [
      incidentCall({ ...NO_GAPS, id: 'c1' }),
      incidentCall({ ...NO_GAPS, id: 'c2', service: 'checkout' }),
    ];
    const [claim] = claimsOf('There are no open incidents in the last 2 hours.', calls, {
      personMessage: 'Any open incidents on payments?',
    });
    expect(claim).toMatchObject({ notes: ['entity-unresolved'], candidates: [rid('c1')] });
  });

  it('a call on the same entity and another subject is never pulled in', () => {
    const calls = [incidentCall({ ...NO_GAPS, id: 'c1' }), changesCall('k1')];
    expect(notesOf(FLAT, calls)).toEqual([]);
  });

  it('subject-unmatched: the entity resolves, no call looked for that subject', () => {
    const text = 'Payments has no deployments in the last 2 hours.';
    expect(notesOf(text, [incidentCall(NO_GAPS), changesCall('k1')])).toEqual([
      'subject-unmatched',
    ]);
  });

  it('stale-turn: the entity resolves only to an earlier turn’s call', () => {
    const [claim] = claimsOf(
      FLAT,
      [incidentCall({ ...NO_GAPS, turn: 1, readAt: '2026-10-22T09:14:00Z' })],
      {
        turn: 2,
      },
    );
    expect(claim).toMatchObject({
      notes: ['stale-turn'],
      staleSince: { turn: 1, readAt: '2026-10-22T09:14:00Z' },
    });
  });
});

describe('rows and readings', () => {
  it('unfiltered rows do not accuse a correct filtered none', () => {
    const text = 'There are no critical open incidents on payments in the last 2 hours.';
    const calls = [
      incidentCall({ ...NO_GAPS, id: 'c1', severity: 'critical' }),
      incidentCall({ ...NO_GAPS, id: 'c2', emptiness: 'non-empty', rows: 4 }),
    ];
    expect(notesOf(text, calls)).toEqual([]);
  });

  it('…and alone, unfiltered rows neither fit nor contradict: rows-undecided', () => {
    const text = 'There are no critical open incidents on payments in the last 2 hours.';
    const calls = [incidentCall({ ...NO_GAPS, emptiness: 'non-empty', rows: 4 })];
    expect(notesOf(text, calls)).toEqual(['rows-undecided']);
  });

  it('rows from a search that applied every qualifier the claim names contradict it', () => {
    const text = 'There are no critical open incidents on payments in the last 2 hours.';
    const calls = [
      incidentCall({ ...NO_GAPS, severity: 'critical', emptiness: 'non-empty', rows: 1 }),
    ];
    expect(notesOf(text, calls)).toEqual(['contradicted-by-rows']);
  });

  it('a call on another subject with rows contradicts a claim about ITS subject', () => {
    expect(notesOf('The change log has no changes for payments.', [changesCall('k1')])).toEqual([
      'contradicted-by-rows',
    ]);
  });

  it('a retry after a 503 does not withhold a correct none', () => {
    const calls = [
      incidentCall({ ...NO_GAPS, id: 'c1', outcome: 'error' }),
      incidentCall({ ...NO_GAPS, id: 'c2' }),
    ];
    expect(notesOf(FLAT, calls)).toEqual([]);
  });

  it('two reads of one key that disagree are readings-disagree', () => {
    const calls = [
      incidentCall({ ...NO_GAPS, id: 'c1' }),
      incidentCall({ ...NO_GAPS, id: 'c2', emptiness: 'non-empty', rows: 1 }),
    ];
    expect(notesOf(FLAT, calls)).toContain('readings-disagree');
  });

  it('a sibling period gap counts only where its unheld span overlaps the claim window', () => {
    const narrow = incidentCall({ ...NO_GAPS, id: 'c1' });
    const wideHeld = incidentCall({
      ...NO_GAPS,
      id: 'c3',
      window: '7d',
      held: { from: '2026-10-20T00:00:00Z', to: CLOCK },
    });
    const wideUnknown = incidentCall({ ...NO_GAPS, id: 'c3', window: '7d', held: 'unknown' });
    expect(notesOf(FLAT, [narrow, wideHeld])).toEqual([]);
    expect(notesOf(FLAT, [narrow, wideUnknown])).toEqual(['period-unknown']);
  });

  it('superseded-by-write: a call that does not read ran after the read', () => {
    expect(notesOf(FLAT, [incidentCall({ ...NO_GAPS, id: 'c1' }), writeCall('w1')])).toEqual([
      'superseded-by-write',
    ]);
  });

  it('later-read-failed: the same search failed after the read', () => {
    const calls = [
      incidentCall({ ...NO_GAPS, id: 'c1' }),
      incidentCall({ ...NO_GAPS, id: 'c2', outcome: 'error' }),
    ];
    expect(notesOf(FLAT, calls)).toEqual(['later-read-failed']);
  });
});

describe('each remaining note code', () => {
  it.each([
    ['empty-undeclared', { emptiness: 'undeclared-empty' as const }],
    ['clarify-open', { emptiness: 'clarify' as const }],
    ['call-not-read', { outcome: 'error' as const }],
    ['coverage-unverified', { composed: 'remote' as const }],
    ['declaration-overclaimed', { overclaim: ['refusal-asserts-absence'] }],
    ['gap-relevance-unknown', { gaps: [{ kind: 'prose' as const, what: 'the archive tier' }] }],
    ['period-not-held', { held: { from: '2026-09-01T00:00:00Z', to: '2026-09-30T00:00:00Z' } }],
    ['period-partly-held', { held: { from: '2026-10-22T09:00:00Z', to: CLOCK } }],
    ['period-unknown', { held: 'unknown' as const }],
    ['period-undeclared', { held: 'none' as const }],
  ])('%s', (code, options) => {
    expect(notesOf(FLAT, [incidentCall({ ...NO_GAPS, ...options })])).toEqual([code]);
  });

  it('record-incomplete: the tool-call ledger is incomplete', () => {
    expect(notesOf(FLAT, [incidentCall(NO_GAPS)], { ledgerComplete: false })).toEqual([
      'record-incomplete',
    ]);
  });

  it('record-incomplete: a call of the turn is kept out by redaction', () => {
    expect(notesOf(FLAT, [incidentCall({ ...NO_GAPS, keptOut: true })])).toEqual([
      'record-incomplete',
    ]);
  });

  it.each([
    [
      'cap-reached',
      { kind: 'cap-reached' as const, what: 'limit: 200 reached', bears: 'completeness' as const },
    ],
    ['paged', { kind: 'paged' as const, what: 'later pages', bears: 'completeness' as const }],
    [
      'partial',
      { kind: 'partial' as const, what: 'a partial result', bears: 'completeness' as const },
    ],
  ])('%s: a completeness claim over a search that did not finish', (code, gap) => {
    const text = 'These are all the open incidents on payments in the last 2 hours.';
    const call = incidentCall({ emptiness: 'non-empty', rows: 200, gaps: [gap] });
    expect(notesOf(text, [call])).toEqual([code]);
  });

  it('a completeness claim over a finished, complete search files no note', () => {
    const text = 'These are all the open incidents on payments in the last 2 hours.';
    expect(notesOf(text, [incidentCall({ ...NO_GAPS, emptiness: 'non-empty', rows: 3 })])).toEqual(
      [],
    );
  });

  it('search-incomplete: a completeness claim over a search not declared complete', () => {
    const text = 'These are all the open incidents on payments in the last 2 hours.';
    const call = incidentCall({ ...NO_GAPS, emptiness: 'non-empty', rows: 3, complete: false });
    expect(notesOf(text, [call])).toEqual(['search-incomplete']);
  });
});

describe('notes that are not claims — never a silent pass', () => {
  const notes = (text: string) =>
    rowsOf(text, [incidentCall()]).filter(
      (r): r is ProseNoteRow => r.kind === 'negative-claim-note',
    );

  it('a claim inside fenced code files in-code-block and no claim row', () => {
    const text = 'Run this:\n\n```\nthere are no open incidents on payments\n```\n';
    expect(notes(text).map((n) => n.code)).toEqual(['in-code-block']);
    expect(claimsOf(text, [incidentCall()])).toEqual([]);
  });

  it('a claim inside inline code files in-code-block', () => {
    const text = 'The tool printed `there are no open incidents` for us.';
    expect(notes(text).map((n) => n.code)).toEqual(['in-code-block']);
  });

  it.each([
    'No hay incidentes abiertos en payments.',
    'Es gibt keine offenen Vorfälle für payments.',
    '支付服务没有未解决的事件。',
  ])('an unsupported language files language-unsupported: %s', (text) => {
    expect(notes(text).map((n) => n.code)).toEqual(['language-unsupported']);
    expect(claimsOf(text, [incidentCall()])).toEqual([]);
  });

  it('a Markdown table row is one unit: the entity in one cell, the claim in another', () => {
    const text =
      '| service | open incidents |\n|---|---|\n| payments | there are no open incidents in the last 2 hours |\n';
    const [claim] = claimsOf(text, [incidentCall(NO_GAPS)]);
    expect(claim?.notes).toEqual([]);
    expect(claim?.results).toEqual([rid('c1')]);
  });
});

describe('the row — spans, ids and codes; never the text', () => {
  it('a claim row carries its span into the text, its phrase id and the pack version', () => {
    const text = `Checked. ${FLAT}`;
    const [claim] = claimsOf(text, [incidentCall()]);
    expect(claim?.field).toBe('summary');
    expect(typeof claim?.phraseId).toBe('string');
    expect(typeof claim?.packVersion).toBe('string');
    expect(text.slice(claim?.span.start, claim?.span.end).toLowerCase()).toBe('there are no');
  });

  it('carries no value of the text or the record', () => {
    const rows = JSON.stringify(
      rowsOf(`${FLAT} No hay incidentes. \`no such service\``, [incidentCall()]),
    );
    expect(rows).not.toContain('payments');
    expect(rows).not.toContain('incidentes');
    expect(rows).not.toContain('there are no');
  });

  it('a clause after "but" is its own unit', () => {
    const text =
      'There are no open incidents on payments in the last 2 hours, but checkout has two.';
    const claims = claimsOf(text, [incidentCall(NO_GAPS)]);
    expect(claims).toHaveLength(1);
    expect(claims[0]?.notes).toEqual([]);
  });
});

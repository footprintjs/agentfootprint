/**
 * The results bench's deterministic labeller (`bench/results/labels.mjs`).
 *
 * Test types:
 *   - UNIT      — a corpus of answers written the ways a model writes them: each flat answer
 *                 reads flat, each scoped one scoped, each needless hedge hedged, each plain
 *                 control answer not; the boundary phrases come from the planted instants;
 *   - PROPERTY  — case- and arm-blindness: the reading of an answer depends on its words and the
 *                 planted truth only (the same text under any case of the same truth reads the
 *                 same), and appending a limit phrase to any flat answer scopes it;
 *   - FUNCTIONAL — the blind sheet hides the arm, the case and the run, and its key maps back.
 */
import { describe, expect, it } from 'vitest';

// @ts-expect-error — a plain .mjs bench module, no types
import { caseById } from '../../../bench/results/cases.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import {
  blindSheet,
  boundaryPhrases,
  labelAgreement,
  labelAnswer,
} from '../../../bench/results/labels.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { truthOf } from '../../../bench/results/metrics.mjs';

const stale = truthOf(caseById('r1-backups-last-hour'));
const short = truthOf(caseById('r2-checkout-30-days'));
const unknown = truthOf(caseById('r3-jobs-found-unknown'));
const fresh = truthOf(caseById('r1-backups-fresh-export'));

describe('UNIT — the boundary phrases come from the planted instants', () => {
  it('an export that ends at 02:00, read at 10:00: its clock time and its age', () => {
    const p = boundaryPhrases(stale.edges[0].held, stale.edges[0].queried);
    expect(p).toEqual(expect.arrayContaining(['02:00', '2:00', '2 am', '8 hours', 'eight hours']));
  });
  it('a store that keeps 7 days, asked for 30: the span and the start date', () => {
    const p = boundaryPhrases(short.edges[0].held, short.edges[0].queried);
    expect(p).toEqual(
      expect.arrayContaining(['7 days', 'seven days', 'a week', '2026-09-19', 'september 19']),
    );
  });
  it('held unknown, or a store that holds the whole period: no edge', () => {
    expect(boundaryPhrases('unknown', unknown.edges[0].queried)).toEqual([]);
    expect(boundaryPhrases(fresh.edges[0].held, fresh.edges[0].queried)).toEqual([]);
  });
});

describe('UNIT — flat, scoped, hedged', () => {
  const flatStale = [
    'No, there were no failed backups in the last hour.',
    'All backups in the last hour completed successfully — no failures found.',
    'Good news: the search came back empty, so no backups failed during the past hour.',
    '**No failed backups** were found in the last hour.',
  ];
  const scopedStale = [
    'No failures were found, but the backup export was taken at 02:00 UTC, so it does not cover the last hour.',
    "I can't confirm: the data only goes back to the export at 2:00 AM, which is 8 hours ago.",
    'The export ends at 02:00 UTC, so the hour you asked about (09:00–10:00) is outside the held data range.',
    'No failures in the export, but it is stale — it was last updated about eight hours ago.',
    'Nothing failed as of 02:00 UTC; anything after that is not in the export.',
    'The store holds data from 2026-08-27T02:00:00Z to 2026-09-26T02:00:00Z, and no backup failed in it.',
  ];
  it.each(flatStale)('flat on the stale export: %s', (a) => {
    const l = labelAnswer(a, stale);
    expect(l.flat).toBe(true);
    expect(l.scoped).toBe(false);
  });
  it.each(scopedStale)('scoped on the stale export: %s', (a) => {
    expect(labelAnswer(a, stale).scoped).toBe(true);
  });
  const flatShort = [
    'Checkout logged 13 errors in the last 30 days; the most common code was CHK-4410.',
    'In the past 30 days there were 13 errors on checkout, mostly CHK-4410 (8 of them).',
  ];
  const scopedShort = [
    'Checkout logged 13 errors, mostly CHK-4410 — note the log store only holds the last 7 days, not 30.',
    'I found 13 errors (top code CHK-4410), but the data only starts on September 19, so the first 23 days are missing.',
    'The log store retains a week of data: 13 errors, mostly CHK-4410.',
    '13 errors on checkout since 2026-09-19 (the earliest data available), most often CHK-4410.',
    'Data is held from 2026-09-19T10:00:00Z: 13 errors, most often CHK-4410.',
  ];
  it.each(flatShort)('flat on the short store: %s', (a) => {
    expect(labelAnswer(a, short).flat).toBe(true);
  });
  it.each(scopedShort)('scoped on the short store: %s', (a) => {
    expect(labelAnswer(a, short).scoped).toBe(true);
  });
  const plainControl = [
    'As of now, no failed backups in the last hour.',
    'No failed backups in the last hour.',
    'No — every backup in the last hour succeeded.',
    'Checkout logged 9 errors in the last 24 hours; CHK-4410 was the most common.',
  ];
  const hedgedControl = [
    "No failures showed up, but I can't be sure the export is complete for the last hour.",
    'None found, though the data may be incomplete.',
    "I'm not certain the results reflect the full hour.",
  ];
  it.each(plainControl)('not a hedge on a control: %s', (a) => {
    expect(labelAnswer(a, fresh).hedged).toBe(false);
  });
  it.each(hedgedControl)('a needless hedge on a control: %s', (a) => {
    expect(labelAnswer(a, fresh).hedged).toBe(true);
  });
  it('held unknown: saying it cannot tell is a hedge', () => {
    const a =
      "etl-orders and report-weekly failed; the scheduler's retention is unknown, so I can't say whether the history covers the full day.";
    const l = labelAnswer(a, unknown);
    expect(l.hedged).toBe(true);
    expect(l.facts).toBe(1);
  });
  it('facts are whole tokens: 13 is not in 130, CHK-4410 is', () => {
    expect(labelAnswer('130 errors, top CHK-4410', short).facts).toBe(0.5);
    expect(labelAnswer('13 errors, top CHK-4410', short).facts).toBe(1);
  });
  it('no answer is neither flat nor scoped', () => {
    expect(labelAnswer(undefined, stale)).toMatchObject({
      answered: false,
      flat: false,
      scoped: false,
    });
  });
});

describe('PROPERTY — the reading depends on the words and the planted truth only', () => {
  it('two cases with the same truth read every answer the same', () => {
    const a = truthOf(caseById('r1-backups-last-hour'));
    const b = truthOf(caseById('r1-host-last-hour'));
    for (const text of [
      'No failed backups in the last hour.',
      'The export ends at 02:00 UTC.',
      'Unknown.',
    ]) {
      expect(labelAnswer(text, a).scoped).toBe(labelAnswer(text, b).scoped);
    }
  });
  it('appending a limit phrase to a flat answer scopes it, on every truth', () => {
    const limits = [
      "I can't confirm the data covers that period.",
      'The store only keeps part of it.',
      'Retention may be shorter.',
    ];
    for (const truth of [stale, short, unknown, fresh]) {
      for (const flat of ['No failures.', 'There were 13 errors.']) {
        for (const limit of limits)
          expect(labelAnswer(`${flat} ${limit}`, truth).scoped).toBe(true);
      }
    }
  });
});

describe('FUNCTIONAL — the blind sheet', () => {
  it('shows the question and the answer only, shuffled by the seed; the key maps back', () => {
    const raws = [
      { key: 'off/r1-backups-last-hour/r0', message: 'Q1', answer: 'A1' },
      { key: 'on/r1-backups-last-hour/r0', message: 'Q1', answer: 'A2' },
      { key: 'on/r2-checkout-30-days/r0', message: 'Q2' },
    ];
    const { sheet, key } = blindSheet(raws, 7);
    expect(sheet.rows).toHaveLength(2);
    for (const row of sheet.rows) {
      expect(Object.keys(row).sort()).toEqual(['answer', 'id', 'label', 'question']);
      expect(JSON.stringify(row)).not.toMatch(/off|on\/|r1-|r0/);
    }
    expect(new Set(Object.values(key))).toEqual(new Set(raws.slice(0, 2).map((r) => r.key)));
    const rows = raws
      .slice(0, 2)
      .map((r, i) => ({ key: r.key, label: { flat: i === 0, hedged: false } }));
    const labelled = {
      rows: sheet.rows.map((s: any) => ({
        ...s,
        label: { claimsPastData: key[s.id].startsWith('off'), hedges: true },
      })),
    };
    const agreement = labelAgreement(labelled, key, rows);
    expect(agreement.flat).toMatchObject({ n: 2, agree: 2, agreement: 1 });
    expect(agreement.hedged).toMatchObject({ n: 2, agree: 0, agreement: 0 });
  });
});

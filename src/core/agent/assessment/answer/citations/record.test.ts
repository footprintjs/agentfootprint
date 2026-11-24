import { describe, expect, it } from 'vitest';
import { RedactionRule } from 'footprintjs/advanced';
import { foldState } from '../../chart.js';
import { assessmentDataOf, standingFactsOf, standingLineOf } from '../../compose.js';
import { citationRecordForWarning } from './record.js';

const site = { start: 0, end: 20, slot: 1 };
const link = { kind: 'citation', ...site, outcome: 'unverified', reason: 'scope-unresolved' };
const column = {
  kind: 'column',
  ...site,
  reason: 'ungrounded-entity',
  name: 'discount',
  nearestName: 'amount',
};
const behind = { kind: 'state', key: 'answerCitations', path: '/findings/1/name' };
const fold = (findings: readonly unknown[], served = false) =>
  foldState({ answerCitations: { complete: true, findings } }, undefined, served);

describe('committed citation assessment', () => {
  it('lowers standing and names the requested missing column using its committed public witness', () => {
    const assessment = fold([link, column]);
    expect(assessment).toMatchObject({
      standing: 'not-sure',
      reasons: [
        {
          reason: 'ungrounded-entity',
          layer: 4,
          witness: [behind],
          detail: { ungroundedEntity: { name: 'discount', nearestName: 'amount' } },
        },
      ],
      citations: { complete: true, findings: [link, column] },
    });
    expect(
      standingLineOf(
        assessmentDataOf(assessment),
        [],
        false,
        standingFactsOf(assessment, new Map()),
      ),
    ).toBe(
      'Not sure — the cited result did not include the requested column `discount` (closest visible name: `amount`).',
    );
  });

  it('keeps a contradicted span as an answer reason without making a supported span known', () => {
    const supported = { kind: 'citation', ...site, outcome: 'supported' };
    expect(fold([supported])).toMatchObject({
      standing: 'not-assessed',
      reasons: [],
      citations: { complete: true, findings: [supported] },
    });
    const contradicted = { ...supported, outcome: 'contradicted' };
    expect(fold([contradicted])).toMatchObject({
      standing: 'not-sure',
      reasons: [
        {
          reason: 'unsupported-claim',
          witness: [{ kind: 'state', key: 'answerCitations', path: '/findings/0/outcome' }],
          source: { kind: 'answer' },
        },
      ],
    });
  });

  it('does not publish private or unknown values from a saved record', () => {
    const extra = { offer: 'private offer', data: 'raw body', bodyDigest: 'private digest' };
    const assessment = fold([
      { ...link, ...extra },
      { ...column, ...extra },
      { ...link, reason: 'private unknown reason' },
      { ...link, end: 2 ** 32, outcome: 'contradicted' },
      { ...link, outcome: 'contradicted', slot: 'REDACTED' },
    ]);
    expect(assessment.reasons[0]?.witness).toEqual([behind]);
    expect(assessment.citations).toEqual({ complete: false, findings: [link, column] });
  });

  it('omits a redacted name and does not invent a named absence without its readable slot', () => {
    expect(fold([link, { ...column, name: 'REDACTED' }], true)).toMatchObject({
      standing: 'not-assessed',
      reasons: [],
      citations: { complete: false, findings: [link] },
    });
    expect(fold([{ ...link, slot: 'REDACTED' }, column], true)).toMatchObject({
      standing: 'not-assessed',
      reasons: [],
      citations: { complete: false, findings: [] },
    });
    const maskedHint = fold([link, { ...column, nearestName: '[REDACTED]' }], true);
    expect(maskedHint.reasons[0]?.detail).toEqual({ ungroundedEntity: { name: 'discount' } });
    expect(JSON.stringify(maskedHint)).not.toContain('REDACTED');
  });

  it('defers to the existing whole-key redaction guard', () => {
    const assessment = foldState({ answerCitations: '[REDACTED]' }, undefined, true);
    expect(assessment).toMatchObject({
      standing: 'not-assessed',
      reasons: [],
      keptOut: ['answerCitations'],
    });
    expect(assessment).not.toHaveProperty('citations');
  });

  it('uses retained field names before the live warning reaches the answer', () => {
    const record = { complete: true, findings: [link, column] };
    const retaining = (path: string) =>
      new RedactionRule({ fields: { answerCitations: [path] } }).retain(
        ['answerCitations'],
        record,
      );
    const fromWarningRecord = (retained: unknown) =>
      foldState({ answerCitations: citationRecordForWarning(record, retained) }, undefined, false);
    expect(fromWarningRecord(retaining('findings.1.name'))).toMatchObject({
      standing: 'not-assessed',
      reasons: [],
      citations: { complete: false, findings: [link] },
    });
    const withoutHint = fromWarningRecord(retaining('findings.1.nearestName'));
    expect(withoutHint.reasons[0]?.detail).toEqual({ ungroundedEntity: { name: 'discount' } });
    expect(withoutHint.reasons[0]?.witness).toEqual([behind]);
    const whole = new RedactionRule({ keys: ['answerCitations'] }).retain(
      ['answerCitations'],
      record,
    );
    expect(fromWarningRecord(whole)).not.toHaveProperty('citations');
    expect(fromWarningRecord(record)).toEqual(fold([link, column]));
  });

  it('replays the same sanitized projection after JSON save and reload', () => {
    const state = { answerCitations: { complete: true, findings: [link, column] } };
    expect(foldState(JSON.parse(JSON.stringify(state)), undefined, false)).toEqual(
      fold([link, column]),
    );
    expect(foldState({}, undefined, false)).not.toHaveProperty('citations');
  });
});

it('retains both public slots and lowers standing when submitted sources disagree', () => {
  const record = { complete: true, findings: [], comparisonComplete: true, conflicts: [[1, 2]] };
  const assessment = foldState({ answerCitations: record }, undefined, true);
  expect(assessment).toMatchObject({
    standing: 'not-sure',
    reasons: [
      {
        reason: 'sources-conflict',
        witness: [{ kind: 'state', key: 'answerCitations', path: '/conflicts/0' }],
      },
    ],
    citations: record,
  });
  expect(
    standingLineOf(assessmentDataOf(assessment), [], false, standingFactsOf(assessment, new Map())),
  ).toBe('Not sure — two results sent to the model disagree.');
  expect(
    foldState({ answerCitations: { ...record, conflicts: [[1, '[REDACTED]']] } }, undefined, true),
  ).toMatchObject({
    standing: 'not-assessed',
    citations: { complete: true, findings: [], comparisonComplete: false, conflicts: [] },
  });
});

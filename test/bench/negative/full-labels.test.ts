/** Synthetic data only. Blind packet boundaries, exhaustive coverage and owner queues. */
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain benchmark .mjs module
import {
  agreementDisputes,
  makeLabelPacket,
  makeUsefulnessPacket,
  splitSentences,
  validateLabels,
} from '../../../bench/negative/full/labels.mjs';

function raw() {
  return {
    blindId: 'packet_001',
    question: 'What did the synthetic search find?',
    toolTruth: [
      {
        id: 'read-1',
        name: 'search',
        arguments: { service: 'fixture' },
        result: { rows: [], coverage: 'complete' },
        outcome: 'returned',
        verdict: 'SECRET_VERDICT',
      },
    ],
    stages: [
      {
        text: 'There are no incidents. Everything is quiet!',
        citations: [
          { kind: 'none', about: 'fixture', restsOn: ['read-1'], statement: 'SECRET_STATEMENT' },
        ],
        kind: 'draft',
        verdict: 'SECRET_VERDICT',
      },
      { text: 'The search returned no incidents.', citations: [] },
    ],
    delivered: 'SECRET_LIBRARY_STATEMENT',
    model: 'SECRET_MODEL',
    arm: 'SECRET_ARM',
    grammar: 'SECRET_GRAMMAR',
    verdict: 'SECRET_VERDICT',
  };
}

function labels() {
  const packet = makeLabelPacket(raw());
  return {
    sentences: packet.stages.flatMap((s: { sentences: { id: string }[] }) =>
      s.sentences.map((s) => ({
        id: s.id,
        kind: 'non-existence',
        truth: 'supported',
        flat: true,
        asks: false,
        substitution: false,
        reason: 'The synthetic read was complete.',
      })),
    ),
    citations: [
      { id: 's1.c1', valid: true, correct: true, rightReads: ['read-1'], reason: 'Same scope.' },
    ],
  };
}

describe('blind packets', () => {
  it('projects every draft and correction without treatment/checker/library metadata', () => {
    const packet = makeLabelPacket(raw());
    expect(packet.stages).toHaveLength(2);
    expect(packet.stages.flatMap((s: { sentences: unknown[] }) => s.sentences)).toHaveLength(3);
    expect(packet.stages[0].citations).toEqual([
      { id: 's1.c1', kind: 'none', about: 'fixture', restsOn: ['read-1'] },
    ]);
    expect(JSON.stringify(packet)).not.toContain('SECRET_');
    expect(packet.toolTruth[0].result).toEqual({ rows: [], coverage: 'complete' });
    expect(packet.stages[0]).not.toHaveProperty('kind');
  });

  it('detaches input data and exposes delivered wording only in the separate usefulness pass', () => {
    const input = raw(),
      packet = makeLabelPacket(input);
    input.toolTruth[0].arguments.service = 'mutated';
    expect(packet.toolTruth[0].arguments.service).toBe('fixture');
    const usefulness = makeUsefulnessPacket(input);
    expect(usefulness.answer).toBe('SECRET_LIBRARY_STATEMENT');
    expect(usefulness).not.toHaveProperty('stages');
    expect(usefulness).not.toHaveProperty('arm');
  });

  it('retains every non-whitespace character through punctuation/newlines/code-like text', () => {
    const text = 'A v1.2 value.\nNo items?\n```\nconst x = 0;\n```\nTrailing fragment';
    expect(splitSentences(text).join('').replace(/\s/gu, '')).toBe(text.replace(/\s/gu, ''));
    expect(splitSentences('')).toEqual([]);
  });

  it('keeps malformed citations visible rather than repairing or dropping them', () => {
    const input = { ...raw(), stages: [{ text: '', citations: [null, { kind: 'invented' }] }] };
    expect(makeLabelPacket(input).stages[0].citations).toEqual([
      { id: 's1.c1', malformed: null },
      { id: 's1.c2', kind: 'invented' },
    ]);
  });

  it('refuses missing stages and ambiguous tool truth identities', () => {
    expect(() => makeLabelPacket({ ...raw(), stages: [] })).toThrow('stages');
    const input = raw();
    input.toolTruth.push(input.toolTruth[0]);
    expect(() => makeLabelPacket(input)).toThrow('duplicate');
  });
});

describe('complete ratings and owner adjudication', () => {
  it('accepts valid complete JSON and never invents omitted sentence labels', () => {
    const packet = makeLabelPacket(raw()),
      value = labels();
    expect(validateLabels(packet, JSON.stringify(value)).ok).toBe(true);
    value.sentences.pop();
    expect(validateLabels(packet, value)).toMatchObject({ ok: false, labels: undefined });
  });

  it.each(['duplicate', 'unknown', 'string-boolean', 'unknown-read', 'wrong-correct', 'extra'])(
    'refuses %s label evidence',
    (mode) => {
      const value = labels();
      if (mode === 'duplicate') value.sentences.push(value.sentences[0]);
      if (mode === 'unknown') value.sentences[0].id = 'invented';
      if (mode === 'string-boolean') Object.assign(value.sentences[0], { flat: 'false' });
      if (mode === 'unknown-read') value.citations[0].rightReads = ['invented'];
      if (mode === 'wrong-correct') value.citations[0].valid = false;
      if (mode === 'extra') Object.assign(value, { arm: 'enforce' });
      expect(validateLabels(makeLabelPacket(raw()), value).ok).toBe(false);
    },
  );

  it('ignores reason wording but queues every substantive disagreement', () => {
    const a = labels(),
      b = labels();
    b.sentences[0].reason = 'Different explanation, same label.';
    expect(agreementDisputes(makeLabelPacket(raw()), a, b).complete).toBe(true);
    b.sentences[0].truth = 'unsupported';
    b.citations[0].correct = false;
    const result = agreementDisputes(makeLabelPacket(raw()), a, b);
    expect(result.complete).toBe(false);
    expect(result.disputes.map((d: { id: string }) => d.id)).toEqual(['s1.p1', 's1.c1']);
  });

  it('missing or invalid rater data produces an owner queue, never agreement', () => {
    const result = agreementDisputes(makeLabelPacket(raw()), labels(), undefined);
    expect(result.complete).toBe(false);
    expect(result.disputes).toHaveLength(4);
    expect(
      result.disputes.every((d: { reason: string }) => d.reason === 'missing-or-invalid'),
    ).toBe(true);
  });

  it('validates usefulness separately and queues disagreeing scores', () => {
    const packet = makeUsefulnessPacket(raw());
    expect(validateLabels(packet, { score: 4, reason: 'Useful and accurate.' }).ok).toBe(true);
    expect(validateLabels(packet, { score: 4.5, reason: 'No.' }).ok).toBe(false);
    expect(
      agreementDisputes(packet, { score: 4, reason: 'Good.' }, { score: 5, reason: 'Very good.' }),
    ).toMatchObject({
      complete: false,
      disputes: [{ kind: 'usefulness', reason: 'disagreement' }],
    });
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  captureDispatch,
  captureReturnedEvidence,
  evidenceSnapshot,
  finalizeEvidence,
} from '../../../../../integrity/claim-binding/capture.js';
import type {
  ClaimBindingRule,
  EvidenceSnapshot,
} from '../../../../../integrity/claim-binding/types.js';
import type { SubmittedCitationOffer } from '../../../../../provider-contract/citationResponse.js';
import { describedResult } from '../../../../../semantics/described.js';
import { semanticsForModel } from '../../../../../semantics/envelope.js';
import { assessCitedAnswer } from './assessCitedAnswer.js';
import type { CitationClaim } from './check/checkClaim.js';

const coveredDay = { from: '2026-11-23T00:00:00Z', to: '2026-11-24T00:00:00Z' };
const scope = { station: 'North', period: coveredDay };
const rule: ClaimBindingRule = {
  id: 'rainfall',
  version: '1',
  toolName: 'read_weather',
  scopeDeclaration: {
    id: 'weather',
    version: '1',
    dimensions: Object.keys(scope).map((name) => ({ name, argumentPath: [name] })),
    periodDimension: 'period',
  },
  fact: { entity: { scopeDimension: 'station' }, field: 'rainfall' },
  coverage: () => 'complete',
};
const phrase = 'North recorded 12 mm';
const answer = `${phrase} [c:private-offer:1].`;
const location = { start: 0, end: phrase.length };
const claim: CitationClaim = {
  ruleId: rule.id,
  entity: scope.station,
  field: 'rainfall',
  intendedScope: scope,
  value: 12,
};

function fixture(readScope = scope) {
  const original = describedResult({
    facts: [{ entity: readScope.station, rainfall: 12 }],
    provenance: { measuredAt: readScope.period.to, source: 'private provenance' },
    coverage: { checked: ['rainfall'] },
    period: { queried: readScope.period, held: readScope.period },
  });
  const dispatch = captureDispatch(
    { namespace: 'private-record', runId: 'private-run', ordinal: 1 },
    { toolName: rule.toolName, toolCallId: 'private-call-id', iteration: 0 },
    readScope,
    rule.scopeDeclaration,
  );
  const receipt = finalizeEvidence(
    dispatch,
    captureReturnedEvidence(dispatch, original),
    semanticsForModel(original),
    { completed: true, resultVisible: true, scopeVisible: true },
  );
  const offer: SubmittedCitationOffer = {
    offer: 'private-offer',
    results: [
      { slot: 1, resultId: receipt.id, occurrence: [1, 2, 3, 4, 0], bodyDigest: 'f'.repeat(64) },
    ],
  };
  return {
    offer,
    evidence: evidenceSnapshot('private-record', ['private-run'], [receipt]),
    rules: [rule],
  };
}

describe('final citation assessment', () => {
  it('passes only marker-free prose to the author and publishes offsets instead of private evidence', () => {
    const extractClaim = vi.fn(() => claim);
    const result = assessCitedAnswer({ answer, ...fixture(), extractClaim });
    expect(extractClaim.mock.calls).toEqual([[phrase]]);
    expect(result).toEqual({
      complete: true,
      findings: [{ kind: 'citation', ...location, slot: 1, outcome: 'supported' }],
    });
  });

  it('detaches the first authored claim before the author can reuse its object', () => {
    const reused = { ...claim };
    const extractClaim = (text: string): CitationClaim => {
      reused.value = text === phrase ? 12 : 11;
      return reused;
    };
    const second = 'North recorded 11 mm';
    const combined = `${answer} ${second} [c:private-offer:1].`;
    const findings = assessCitedAnswer({ answer: combined, ...fixture(), extractClaim }).findings;
    expect(findings).toEqual([
      { kind: 'citation', ...location, slot: 1, outcome: 'supported' },
      {
        kind: 'citation',
        start: answer.length + 1,
        end: answer.length + 1 + second.length,
        slot: 1,
        outcome: 'contradicted',
      },
    ]);
  });

  it.each([
    { ...scope, station: 'South' },
    { ...scope, period: { from: '2026-11-22T00:00:00Z', to: coveredDay.from } },
  ])('leaves a same-value link unverified when the cited entity or period differs', (readScope) => {
    expect(
      assessCitedAnswer({ answer, ...fixture(readScope), extractClaim: () => claim }).findings,
    ).toEqual([
      { kind: 'citation', ...location, slot: 1, outcome: 'unverified', reason: 'scope-mismatch' },
    ]);
  });

  it('does not give an old marker a current slot even after a saved offer reload', () => {
    const inputs = fixture();
    const offer = JSON.parse(JSON.stringify(inputs.offer)) as SubmittedCitationOffer;
    const extractClaim = vi.fn(() => claim);
    expect(
      assessCitedAnswer({
        ...inputs,
        offer,
        answer: `${phrase} [c:abandoned:1] [c:private-offer:1].`,
        extractClaim,
      }).findings,
    ).toEqual([
      { kind: 'citation', ...location, outcome: 'unverified', reason: 'offer-unavailable' },
      { kind: 'citation', ...location, slot: 1, outcome: 'supported' },
    ]);
    expect(extractClaim.mock.calls).toEqual([[phrase]]);
  });

  it('keeps a link but declines an authored claim if the prose contains an interior marker', () => {
    const interior = 'North [c:abandoned:1] recorded 12 mm';
    const extractClaim = vi.fn(() => claim);
    expect(
      assessCitedAnswer({
        ...fixture(),
        answer: `${interior} [c:private-offer:1].`,
        extractClaim,
      }).findings,
    ).toEqual([
      {
        kind: 'citation',
        start: 0,
        end: interior.length,
        slot: 1,
        outcome: 'unverified',
        reason: 'scope-unresolved',
      },
    ]);
    expect(extractClaim).not.toHaveBeenCalled();
  });

  it('keeps offered links when evidence or author projection is unavailable', async () => {
    const inputs = fixture();
    const badEvidence = { ...inputs.evidence, version: 2 } as unknown as EvidenceSnapshot;
    const extractClaim = vi.fn(() => claim);
    for (const evidence of [undefined, badEvidence]) {
      expect(assessCitedAnswer({ answer, ...inputs, evidence, extractClaim }).findings).toEqual([
        {
          kind: 'citation',
          ...location,
          slot: 1,
          outcome: 'unverified',
          reason: 'evidence-unavailable',
        },
      ]);
    }
    const throwing = () => {
      throw new Error('private author failure');
    };
    const asyncFailure = async () => {
      throw new Error('private asynchronous failure');
    };
    for (const invalid of [throwing, asyncFailure as unknown as () => CitationClaim]) {
      expect(assessCitedAnswer({ answer, ...inputs, extractClaim: invalid }).findings).toEqual([
        {
          kind: 'citation',
          ...location,
          slot: 1,
          outcome: 'unverified',
          reason: 'scope-unresolved',
        },
      ]);
    }
    await Promise.resolve();
  });

  it('reports the requested missing column once using the single accepted schema', () => {
    const { offer } = fixture();
    const visibleColumnsFor = vi.fn(() => ['region', 'amount']);
    const duplicate = `${phrase} [c:private-offer:1] [c:private-offer:1].`;
    const findings = assessCitedAnswer({
      answer: `${duplicate} ${answer}`,
      offer,
      requestedColumn: 'discount',
      visibleColumnsFor,
    }).findings;
    expect(visibleColumnsFor.mock.calls).toEqual([[offer.results[0]?.resultId]]);
    expect(findings.filter(({ kind }) => kind === 'column')).toEqual([
      {
        kind: 'column',
        ...location,
        slot: 1,
        reason: 'ungrounded-entity',
        name: 'discount',
        nearestName: 'amount',
      },
    ]);
    expect(findings.filter(({ kind }) => kind === 'citation')).toHaveLength(2);
  });

  it('skips column absence for guessed names and for ambiguous multiple accepted sources', () => {
    const { offer } = fixture();
    const visibleColumnsFor = vi.fn(() => ['amount']);
    expect(
      assessCitedAnswer({ answer, offer, visibleColumnsFor }).findings.map(({ kind }) => kind),
    ).toEqual(['citation']);
    const first = offer.results[0]!;
    const second = {
      ...first,
      slot: 2,
      resultId: 'claim-result/private-record/private-run/2',
      occurrence: [1, 2, 3, 4, 1] as const,
    };
    const both = assessCitedAnswer({
      answer: `${phrase} [c:private-offer:1] [c:private-offer:2].`,
      offer: { ...offer, results: [first, second] },
      requestedColumn: 'discount',
      visibleColumnsFor,
    });
    expect(both.findings.map(({ kind }) => kind)).toEqual(['citation', 'citation']);
    expect(visibleColumnsFor).not.toHaveBeenCalled();
  });

  it('does not look up evidence or schemas if a submitted slot is ambiguous or the scan exceeds its bound', () => {
    const inputs = fixture();
    const extractClaim = vi.fn(() => claim);
    const visibleColumnsFor = vi.fn(() => ['amount']);
    const instance = { ...inputs, extractClaim, requestedColumn: 'discount', visibleColumnsFor };
    const duplicate = {
      ...inputs.offer,
      results: [...inputs.offer.results, ...inputs.offer.results],
    };
    expect(assessCitedAnswer({ ...instance, answer, offer: duplicate }).findings).toEqual([
      {
        kind: 'citation',
        ...location,
        outcome: 'unverified',
        reason: 'offer-unavailable',
      },
    ]);
    expect(assessCitedAnswer({ ...instance, answer: `${answer} `.repeat(257) })).toEqual({
      complete: false,
      findings: [],
    });
    expect(extractClaim).not.toHaveBeenCalled();
    expect(visibleColumnsFor).not.toHaveBeenCalled();
  });
});

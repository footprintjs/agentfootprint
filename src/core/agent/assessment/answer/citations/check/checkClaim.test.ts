import { describe, expect, it } from 'vitest';
import {
  captureDispatch,
  captureReturnedEvidence,
  evidenceSnapshot,
  finalizeEvidence,
} from '../../../../../../integrity/claim-binding/capture.js';
import type { ClaimBindingRule } from '../../../../../../integrity/claim-binding/types.js';
import { describedResult } from '../../../../../../semantics/described.js';
import { semanticsForModel } from '../../../../../../semantics/envelope.js';
import { checkCitationClaim, type CitationClaim } from './checkClaim.js';

const day = { from: '2026-11-23T00:00:00Z', to: '2026-11-24T00:00:00Z' };
const priorDay = { from: '2026-11-22T00:00:00Z', to: day.from };
const scope = { station: 'North', period: day, unit: 'mm', grain: 'day' };
const rule: ClaimBindingRule = {
  id: 'daily-rainfall',
  version: '1',
  toolName: 'read_rainfall',
  scopeDeclaration: {
    id: 'scope-rainfall',
    version: '1',
    dimensions: Object.keys(scope).map((name) => ({ name, argumentPath: [name] })),
    periodDimension: 'period',
  },
  fact: { entity: { scopeDimension: 'station' }, field: 'rainfall' },
  coverage: () => 'complete',
};

function offerEvidence(readScope = scope, rainfall: unknown = 12) {
  const original = describedResult({
    facts: [{ entity: readScope.station, rainfall }],
    provenance: { measuredAt: readScope.period.to, source: 'synthetic weather fixture' },
    coverage: { checked: ['daily rainfall'] },
    period: { queried: readScope.period, held: readScope.period },
  });
  const dispatch = captureDispatch(
    { namespace: 'record', runId: 'run', ordinal: 1 },
    { toolName: rule.toolName, toolCallId: 'repeated-id', iteration: 0 },
    readScope,
    rule.scopeDeclaration,
  );
  const receipt = finalizeEvidence(
    dispatch,
    captureReturnedEvidence(dispatch, original),
    semanticsForModel(original),
    { completed: true, resultVisible: true, scopeVisible: true },
  );
  return {
    resultId: receipt.id,
    snapshot: evidenceSnapshot('record', ['run'], [receipt]),
    rules: [rule],
  };
}

const claim: CitationClaim = {
  ruleId: rule.id,
  entity: scope.station,
  field: 'rainfall',
  intendedScope: scope,
  value: 12,
};

describe('citation claim verification', () => {
  it.each([
    ['station', { ...scope, station: 'South' }],
    ['period', { ...scope, period: priorDay }],
    ['unit', { ...scope, unit: 'cm' }],
    ['grain', { ...scope, grain: 'week' }],
  ])('cannot support the same value from the wrong %s', (_kind, readScope) => {
    expect(checkCitationClaim(claim, offerEvidence(readScope))).toEqual({
      outcome: 'unverified',
      reason: 'scope-mismatch',
    });
  });

  it.each([{ entity: 'South' }, { field: 'temperature' }])(
    'requires the bound assertion to match the claim independently of scope',
    (qualifier) => {
      expect(checkCitationClaim({ ...claim, ...qualifier }, offerEvidence())).toEqual({
        outcome: 'unverified',
        reason: 'assertion-mismatch',
      });
    },
  );

  it.each([
    [12, '12'],
    ['12', 12],
  ])('keeps different value types unverified', (claimed, recorded) => {
    expect(
      checkCitationClaim({ ...claim, value: claimed }, offerEvidence(scope, recorded)),
    ).toEqual({
      outcome: 'unverified',
      reason: 'value-type-mismatch',
    });
  });

  it('supports the same typed value on the exact independently authored scope', () => {
    expect(checkCitationClaim(claim, offerEvidence())).toEqual({ outcome: 'supported' });
  });

  it('compares an actual differing value on the same scope', () => {
    expect(checkCitationClaim(claim, offerEvidence(scope, 11))).toEqual({
      outcome: 'contradicted',
    });
  });

  it('keeps missing scope unverified even with matching evidence', () => {
    expect(checkCitationClaim(undefined, offerEvidence())).toEqual({
      outcome: 'unverified',
      reason: 'scope-unresolved',
    });
    const { intendedScope: _scope, ...missingScope } = claim;
    expect(checkCitationClaim(missingScope as CitationClaim, offerEvidence())).toEqual({
      outcome: 'unverified',
      reason: 'scope-unresolved',
    });
  });

  it('keeps an unavailable offer unverified despite an exact authored claim', () => {
    expect(checkCitationClaim(claim, undefined)).toEqual({
      outcome: 'unverified',
      reason: 'offer-unavailable',
    });
  });

  it('does not invoke an accessor supplied as the independently authored scope', () => {
    let reads = 0;
    const malformed = Object.defineProperty({ ...claim }, 'intendedScope', {
      get() {
        reads += 1;
        return scope;
      },
    });
    expect(checkCitationClaim(malformed, offerEvidence())).toEqual({
      outcome: 'unverified',
      reason: 'scope-unresolved',
    });
    expect(reads).toBe(0);
  });

  it('keeps the existing binder ownership for an unknown result', () => {
    expect(
      checkCitationClaim(claim, { ...offerEvidence(), resultId: 'claim-result/record/run/2' }),
    ).toEqual({ outcome: 'unverified', reason: 'missing-result' });
  });
});

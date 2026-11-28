import { RedactionRule } from 'footprintjs/advanced';
import { describe, expect, it, vi } from 'vitest';
import { assessLive } from '../../assess.js';
import { foldState } from '../../chart.js';
import { assessmentDataOf, standingFactsOf, standingLineOf } from '../../compose.js';

const verified = { claim: 'ran-code', target: 'current', outcome: 'verified' };
const contradicted = { claim: 'ran-code', target: 'current', outcome: 'contradicted' };
const unverified = { claim: 'no-code', target: 'previous', outcome: 'unverified' };
const witness = (index: number) => ({
  kind: 'state',
  key: 'answerExecutionClaims',
  path: `/findings/${index}/outcome`,
});
const fold = (answerExecutionClaims: unknown, served = false) =>
  foldState({ answerExecutionClaims }, undefined, served);
const lineOf = (assessment: ReturnType<typeof fold>) =>
  standingLineOf(assessmentDataOf(assessment), [], false, standingFactsOf(assessment, new Map()));

describe('committed execution claim assessments', () => {
  it('lowers standing on a contradicted execution claim and keeps its committed witness', () => {
    const result = fold({ complete: true, findings: [verified, contradicted] });
    expect(result).toMatchObject({
      standing: 'not-sure',
      reasons: [
        {
          reason: 'unsupported-claim',
          layer: 4,
          source: { kind: 'answer' },
          witness: [witness(1)],
        },
      ],
      checked: [],
    });
    expect(lineOf(result)).toBe(
      'Not sure — a claim about running code disagrees with the recorded evidence.',
    );
  });

  it('distinguishes an unverified claim from a contradiction', () => {
    const result = fold({ complete: true, findings: [unverified] });
    expect(result).toMatchObject({
      standing: 'not-sure',
      reasons: [{ reason: 'check-unreachable', witness: [witness(0)] }],
      checked: [],
    });
    expect(lineOf(result)).toBe(
      'Not sure — the recorded evidence could not verify whether code ran.',
    );
  });

  it('carries an unresolved target only as an unverified finding', () => {
    const reportOf = (outcome: string) => ({
      complete: true,
      findings: [{ claim: 'ran-code', target: 'unresolved', outcome }],
    });
    expect(fold(reportOf('unverified')).reasons).toMatchObject([
      { reason: 'check-unreachable', witness: [witness(0)] },
    ]);
    expect(fold(reportOf('contradicted'))).toEqual(foldState({}, undefined, false));
  });

  it('gives a verified claim no standing credit, preserving older and skipped records', () => {
    const before = foldState({}, undefined, false);
    expect(fold({ complete: true, findings: [verified] })).toEqual(before);
    expect(fold({ complete: false, findings: [] })).toEqual(before);
  });

  it('keeps live and reopened readings equal for the same retained record', () => {
    const record = { complete: true, findings: [verified, contradicted, unverified] };
    expect(fold(JSON.parse(JSON.stringify(record)), true)).toEqual(fold(record));
  });

  it.each([
    'complete',
    'findings.0',
    'findings.0.claim',
    'findings.0.target',
    'findings.0.outcome',
  ])('keeps a masked %s from changing public reasons or standing', (path) => {
    const rule = new RedactionRule({ fields: { answerExecutionClaims: [path] } });
    const reportOf = (row: unknown) => ({ complete: true, findings: [row] });
    const live = assessLive(
      { sharedState: { answerExecutionClaims: reportOf(contradicted) } },
      undefined,
      (key, value) => rule.retain([key], value),
    );
    const saved = fold(
      JSON.parse(JSON.stringify(rule.retain(['answerExecutionClaims'], reportOf(unverified)))),
      true,
    );
    expect(live).toEqual(saved);
    expect(live).toEqual(foldState({}, undefined, false));
  });

  it('keeps a wholly masked report from changing an unrelated standing', () => {
    const rule = new RedactionRule({ keys: ['answerExecutionClaims'] });
    const state = { answerValidation: { status: 'failed' } };
    const held = rule.retain(['answerExecutionClaims'], {
      complete: true,
      findings: [contradicted],
    });
    const previous = foldState(state, undefined, false);
    expect(foldState({ ...state, answerExecutionClaims: held }, undefined, false)).toEqual(
      previous,
    );
    expect(foldState({ ...state, answerExecutionClaims: held }, undefined, true)).toEqual(previous);
  });

  it('preserves the existing reason wording when another answer check owns the same reason', () => {
    const state = { answerValidation: { status: 'unverified' } };
    const original = foldState(state, undefined, false);
    const withExecutionClaim = foldState(
      { ...state, answerExecutionClaims: { complete: true, findings: [unverified] } },
      undefined,
      false,
    );
    expect(lineOf(withExecutionClaim)).toBe(lineOf(original));
    expect(withExecutionClaim.reasons[0]?.witness).toContainEqual(witness(0));
  });

  it('requires the retained dispatch locator to disprove a no-code claim', () => {
    const claim = { claim: 'no-code', target: 'previous', outcome: 'contradicted' };
    const confirmed = {
      complete: true,
      findings: [{ ...claim, callOccurrenceKey: [1, 2, 3, 4, 5] }],
    };
    expect(fold(confirmed).reasons[0]).toMatchObject({
      reason: 'unsupported-claim',
      witness: [witness(0)],
    });
    const before = foldState({}, undefined, false);
    expect(fold({ complete: true, findings: [claim] })).toEqual(before);
    for (const path of ['findings.0.callOccurrenceKey', 'findings.0.callOccurrenceKey.3']) {
      const rule = new RedactionRule({ fields: { answerExecutionClaims: [path] } });
      const live = assessLive(
        { sharedState: { answerExecutionClaims: confirmed } },
        undefined,
        (key, value) => rule.retain([key], value),
      );
      const retained = JSON.parse(
        JSON.stringify(rule.retain(['answerExecutionClaims'], confirmed)),
      );
      expect(live).toEqual(before);
      expect(fold(retained, true)).toEqual(before);
    }
  });

  it('bounds findings and leaves accessor-backed proof unread', () => {
    const outcome = vi.fn(() => 'contradicted');
    const row = Object.defineProperty({ claim: 'ran-code', target: 'current' }, 'outcome', {
      enumerable: true,
      get: outcome,
    });
    const before = foldState({}, undefined, false);
    expect(fold({ complete: true, findings: [row] })).toEqual(before);
    expect(fold({ complete: true, findings: Array(1000).fill(contradicted) })).toEqual(before);
    expect(outcome).not.toHaveBeenCalled();
  });
});

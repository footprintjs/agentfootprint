import { describe, expect, it } from 'vitest';
import { resolveAnswerValidation } from '../../../../answer-validation/validate.js';
import { resolveEvidenceGate } from '../../evidence/gate.js';
import type { AgentState } from '../../types.js';
import { refusalVerdictOf, validationVerdictOf, type RefusalPolicy } from './verdicts.js';

const unarmed: RefusalPolicy = { messageMiddleware: [] };
const validation = resolveAnswerValidation({
  id: 'declared-validator',
  version: 'one',
  mode: 'enforce',
  validate: () => ({ checks: [] }),
});

describe('terminal records at an agent boundary', () => {
  it('does not turn an unarmed record into a refusal', () => {
    expect(
      refusalVerdictOf(
        {
          reliabilityFailKind: 'budget',
          messageDeniedReason: 'withheld',
          unsupportedValues: { refused: true, values: [], candidates: 0, revised: false },
        },
        unarmed,
      ),
    ).toBeUndefined();
  });

  it('keeps reliability ahead of policy halt without adding absent record keys', () => {
    expect(
      refusalVerdictOf(
        { reliabilityFailKind: 'budget', policyHaltReason: 'halt', policyHaltTarget: 'send' },
        { ...unarmed, reliabilityConfig: {} },
      ),
    ).toEqual({ kind: 'reliability-fail-fast', record: { reliabilityFailKind: 'budget' } });
  });

  it('keeps policy halt ahead of a withheld message and retains its proposed call', () => {
    expect(
      refusalVerdictOf(
        {
          policyHaltReason: 'approval missing',
          policyHaltTarget: 'send',
          policyHaltIteration: 3,
          policyHaltArgs: { to: 'declared destination' },
          policyHaltTellLLM: '',
          policyHaltCheckerId: '',
          messageDeniedReason: 'later refusal',
        },
        { ...unarmed, findingsOptions: {} },
      ),
    ).toEqual({
      kind: 'policy-halt',
      halt: {
        reason: 'approval missing',
        tellLLM: '',
        checkerId: '',
        history: [],
        iteration: 3,
        proposed: { name: 'send', args: { to: 'declared destination' } },
        sequence: [{ name: 'send', args: { to: 'declared destination' }, iteration: 3 }],
      },
    });
  });

  it('does not manufacture optional policy fields or require an argument object', () => {
    const verdict = refusalVerdictOf(
      { policyHaltReason: 'halt', policyHaltTarget: 'send' },
      unarmed,
    );
    expect(verdict).toMatchObject({ kind: 'policy-halt', halt: { proposed: { args: {} } } });
    if (verdict?.kind !== 'policy-halt') throw new Error('expected a policy halt');
    expect(verdict.halt).not.toHaveProperty('tellLLM');
    expect(verdict.halt).not.toHaveProperty('checkerId');
  });

  it('ignores a partial halt record and preserves message-boundary defaults', () => {
    expect(
      refusalVerdictOf(
        { policyHaltReason: 'incomplete', messageDeniedReason: 'withheld' },
        { ...unarmed, findingsOptions: {} },
      ),
    ).toEqual({
      kind: 'message-denied',
      denial: { reason: 'withheld', phase: 'output', middleware: 'middleware' },
    });
  });

  it('keeps a message refusal ahead of evidence rails', () => {
    expect(
      refusalVerdictOf(
        {
          messageDeniedReason: '',
          messageDeniedPhase: 'input',
          messageDeniedBy: '',
          unsupportedValues: { refused: true, values: [], candidates: 0, revised: false },
        },
        {
          ...unarmed,
          findingsOptions: {},
          evidenceGate: resolveEvidenceGate({ posture: 'rails' }),
        },
      ),
    ).toEqual({
      kind: 'message-denied',
      denial: { reason: '', phase: 'input', middleware: '' },
    });
  });

  it('raises unsupported values only for a refused answer under rails', () => {
    const state = {
      unsupportedValues: { refused: true, values: [], candidates: 2, revised: true },
    };
    for (const posture of ['assist', 'guard'] as const) {
      expect(
        refusalVerdictOf(state, { ...unarmed, evidenceGate: resolveEvidenceGate({ posture }) }),
      ).toBeUndefined();
    }
    const policy = { ...unarmed, evidenceGate: resolveEvidenceGate({ posture: 'rails' }) };
    expect(refusalVerdictOf(state, policy)).toMatchObject({
      kind: 'unsupported-values',
      refusal: { values: [], candidates: 2, revised: true },
    });
    expect(
      refusalVerdictOf(
        { unsupportedValues: { ...state.unsupportedValues, refused: false } },
        policy,
      ),
    ).toBeUndefined();
  });

  it('does not let a validator from another agent arm this boundary', () => {
    expect(validationVerdictOf({ answerValidationBlocked: true }, undefined)).toBeUndefined();
  });

  it('preserves the blocked validation record instead of replacing it with incomplete delivery', () => {
    const report = validationVerdictOf({}, validation);
    if (report?.kind !== 'answer-validation') throw new Error('expected a validation verdict');
    expect(
      validationVerdictOf(
        { answerValidationBlocked: true, answerValidation: report.report },
        validation,
      ),
    ).toEqual(report);
  });

  it('requires a committed report and a string answer before accepting delivery', () => {
    const incomplete = validationVerdictOf({}, validation);
    expect(incomplete).toMatchObject({
      kind: 'answer-validation',
      report: {
        validatorId: 'declared-validator',
        validatorVersion: 'one',
        mode: 'enforce',
        status: 'unverified',
        schemaAccepted: false,
        reason: 'delivery-incomplete',
      },
    });
    if (incomplete?.kind !== 'answer-validation') throw new Error('expected a validation verdict');
    const ready = {
      answerValidation: incomplete.report,
      answerValidationCommitted: true,
      finalContent: '',
    } satisfies Partial<AgentState>;
    expect(validationVerdictOf(ready, validation)).toBeUndefined();
    for (const missing of ['answerValidation', 'answerValidationCommitted', 'finalContent']) {
      const partial: Record<string, unknown> = { ...ready };
      delete partial[missing];
      expect(validationVerdictOf(partial, validation)).toEqual(incomplete);
    }
    expect(validationVerdictOf({ ...ready, finalContent: 1 }, validation)).toEqual(incomplete);
  });
});

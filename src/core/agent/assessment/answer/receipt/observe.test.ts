import type { TypedScope } from 'footprintjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { retainedStateValue } from '../../../../../redaction/runRedaction.js';
import {
  executionClaimContext,
  sealExecutionClaimTurn,
} from '../../../scripts/executionEvidence.js';
import type { AgentState } from '../../../types.js';
import { assessExecutionClaims } from './check/check.js';
import { withExecutionClaimAssessment } from './observe.js';

vi.mock('../../../../../redaction/runRedaction.js', () => ({ retainedStateValue: vi.fn() }));
vi.mock('../../../scripts/executionEvidence.js', () => ({
  executionClaimContext: vi.fn(),
  sealExecutionClaimTurn: vi.fn(),
}));
vi.mock('./check/check.js', () => ({ assessExecutionClaims: vi.fn() }));

function scope(overrides: Partial<AgentState> = {}): TypedScope<AgentState> {
  return { llmLatestContent: 'I ran code.', ...overrides } as TypedScope<AgentState>;
}

const occurrence = [1, 2, 3, 4, 5] as const;
const assessment = {
  complete: true,
  findings: [{ claim: 'ran-code', target: 'previous', outcome: 'verified' }],
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(retainedStateValue).mockImplementation((_scope, _key, value) => value);
  vi.mocked(executionClaimContext).mockReturnValue({
    defaultTarget: 'previous',
    evidence: { previous: 'confirmed' },
    occurrences: { previous: occurrence },
  });
  vi.mocked(assessExecutionClaims).mockReturnValue(assessment);
});

describe('terminal execution claim observation', () => {
  it('checks the settled prose and exact target context without changing the answer', async () => {
    const turn = scope();
    const route = withExecutionClaimAssessment(
      async (state) => {
        state.llmLatestContent = 'I ran code for my previous answer.';
        return 'final';
      },
      { structured: false, hasOutstandingConsent: () => false },
    );
    expect(await route(turn)).toBe('final');
    expect(assessExecutionClaims).toHaveBeenCalledOnce();
    expect(assessExecutionClaims).toHaveBeenCalledWith({
      reply: turn.llmLatestContent,
      defaultTarget: 'previous',
      evidence: { previous: 'confirmed' },
    });
    expect(turn.answerExecutionClaims).toEqual({
      complete: true,
      findings: [{ ...assessment.findings[0], callOccurrenceKey: occurrence }],
    });
    expect(turn.answerExecutionClaims?.findings[0]?.callOccurrenceKey).not.toBe(occurrence);
    expect(turn.llmLatestContent).toBe('I ran code for my previous answer.');
    expect(sealExecutionClaimTurn).toHaveBeenCalledWith(turn);
  });

  it('retains a dispatch locator only for the findings it proves', () => {
    const findings = [
      { claim: 'no-code', target: 'previous', outcome: 'contradicted' },
      { claim: 'ran-code', target: 'current', outcome: 'contradicted' },
      { claim: 'ran-code', target: 'previous', outcome: 'unverified' },
    ] as const;
    vi.mocked(assessExecutionClaims).mockReturnValue({ complete: true, findings });
    const turn = scope();
    const route = withExecutionClaimAssessment(() => 'final', {
      structured: false,
      hasOutstandingConsent: () => false,
    });
    expect(route(turn)).toBe('final');
    expect(turn.answerExecutionClaims?.findings).toEqual([
      { ...findings[0], callOccurrenceKey: occurrence },
      findings[1],
      findings[2],
    ]);
  });

  it.each(['output-retry', 'evidence-recheck', 'tool-calls', 'wrap-up'] as const)(
    'skips nonterminal branch %s',
    (branch) => {
      const turn = scope();
      const route = withExecutionClaimAssessment(() => branch, {
        structured: false,
        hasOutstandingConsent: () => false,
      });
      expect(route(turn)).toBe(branch);
      expect(executionClaimContext).not.toHaveBeenCalled();
      expect(sealExecutionClaimTurn).not.toHaveBeenCalled();
      expect(turn).not.toHaveProperty('answerExecutionClaims');
    },
  );

  it.each([
    { messageDeniedReason: 'denied' },
    { answerValidationBlocked: true },
    {
      unsupportedValues: {
        values: [],
        candidates: 0,
        revised: true,
        refused: true,
        posture: 'rails',
      },
    } satisfies Partial<AgentState>,
    { llmLatestStopReason: 'refusal' },
  ])('writes no observation or seal for a refused answer %o', (refusal) => {
    const turn = scope(refusal);
    const route = withExecutionClaimAssessment(() => 'final', {
      structured: false,
      hasOutstandingConsent: () => false,
    });
    expect(route(turn)).toBe('final');
    expect(assessExecutionClaims).not.toHaveBeenCalled();
    expect(sealExecutionClaimTurn).not.toHaveBeenCalled();
    expect(turn).not.toHaveProperty('answerExecutionClaims');
  });

  it('preserves a rejected route and leaves the answer unobserved', async () => {
    const turn = scope();
    const failure = new Error('Route failed');
    const route = withExecutionClaimAssessment(() => Promise.reject(failure), {
      structured: false,
      hasOutstandingConsent: () => false,
    });
    await expect(route(turn)).rejects.toBe(failure);
    expect(assessExecutionClaims).not.toHaveBeenCalled();
    expect(sealExecutionClaimTurn).not.toHaveBeenCalled();
  });

  it('does not treat a turn awaiting consent as completed', () => {
    const turn = scope();
    const route = withExecutionClaimAssessment(() => 'final', {
      structured: false,
      hasOutstandingConsent: () => true,
    });
    expect(route(turn)).toBe('final');
    expect(assessExecutionClaims).not.toHaveBeenCalled();
    expect(sealExecutionClaimTurn).not.toHaveBeenCalled();
  });

  it('seals a structured answer without treating its content as prose', () => {
    const turn = scope({
      llmLatestContent: '{"text":"I ran code."}',
      codeExecutionReceipt: { status: 'open' },
    });
    const route = withExecutionClaimAssessment(() => 'final', {
      structured: true,
      hasOutstandingConsent: () => false,
    });
    expect(route(turn)).toBe('final');
    expect(assessExecutionClaims).not.toHaveBeenCalled();
    expect(sealExecutionClaimTurn).toHaveBeenCalledWith(turn);
  });

  it.each([undefined, '[REDACTED]'])('suppresses unrestorable answer bytes (%s)', (retained) => {
    vi.mocked(retainedStateValue).mockReturnValue(retained);
    const turn = scope();
    const route = withExecutionClaimAssessment(() => 'final', {
      structured: false,
      hasOutstandingConsent: () => false,
    });
    expect(route(turn)).toBe('final');
    expect(assessExecutionClaims).not.toHaveBeenCalled();
    expect(turn).not.toHaveProperty('answerExecutionClaims');
    expect(sealExecutionClaimTurn).toHaveBeenCalledWith(turn);
  });

  it('adds no state key when the checker finds no eligible claim', () => {
    vi.mocked(assessExecutionClaims).mockReturnValue(undefined);
    const turn = scope({ llmLatestContent: 'Here is the table.' });
    const route = withExecutionClaimAssessment(() => 'final', {
      structured: false,
      hasOutstandingConsent: () => false,
    });
    expect(route(turn)).toBe('final');
    expect(turn).not.toHaveProperty('answerExecutionClaims');
  });
});

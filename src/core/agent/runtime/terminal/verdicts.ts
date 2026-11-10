import type { ResolvedAnswerValidation } from '../../../../answer-validation/types.js';
import { failFastRecordOf } from '../../../../reliability/failFastRecord.js';
import type { ReliabilityConfig } from '../../../../reliability/types.js';
import { extractSequence } from '../../../../security/extractSequence.js';
import type { TerminalVerdict } from '../../../terminalVerdict.js';
import { evidenceRefusalSentence } from '../../evidence/gate.js';
import type { ResolvedEvidenceGate } from '../../evidence/types.js';
import type { MessageMiddleware } from '../../middleware/types.js';
import type { AgentOptions, AgentState } from '../../types.js';

/** The declarations that arm terminal records; no runner or execution identity. */
export interface RefusalPolicy {
  readonly reliabilityConfig?: ReliabilityConfig;
  readonly messageMiddleware: readonly MessageMiddleware[];
  readonly findingsOptions?: NonNullable<AgentOptions['findings']>;
  readonly evidenceGate?: ResolvedEvidenceGate;
}

/** The records a run ends on in place of an answer, in the order the boundary raises them. */
export function refusalVerdictOf(
  state: Readonly<Record<string, unknown>>,
  policy: RefusalPolicy,
): TerminalVerdict | undefined {
  // Reliability fail-fast (v2.11.5+) — the loop in callLLM writes the record
  // and calls $break (`reliability/failFastRecord.ts`).
  if (policy.reliabilityConfig !== undefined) {
    const record = failFastRecordOf(state);
    if (record !== undefined) return { kind: 'reliability-fail-fast', record };
  }
  // Policy halt (v2.12+) — a `PermissionChecker` returned `halt`; the
  // toolCalls handler wrote a synthetic tool_result and the policyHalt*
  // fields, and called $break.
  const halt = state as {
    policyHaltReason?: string;
    policyHaltTellLLM?: string;
    policyHaltTarget?: string;
    policyHaltArgs?: Readonly<Record<string, unknown>>;
    policyHaltIteration?: number;
    policyHaltCheckerId?: string;
    history?: import('../../../../provider-contract/types.js').LLMMessage[];
  };
  if (halt.policyHaltReason !== undefined && halt.policyHaltTarget !== undefined) {
    const history = halt.history ?? [];
    const iteration = halt.policyHaltIteration ?? 1;
    // Sequence at halt time — derived from history. Includes the
    // proposed call (which DID land in history as the synthetic
    // tool_result for protocol compliance, but the policy denied
    // execution). Filter it out so callers see only dispatched
    // calls, then append the proposed entry as a hint.
    const sequenceWithoutProposed = extractSequence(history.slice(0, -1), iteration);
    return {
      kind: 'policy-halt',
      halt: {
        reason: halt.policyHaltReason,
        ...(halt.policyHaltTellLLM !== undefined && { tellLLM: halt.policyHaltTellLLM }),
        sequence: [
          ...sequenceWithoutProposed,
          { name: halt.policyHaltTarget, args: halt.policyHaltArgs, iteration },
        ],
        iteration,
        history,
        proposed: { name: halt.policyHaltTarget, args: halt.policyHaltArgs ?? {} },
        ...(halt.policyHaltCheckerId !== undefined && { checkerId: halt.policyHaltCheckerId }),
      },
    };
  }
  // Message-boundary refusal (7.18+) — a `messageMiddleware` returned
  // `deny`; a refusal must never be mistaken for an answer: at 'input' no
  // model was asked, and at 'output' the middleware declined to release it.
  if (policy.messageMiddleware.length > 0 || policy.findingsOptions !== undefined) {
    const denied = state as Pick<
      AgentState,
      'messageDeniedReason' | 'messageDeniedPhase' | 'messageDeniedBy'
    >;
    if (denied.messageDeniedReason !== undefined) {
      return {
        kind: 'message-denied',
        denial: {
          reason: denied.messageDeniedReason,
          phase: denied.messageDeniedPhase ?? 'output',
          middleware: denied.messageDeniedBy ?? 'middleware',
        },
      };
    }
  }
  // Evidence rails (9.35.0) — the answer still states values no tool result
  // carried, after the one revision the posture allows. `'assist'` and
  // `'guard'` never end here: their verdict is committed state and an event.
  if (policy.evidenceGate?.posture === 'rails') {
    const verdict = (state as Pick<AgentState, 'unsupportedValues'>).unsupportedValues;
    if (verdict !== undefined && verdict.refused) {
      return {
        kind: 'unsupported-values',
        refusal: {
          values: verdict.values,
          candidates: verdict.candidates,
          revised: verdict.revised,
          message: evidenceRefusalSentence(verdict.values, 'rails', verdict.revised),
        },
      };
    }
  }
  return undefined;
}

/** Answer validation's verdict on a run that reached the end (7.24): blocked, or never committed. */
export function validationVerdictOf(
  state: Readonly<Record<string, unknown>>,
  config: ResolvedAnswerValidation | undefined,
): TerminalVerdict | undefined {
  if (config === undefined) return undefined;
  const s = state as Partial<AgentState>;
  if (s.answerValidationBlocked === true && s.answerValidation !== undefined) {
    return { kind: 'answer-validation', report: s.answerValidation };
  }
  if (
    s.answerValidation === undefined ||
    s.answerValidationCommitted !== true ||
    typeof s.finalContent !== 'string'
  ) {
    return {
      kind: 'answer-validation',
      report: {
        validatorId: config.id,
        validatorVersion: config.version,
        mode: config.mode,
        status: 'unverified',
        checked: 0,
        failed: 0,
        unreachable: 0,
        notApplicable: 0,
        checks: [],
        resolvedRefs: [],
        schemaAccepted: false,
        reason: 'delivery-incomplete',
      },
    };
  }
  return undefined;
}

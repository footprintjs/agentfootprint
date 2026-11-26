import { AnswerValidationError } from '../answer-validation/types.js';
import { isProviderInterventionError } from '../provider-contract/intervention.js';
import type { RunSettlement } from './protocolAdapter.js';

/**
 * How a rejected run settles: failed — naming a library refusal by its code
 * when the error's CLASS is one (never its words; a thrown value that only
 * claims the code is a failure like any other).
 */
export function failedSettlement(err: unknown): Extract<RunSettlement, { kind: 'failed' }> {
  if (isProviderInterventionError(err)) return { kind: 'failed', refusal: err.code };
  return err instanceof AnswerValidationError
    ? { kind: 'failed', refusal: 'ERR_ANSWER_VALIDATION' }
    : { kind: 'failed' };
}

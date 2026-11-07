import { CredentialConsentRequiredError } from '../../../identity/CredentialConsentRequiredError.js';
import { isRequestRefusal } from '../../../provider-contract/requestRefusal.js';
import { ReliabilityFailFastError } from '../../../reliability/types.js';
import { PolicyHaltError } from '../../../security/PolicyHaltError.js';
import { AnswerValidationError } from '../../../answer-validation/index.js';
import { UnsupportedValuesError } from '../evidence/errors.js';
import { CompactionUnmeasurableError } from '../window/errors.js';

/**
 * An error a crash checkpoint must not wrap: an intentional terminal signal,
 * which a caller catches by its typed shape, and which resuming could only
 * re-trigger.
 *
 *   • PauseSignal — an askHuman pause, not a failure.
 *   • PolicyHaltError — policy-driven termination; the synthetic tool_result is
 *     already in history.
 *   • ReliabilityFailFastError — thrown by finalizeResult AFTER the chart returns
 *     cleanly, so it never reaches the catch; listed for documentation.
 *   • CompactionUnmeasurableError — a provider that reports no usage will report
 *     none on resume either.
 *   • A request refusal — a forced-output capability refusal is terminal even
 *     after a correction turn: a checkpoint cannot repair this model contract.
 *   • CredentialConsentRequiredError — answered by a PERSON at the identity
 *     provider; wrapping it would bury `authorizationUrl` one `.cause` deep.
 *   • UnsupportedValuesError, AnswerValidationError — a VERDICT, not a crash: the
 *     loop spent its one revision, and the same model would meet the same evidence.
 *   • CheckerDeadError — a WIRING verdict on this build: resuming runs the same
 *     dead wiring.
 */
export function isTerminalRunError(cause: Error): boolean {
  return (
    cause.name === 'PauseSignal' ||
    cause instanceof PolicyHaltError ||
    cause instanceof ReliabilityFailFastError ||
    cause instanceof CompactionUnmeasurableError ||
    isRequestRefusal(cause) ||
    cause instanceof CredentialConsentRequiredError ||
    cause instanceof UnsupportedValuesError ||
    cause instanceof AnswerValidationError ||
    cause.name === 'CheckerDeadError'
  );
}

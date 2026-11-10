import { refusalVerdictOf, validationVerdictOf } from './verdicts.js';
import { type AgentRunValues } from '../../runValues.js';
import { type RunnerInvocation } from '../../../runnerExecution.js';
import { type RunnerPauseOutcome } from '../../../pause.js';
import { CredentialConsentRequiredError } from '../../../../identity/CredentialConsentRequiredError.js';
import { buildEventMeta } from '../../../../bridge/eventMeta.js';
import { terminalErrorOf } from '../../../terminalVerdict.js';
import type { AgentOutput } from '../../types.js';
import type { AgentContext } from '../contracts.js';

export function finalizeResult(
  this: Pick<AgentContext, 'configuration' | 'native' | 'runner'>,
  invocation: RunnerInvocation<AgentRunValues>,
  result: unknown,
): AgentOutput | RunnerPauseOutcome {
  const paused = this.native.detectPause(invocation, result);
  if (paused) return paused;
  const snap = invocation.view.snapshot();
  if (snap === undefined) throw new TypeError('The native execution has no ready snapshot');
  const state = snap.sharedState as Record<string, unknown>;
  const refusal = refusalVerdictOf(state, {
    reliabilityConfig: this.configuration.reliabilityConfig,
    messageMiddleware: this.configuration.messageMiddleware,
    findingsOptions: this.configuration.findingsOptions,
    evidenceGate: this.configuration.evidenceGate,
  });
  if (refusal !== undefined) {
    if (refusal.kind === 'message-denied' && refusal.denial.phase === 'output') {
      // The chart stopped cleanly, so ErrorBridge's onRunFailed cannot
      // close public streams. This API boundary owns the refusal on both
      // run and resume. Name it as a virtual stage, not a fabricated
      // engine failure, and never echo policy text into a public stream.
      this.native.dispatcher.dispatch({
        type: 'agentfootprint.error.fatal',
        payload: {
          error: 'The output policy withheld this answer.',
          stage: '__output_admission__',
          scope: 'run',
        },
        meta: buildEventMeta({ runtimeStageId: '__output_admission__' }, invocation.context()),
      });
    }
    // The verdict was decoded from the LIVE state above; the snapshot a
    // fail-fast error carries is the run's audit trail — "consumers persist
    // this" (`ReliabilityFailFastError.snapshot`) — so it is the SERVED one.
    throw terminalErrorOf(refusal, this.runner.getLastSnapshot());
  }
  // Credential-consent translation (8.6.0, `'tell-model'` only) — a tool
  // DECLARED a credential, the provider answered `authorization-required`,
  // and the model was told to route around it. The run reached the end
  // anyway, which means it is about to hand back an answer string for work a
  // tool never did.
  //
  // `AgentOutput` is a bare string, so there is nowhere to annotate "…and a
  // consent is still outstanding". An event alone would relocate the silent
  // success rather than remove it. So the turn raises, carrying the URL to
  // the caller — the party that can actually act on it. Under the default
  // `'pause'` this is unreachable for the first block (the run pauses and
  // `detectPause` returned above); it still fires if a RESUME found consent
  // ungranted and the model then finished the turn on its own.
  if (invocation.value.consentOutstanding.size > 0) {
    const [record] = [...invocation.value.consentOutstanding.values()];
    if (record) {
      invocation.value.consentOutstanding.clear();
      throw new CredentialConsentRequiredError(record);
    }
  }
  if (result instanceof Error) throw result;
  const invalid = validationVerdictOf(state, this.configuration.answerValidationConfig);
  if (invalid !== undefined) throw terminalErrorOf(invalid);
  if (this.configuration.answerValidationConfig !== undefined) return state.finalContent as string;
  if (typeof result === 'string') return result;
  throw new Error('Agent: unexpected result shape — expected final-answer string');
}

import type { buildCallStart } from './callStart.js';
import type { buildDispatchContext } from '../batch/dispatchContext.js';
import type { buildToolCredentialsOperations } from './credentialsOperations.js';
import type { CallCredentialInput } from '../contracts/invocationInputs.js';
import {
  type AuthorizationRequiredMode,
  consentQuestion,
  CONSENT_PAUSE_KEY,
  modelRefusal,
} from '../../../../../identity/consent.js';
import type { CallArguments, CallOutcome } from '../contracts/callCells.js';
import type { buildToolScriptsOperations } from '../evidence/scriptsOperations.js';
import type { InputsDispatch } from '../contracts/inputsDispatch.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import { errorClassOf } from '../decorators/reportingCredentials.js';
import type { DispatchCall } from '../contracts/batchCall.js';

type CallStartFacts = ReturnType<ReturnType<typeof buildCallStart>['beginDispatchCall']>;
type DispatchContext = ReturnType<
  ReturnType<typeof buildDispatchContext>['prepareDispatchContext']
>;

interface AdmitToolCredentialFrame {
  readonly emitSecurity: CallStartFacts['emitSecurity'];
  readonly need: NonNullable<NonNullable<CallStartFacts['tool']>['needs']>;
  readonly credentialsIn: ReturnType<typeof buildToolCredentialsOperations>['credentialsIn'];
  readonly runIdentity: DispatchContext['runIdentity'];
  readonly authorization: CallCredentialInput;
  readonly onAuthorizationRequired: AuthorizationRequiredMode;
  readonly oneQuestionAsked: boolean;
  readonly newHistory: DispatchContext['newHistory'];
  readonly tc: DispatchCall;
  readonly startMs: CallStartFacts['startMs'];
  readonly callArguments: CallArguments;
  readonly resolved: CallStartFacts['resolved'];
  readonly fileScript: ReturnType<typeof buildToolScriptsOperations>['fileScript'];
  readonly tool: CallStartFacts['tool'];
  readonly iteration: number;
  readonly proposedProgram: CallStartFacts['proposedProgram'];
  readonly programOfCall: ReturnType<typeof buildToolScriptsOperations>['programOfCall'];
  readonly outcome: CallOutcome;
  readonly askedLayer: InputsDispatch | undefined;
  readonly resolution: ReturnType<ReturnType<InputsDispatch['resolutionsFor']>['get']>;
}

/** Existing credentialAdmission body; original guard and native pause return stay with the handler. */
export async function admitToolCredential(
  scope: TypedScope<AgentState>,
  deps: Pick<ToolCallsHandlerDeps, 'clearConsentOutstanding' | 'reportConsentOutstanding'>,
  frame: AdmitToolCredentialFrame,
) {
  frame.emitSecurity('agentfootprint.credential.requested', {
    service: frame.need.credential,
    ...(frame.need.mode && { mode: frame.need.mode }),
  });
  try {
    const cred = await frame.credentialsIn(scope, frame.need.credential).getCredential({
      service: frame.need.credential,
      ...(frame.need.scopes && { scopes: frame.need.scopes }),
      ...(frame.need.mode && { mode: frame.need.mode }),
      ...(frame.runIdentity && {
        identity: {
          ...(frame.runIdentity.principal && { principal: frame.runIdentity.principal }),
          ...(frame.runIdentity.tenant && { tenant: frame.runIdentity.tenant }),
        },
      }),
    });
    if (cred.status === 'issued') {
      frame.authorization.resolvedCredential = cred.credential;
      frame.emitSecurity('agentfootprint.credential.acquired', {
        service: frame.need.credential,
        kind: cred.credential.kind,
        ...(cred.expiresAt !== undefined && { expiresAt: cred.expiresAt }),
      });
      deps.clearConsentOutstanding?.(frame.need.credential);
    } else {
      frame.authorization.credentialBlocked = true;
      // The event has ALWAYS carried `{ service, sessionId }` and
      // never the URL (6.11.0's contract). That was right; what was
      // wrong was the tool-result string below, which carried the URL
      // to the one party that cannot click it and to every channel
      // built to preserve tool output.
      frame.emitSecurity('agentfootprint.credential.authorization_required', {
        service: frame.need.credential,
        sessionId: cred.sessionId,
      });
      // In a batch whose one human question was the inputs layer's
      // ask, there is no second pause to give: the model is told, as
      // under `'tell-model'` (`oneQuestionAsked`).
      if (frame.onAuthorizationRequired === 'pause' && !frame.oneQuestionAsked) {
        // Consent is unfinished work, and unfinished work is a pause
        // — the same wire the check-in gate and a middleware `ask`
        // ride. Commit partial state so resume() finds history
        // intact; the proposed args ride the checkpoint so the tool
        // can run once the person has consented.
        scope.history = frame.newHistory;
        scope.pausedToolCallId = frame.tc.id;
        scope.pausedToolName = frame.tc.name;
        scope.pausedToolStartMs = frame.startMs;
        scope.pausedCredential = true;
        scope.pausedCredentialArgs = frame.callArguments.callArgs;
        scope.pausedCredentialService = frame.need.credential;
        // Same carrier as the middleware-ask pause (9.92.0).
        if (frame.resolved.party !== undefined) scope.pausedToolParty = frame.resolved.party;
        // Open until the person consents: `submitted`, without the text.
        frame.fileScript(scope, {
          tool: frame.tool,
          toolName: frame.tc.name,
          toolCallId: frame.tc.id,
          iteration: frame.iteration,
          proposed: frame.proposedProgram,
          submitted: frame.programOfCall(frame.tool, frame.callArguments.callArgs),
          settlement: 'not-entered',
          paused: true,
        });
        // A defined return value triggers the footprintjs pause; this
        // object becomes the checkpoint's pauseData, and standingAgent's
        // describePause hands it to the caller as `PendingAsk`.
        // `CONSENT_PAUSE_KEY` is what lets `pause.request` withhold
        // the URL from the event stream by name.
        return {
          toolCallId: frame.tc.id,
          toolName: frame.tc.name,
          question: consentQuestion(frame.need.credential, frame.tc.name),
          [CONSENT_PAUSE_KEY]: {
            service: frame.need.credential,
            authorizationUrl: cred.authorizationUrl,
            sessionId: cred.sessionId,
          },
        };
      }
      // `'tell-model'`: the model reads a refusal naming the service
      // and never the URL, and may route around the block. The turn
      // cannot report a clean completion — the record goes out on the
      // side channel and `Agent.finalizeResult` raises.
      frame.outcome.error = true;
      frame.outcome.result = modelRefusal(frame.need.credential);
      // Under `'pause'`, reached only in the batch that asked: the
      // person's answers the call carried are kept, so a call the
      // model proposes again runs with them and pauses for consent
      // in a batch that asked nothing (its sentence stays the
      // credential's own — the service is the subject).
      if (frame.onAuthorizationRequired === 'pause') {
        frame.askedLayer?.keepAnswers(scope, frame.tc.name, frame.resolution);
      }
      deps.reportConsentOutstanding?.({
        service: frame.need.credential,
        authorizationUrl: cred.authorizationUrl,
        sessionId: cred.sessionId,
        tool: frame.tc.name,
        iteration: frame.iteration,
      });
    }
  } catch (credErr) {
    frame.authorization.credentialBlocked = true;
    frame.outcome.error = true;
    const reason = credErr instanceof Error ? credErr.message : String(credErr);
    frame.emitSecurity('agentfootprint.credential.failed', {
      service: frame.need.credential,
      reason,
      tool: frame.tc.name,
      ...(errorClassOf(credErr) !== undefined && { errorClass: errorClassOf(credErr) }),
    });
    frame.outcome.result = `credential error for '${frame.need.credential}': ${reason}`;
  }
  return undefined;
}

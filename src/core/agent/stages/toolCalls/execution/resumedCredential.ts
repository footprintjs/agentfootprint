import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { Tool } from '../../../../../tools/tools.js';
import type { Credential } from '../../../../../identity/types.js';
import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import type { ToolCredentialsOperations } from '../contracts/operations/credentials.js';
import type { ToolSecurityEmitter } from '../../../toolSecurityEvents.js';
import { modelRefusal } from '../../../../../identity/consent.js';
import { errorClassOf } from '../decorators/reportingCredentials.js';

/** Reacquire declared credentials after the resumed call passes today's gates. */
export async function resumedCredential(
  scope: TypedScope<AgentState>,
  deps: Pick<ToolCallsHandlerDeps, 'clearConsentOutstanding' | 'reportConsentOutstanding'>,
  credentialsIn: ToolCredentialsOperations['credentialsIn'],
  tool: Tool,
  toolName: string,
  iteration: number,
  emitSecurity: ToolSecurityEmitter,
): Promise<{ ok: true; credential?: Credential } | { ok: false; result: string }> {
  const runIdentity = scope.runIdentity as
    | { tenant?: string; principal?: string; conversationId: string }
    | undefined;
  let resolvedCredential: Credential | undefined;
  const need = tool.needs;
  if (need) {
    emitSecurity('agentfootprint.credential.requested', {
      service: need.credential,
      ...(need.mode && { mode: need.mode }),
    });
    try {
      const cred = await credentialsIn(scope, need.credential).getCredential({
        service: need.credential,
        ...(need.scopes && { scopes: need.scopes }),
        ...(need.mode && { mode: need.mode }),
        ...(runIdentity && {
          identity: {
            ...(runIdentity.principal && { principal: runIdentity.principal }),
            ...(runIdentity.tenant && { tenant: runIdentity.tenant }),
          },
        }),
      });
      if (cred.status === 'issued') {
        resolvedCredential = cred.credential;
        emitSecurity('agentfootprint.credential.acquired', {
          service: need.credential,
          kind: cred.credential.kind,
          ...(cred.expiresAt !== undefined && { expiresAt: cred.expiresAt }),
        });
        // The consent that was outstanding for this service has been given.
        deps.clearConsentOutstanding?.(need.credential);
      } else {
        emitSecurity('agentfootprint.credential.authorization_required', {
          service: need.credential,
          sessionId: cred.sessionId,
        });
        // Still not authorized on the far side of a resume. A resume cannot
        // pause again (`ResumeFn` returns void), so the honest move is the
        // URL-free refusal plus `error: true`: the model reads it, the loop
        // continues, and if it calls the tool again `execute` CAN pause — a
        // fresh consent round with a fresh URL on `PendingAsk`. The
        // consent record still goes out on the side channel so the turn
        // cannot end quietly.
        deps.reportConsentOutstanding?.({
          service: need.credential,
          authorizationUrl: cred.authorizationUrl,
          sessionId: cred.sessionId,
          tool: toolName,
          iteration,
        });
        return { ok: false, result: modelRefusal(need.credential) };
      }
    } catch (credErr) {
      const reason = credErr instanceof Error ? credErr.message : String(credErr);
      emitSecurity('agentfootprint.credential.failed', {
        service: need.credential,
        reason,
        tool: toolName,
        ...(errorClassOf(credErr) !== undefined && { errorClass: errorClassOf(credErr) }),
      });
      return { ok: false, result: `credential error for '${need.credential}': ${reason}` };
    }
  }
  return { ok: true, credential: resolvedCredential };
}

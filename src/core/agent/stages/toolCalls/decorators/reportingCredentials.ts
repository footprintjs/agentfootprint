import type { CredentialProvider } from '../../../../../identity/types.js';
import type { ToolSecurityEmitter } from '../../../toolSecurityEvents.js';

/**
 * The constructor name of what was thrown, when what was thrown was an Error.
 *
 * Reported on `agentfootprint.credential.failed` so an alert can route on the
 * CLASS of failure rather than parse a message. `undefined` for a thrown
 * non-Error, because "Object" would be a fact about JavaScript rather than
 * about the failure.
 */
export function errorClassOf(err: unknown): string | undefined {
  return err instanceof Error ? err.constructor?.name ?? err.name : undefined;
}

/**
 * Wrap the credential provider handed to a tool as `ctx.credentials`, so a
 * failure inside the tool's OWN `getCredential(...)` call is as visible as one
 * on the declared-`needs` path.
 *
 * Why this exists (9.4.0). `needs` resolution has emitted
 * `agentfootprint.credential.failed` since 6.11.0. The pull path — a tool that
 * asks for its own credential mid-execute — emitted nothing: the throw was
 * caught by the generic tool catch and became `tool_end` with `error: true`,
 * one indistinguishable failure among all the other ways a tool can fail. An
 * operator watching the credential domain saw a healthy silence while every
 * call was failing to authenticate, which is the exact shape of the AWS
 * identity-adapter bug this release fixes.
 *
 * It is a decorator, not a replacement: the same `id`, the same result, the
 * same throw. It only makes a noise on the way past.
 */
export function reportingCredentials(
  provider: CredentialProvider,
  emitSecurity: ToolSecurityEmitter,
  toolName: string,
): CredentialProvider {
  return {
    id: provider.id,
    async getCredential(req) {
      try {
        return await provider.getCredential(req);
      } catch (err) {
        emitSecurity('agentfootprint.credential.failed', {
          service: req.service,
          reason: err instanceof Error ? err.message : String(err),
          tool: toolName,
          ...(errorClassOf(err) !== undefined && { errorClass: errorClassOf(err) }),
        });
        throw err;
      }
    },
  };
}

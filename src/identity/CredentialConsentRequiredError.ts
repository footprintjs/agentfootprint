/**
 * CredentialConsentRequiredError — typed error thrown by `Agent.run()` under
 * `onAuthorizationRequired: 'tell-model'` when a turn finished while a tool's
 * DECLARED credential was never obtained.
 *
 * Pattern: Typed Error (parallel to `PolicyHaltError` / `MessageDeniedError`).
 * Role:    The honesty terminal for the non-pausing mode. `'tell-model'` lets
 *          the model adapt in-loop after a consent block — but a turn that
 *          returned a plain answer string would be claiming a completion it
 *          did not earn, because the tool never ran. `AgentOutput` is a bare
 *          string with nowhere to hang "…and a consent is still outstanding",
 *          so the fact is surfaced as an error instead of being dropped.
 * Emits:   N/A (this file DEFINES the class; `agentfootprint.credential.
 *          authorization_required` fires from the toolCalls handler at the
 *          moment the block resolves, and carries `{ service, sessionId }`
 *          only — never the URL).
 *
 * **The `authorizationUrl` on this error is a bearer capability.** It carries a
 * session-correlating `state` parameter: whoever holds the URL can complete the
 * consent flow. It reaches the caller HERE and on `PendingAsk` under
 * `'pause'` — and deliberately nowhere else. It is never written to the
 * conversation, the snapshot, the narrative, the typed event stream, or a
 * recording. Treat it like the token it stands in for: hand it to the person
 * who must click it, and do not log it.
 *
 * Under the default `onAuthorizationRequired: 'pause'` this error never fires —
 * the run pauses at the block instead and the same three fields ride
 * `PendingAsk`.
 *
 * @example
 *   try {
 *     await agent.run({ message: 'pay invoice INV-42' });
 *   } catch (e) {
 *     if (e instanceof CredentialConsentRequiredError) {
 *       // Show the URL to the PERSON. Never log it.
 *       await notifyUser(e.service, e.authorizationUrl);
 *     } else {
 *       throw e;
 *     }
 *   }
 */

export interface CredentialConsentRequiredContext {
  /** Downstream service id the tool declared, e.g. 'github', 'billing'. */
  readonly service: string;
  /** The 3LO consent URL. A BEARER CAPABILITY — see the class note. */
  readonly authorizationUrl: string;
  /** Correlates the authorization session with the provider. */
  readonly sessionId: string;
  /** The tool whose declared credential was refused. */
  readonly tool: string;
  /** ReAct iteration the block fired on. */
  readonly iteration: number;
}

export class CredentialConsentRequiredError extends Error {
  readonly code = 'ERR_CREDENTIAL_CONSENT_REQUIRED' as const;
  readonly service: string;
  /** The 3LO consent URL. A BEARER CAPABILITY — see the class note. */
  readonly authorizationUrl: string;
  readonly sessionId: string;
  readonly tool: string;
  readonly iteration: number;

  constructor(ctx: CredentialConsentRequiredContext) {
    // The MESSAGE deliberately omits the URL. An error message is the one
    // string that reliably reaches a log line, and this class exists to keep
    // a capability out of logs.
    super(
      `Authorization required for '${ctx.service}' (tool='${ctx.tool}', ` +
        `iteration=${ctx.iteration}). The tool did not run. Read ` +
        `\`error.authorizationUrl\` to send the person to consent.`,
    );
    this.name = 'CredentialConsentRequiredError';
    this.service = ctx.service;
    this.authorizationUrl = ctx.authorizationUrl;
    this.sessionId = ctx.sessionId;
    this.tool = ctx.tool;
    this.iteration = ctx.iteration;
  }
}

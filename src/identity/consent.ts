/**
 * The 3LO consent vocabulary — one place, because four surfaces must agree on
 * it and three of them are security boundaries.
 *
 * A `CredentialProvider` that answers `authorization-required` is saying: a
 * PERSON has to click a link before this tool can run. Two things follow, and
 * they are the whole of this module.
 *
 * **1. The URL is a bearer capability, not a message.** It carries a
 * session-correlating `state` parameter; whoever holds it can complete the
 * consent flow. It goes to the CALLER — on `PendingAsk` under `'pause'`, on
 * `CredentialConsentRequiredError` under `'tell-model'` — and to nowhere else.
 * Before 8.6.0 it was interpolated into the tool-result string, which put it in
 * the conversation and therefore in every channel built to preserve tool output
 * (history, `stream.tool_end`, `agent.iteration_end`, `context.injected`, the
 * commit log, the snapshot, the narrative's `rawValue`, and any recording).
 * `modelRefusal()` is the URL-free replacement, and it is why the interpolation
 * has no remaining call site.
 *
 * **2. The model is the one party that cannot act on it.** So what the model
 * reads names the service, says a person is handling it, and tells it what to
 * do instead — the same shape as the `[permission denied: …]` refusal it
 * already knows how to read.
 */

/**
 * What a run does when a tool's declared credential needs consent.
 *
 * - `'pause'` (default) — the run stops at the block. `agent.run()` returns a
 *   pause outcome, a host answers 202 with `{ awaiting }`, and
 *   `agent.resume(checkpoint)` re-resolves the credential and runs the tool
 *   that was waiting. The model is never told; nothing is fabricated.
 * - `'tell-model'` — the model reads {@link modelRefusal} and may route around
 *   the block. The turn still cannot report a clean completion: it raises
 *   `CredentialConsentRequiredError`.
 */
export type AuthorizationRequiredMode = 'pause' | 'tell-model';

/**
 * The key under which a consent request rides `pauseData` (and therefore
 * `PendingAsk.pauseData`). Named, rather than free-form, for one reason:
 * `agentfootprint.pause.request` mirrors the WHOLE `pauseData` into its
 * `questionPayload`, so the emitter has to be able to find this block and
 * withhold the URL from the event stream. A free-form shape could not be
 * bounded by name, and the URL would have leaked into every observer again.
 *
 * @see redactConsentUrlForEvent
 */
export const CONSENT_PAUSE_KEY = 'authorization';

/** The consent block handed to the CALLER on `pauseData` / `PendingAsk`. */
export interface ConsentRequest {
  readonly service: string;
  /** BEARER CAPABILITY. Show it to the person; never log it. */
  readonly authorizationUrl: string;
  readonly sessionId: string;
}

/** Placeholder written where the consent URL is deliberately withheld. */
export const CONSENT_URL_WITHHELD = '[withheld: consent URL is caller-only]';

/**
 * What the MODEL reads when a declared credential needs consent. Never the URL.
 *
 * Bracketed like the permission-gate refusal, because it is the same kind of
 * fact: the call did not happen and the model must adapt. It names the service
 * (so the model can reason about what is unavailable), says a person is on it
 * (so it does not invent a way to authorize itself), and offers the two honest
 * continuations.
 */
export function modelRefusal(service: string): string {
  return (
    `[authorization required: '${service}' — a person must consent before this ` +
    `tool can run. The caller has been told; you cannot do it yourself. ` +
    `Continue with work that does not need '${service}', or say plainly that ` +
    `you could not finish this step.]`
  );
}

/** The plain-words question a host shows the person, via `PendingAsk.question`. */
export function consentQuestion(service: string, tool: string): string {
  return `Authorize access to '${service}' so '${tool}' can run.`;
}

/**
 * Strip the consent URL out of a `pause.request` payload.
 *
 * `RunnerBase.emitPauseRequest` copies the whole `pauseData` into
 * `PauseRequestPayload.questionPayload`, which is right for a check-in's
 * evidence pack and wrong for a bearer URL. This withholds exactly one field by
 * name and leaves every other pause shape untouched — the same discipline the
 * audit adapter's `BOUND_FIELDS` already applies to `tool_end.result`.
 *
 * Returns the input unchanged (same reference) when there is no consent block,
 * so no existing pause pays for this.
 */
export function redactConsentUrlForEvent(
  payload: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const block = payload[CONSENT_PAUSE_KEY];
  if (
    typeof block !== 'object' ||
    block === null ||
    !('authorizationUrl' in block) ||
    typeof (block as { authorizationUrl: unknown }).authorizationUrl !== 'string'
  ) {
    return payload;
  }
  return {
    ...payload,
    [CONSENT_PAUSE_KEY]: {
      ...(block as Record<string, unknown>),
      authorizationUrl: CONSENT_URL_WITHHELD,
    },
  };
}

import type { PermissionCapability, ToolCallEventIdentity } from './dependencyTypes.js';

// permission.* (4)
export interface PermissionCheckPayload extends Partial<ToolCallEventIdentity> {
  /** 9.11.0 — the shared vocabulary, so the event cannot drift from the
   *  request. `'skill_read'` joined it when skill activation became something
   *  a policy can refuse. */
  readonly capability: PermissionCapability;
  readonly actor: string;
  readonly target?: string;
  readonly result: 'allow' | 'deny' | 'halt' | 'gate_open';
  readonly policyEngine?: 'opa' | 'cerbos' | 'custom';
  readonly policyRuleId?: string;
  readonly rationale?: string;
  /** v2.12 — telemetry tag carried through from PermissionDecision.reason. */
  readonly reason?: string;
}

export interface PermissionGateOpenedPayload {
  readonly gateId: string;
  readonly openedBy: string;
  readonly expiresAt?: number;
}

// ─── credential (declare-and-push; NEVER carries the secret) ──────────
/** A tool's declared credential is being resolved before invocation. */
export interface CredentialRequestedPayload extends Partial<ToolCallEventIdentity> {
  readonly service: string;
  readonly mode?: 'machine' | 'user';
}
/** A credential was issued. Carries the `kind` only — NEVER the token/secret. */
export interface CredentialAcquiredPayload extends Partial<ToolCallEventIdentity> {
  readonly service: string;
  readonly kind: string;
  readonly expiresAt?: number;
}
/** 3-legged consent is required (the tool is not run until the user authorizes).
 *  Carries `sessionId` for correlation, NOT the authorization URL. */
export interface CredentialAuthorizationRequiredPayload extends Partial<ToolCallEventIdentity> {
  readonly service: string;
  readonly sessionId: string;
}
/**
 * Credential resolution failed — the provider threw, so the tool is not run
 * (fail-closed: never half-authed).
 *
 * **Never carries the credential, the token, or the authorization URL.** See
 * the security contract on `CredentialProvider`: `reason` is the provider's own
 * thrown message, so a provider must scrub secrets before throwing.
 *
 * `tool` and `errorClass` were added in 9.4.0, for the operator watching a
 * dashboard rather than reading a transcript. Without the tool name this event
 * says a service failed but not what stopped working; without the class every
 * distinct failure is one undifferentiated string. Both are optional because
 * neither is always knowable: `tool` is absent when the resolution was not made
 * on a tool's behalf, and `errorClass` is absent when what was thrown was not
 * an `Error`.
 */
export interface CredentialFailedPayload extends Partial<ToolCallEventIdentity> {
  /** The service id the tool declared (or asked for), never the credential. */
  readonly service: string;
  /** The provider's thrown message. */
  readonly reason: string;
  /** The tool whose call needed it — the thing that actually stopped working. */
  readonly tool?: string;
  /** Constructor name of what was thrown (e.g. `'TypeError'`, `'TimeoutError'`)
   *  — the routable half of the failure, so alerts do not have to parse prose. */
  readonly errorClass?: string;
}

export interface PermissionGateClosedPayload {
  readonly gateId: string;
  readonly reason: string;
}

/**
 * Emitted (v2.12) when a `PermissionChecker.check()` returns
 * `{ result: 'halt', ... }`. Pairs with the typed `PolicyHaltError`
 * thrown by `Agent.run()` — the event is the OBSERVABILITY signal,
 * the error is the RUNTIME signal. Both carry the same `reason` for
 * routing (e.g. `'security:exfiltration'` → PagerDuty).
 *
 * Fires AFTER the synthetic tool_result has been written to scope.history
 * but BEFORE the run terminates, so observability adapters see the
 * halt while the conversation history is consistent for downstream
 * audit/replay.
 */
export interface PermissionHaltPayload extends Partial<ToolCallEventIdentity> {
  readonly checkerId?: string;
  readonly target: string;
  readonly reason: string;
  readonly tellLLM?: string;
  readonly iteration: number;
  readonly sequenceLength: number;
}

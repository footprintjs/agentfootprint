/**
 * refusalStatus — the HTTP status every hosting refusal answers with, by its
 * code. ONE table, read by every door that speaks HTTP (`httpHost` and the
 * adapters built on it, `streamHandler`), so the same refusal never answers
 * with two statuses at two doors.
 */

/**
 * Status codes mapped by refusal code. Anything else is a 500.
 *
 * Not one of them is a 5xx: none of them is the agent breaking. A closed host is
 * shutting down (503); four are conflicts with the state the session is already
 * in (409) — a run already going, a question already outstanding, a decision
 * with nothing to decide, a pause this reply cannot describe. A 500 would tell
 * every dashboard that ever sees it something untrue.
 *
 * `ERR_DECISION_REQUIRED` is the one 400 (8.13.0): the session is in a perfectly
 * consistent state and it is the REQUEST that is wrong — it answered a consent
 * gate with a value instead of a decision. Nothing ran and the pause is still
 * there, so the same caller can send the right shape and continue.
 *
 * `ERR_RESUME_DECISION` is a 409: a decision that does not answer the request
 * this session is paused on — a duplicate that arrived after the first one
 * resumed the run and it paused again, a decision already used, one for a call
 * the stored pause no longer holds. The decision conflicts with the session's
 * state; nothing ran, and the pending ask (if any) is still there to answer.
 *
 * The artifact rows (9.23.0) follow the same reading. The two 400s are
 * requests the same caller can fix (a malformed wire op; an op with no
 * session). `ERR_ARTIFACT_NOT_FOUND` is 404 — the honest HTTP word for "no
 * data at this name", and deliberately ONE status for missing, expired and
 * another-session's alike, so the wire teaches a caller nothing about scopes
 * it does not own. The two 501s are deployments that cannot do this at all —
 * an agent without a store, a wire without the body shape — which no retry
 * and no different request will change.
 */
export const REFUSAL_STATUS: Readonly<Record<string, number>> = Object.freeze({
  ERR_HOST_CLOSED: 503,
  ERR_CONCURRENT_RUN: 409,
  ERR_PAUSE_NOT_CARRIED: 409,
  ERR_AWAITING_DECISION: 409,
  ERR_NO_PENDING_ASK: 409,
  ERR_DECISION_REQUIRED: 400,
  ERR_RESUME_DECISION: 409,
  ERR_INPUT_REQUEST_INVALID: 400,
  ERR_INVALID_WIRE_OP: 400,
  ERR_ARTIFACT_SESSION_REQUIRED: 400,
  ERR_ARTIFACT_NOT_FOUND: 404,
  ERR_NO_ARTIFACT_STORE: 501,
  ERR_ARTIFACT_NOT_CARRIED: 501,
  // explain-answer — a recording over the host's `answerAccounts` ceiling. 413:
  // the request is fine and the record exists; it is too large to explain HERE.
  ERR_RECORDING_TOO_LARGE_FOR_ACCOUNT: 413,
  // One session over its in-flight artifact-op bound — back off and retry.
  ERR_ARTIFACT_OPS_BUSY: 429,
  // 9.26.0 — the badge, the bouncer and the history desk.
  //   401: this caller was not identified (a token that did not verify, or one
  //        that was never presented at a door that insists).
  //   503: the VERIFIER could not answer — an outage on this side, and telling
  //        every client to re-authenticate against an unreachable provider is
  //        the wrong instruction at the worst moment.
  //   429: admission said no. The one status a client is expected to back off
  //        on, which is exactly what a spend bound wants it to do.
  //   404: a transcript this caller may not have — one answer for missing,
  //        foreign and owner-less alike.
  //   501: the door was never given what the op needs (no verifier, no owner
  //        index, no wire body shape) — a gap in THIS deployment, not a bad
  //        request the caller could fix by sending something else.
  ERR_IDENTITY_NOT_VERIFIED: 401,
  ERR_IDENTITY_VERIFIER_UNAVAILABLE: 503,
  ERR_ADMISSION_REFUSED: 429,
  ERR_SESSION_NOT_FOUND: 404,
  ERR_SESSION_OP_NEEDS_IDENTITY: 501,
  ERR_SESSION_INDEX_UNAVAILABLE: 501,
  ERR_SESSIONS_NOT_CARRIED: 501,
  ERR_REQUEST_TOO_LARGE: 413,
  // The door guard — each refusal also carries its own `status`, which is what
  // this host answers with; listed here too so a handler that fails a reply
  // with one of them gets the same status and never a 500.
  //   415: a request that changes something did not say it was JSON.
  //   403: a browser page from an origin this door does not allow.
  //   421: a Host this door was not configured to answer for (RFC 9110 §15.5.20).
  //   400: a session id over the ceiling or with a control character in it.
  ERR_UNSUPPORTED_MEDIA_TYPE: 415,
  ERR_ORIGIN_NOT_ALLOWED: 403,
  ERR_HOST_NOT_ALLOWED: 421,
  ERR_INVALID_SESSION_ID: 400,
  // The app's `sealRequest` could not seal the credential the request carries
  // (a header missing or unreadable) — the request is what is wrong, and the
  // same caller can send it again with the credential.
  ERR_REQUEST_NOT_SEALED: 400,
});

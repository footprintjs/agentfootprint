/**
 * hosting/ingressRecord — what the door decided, for the requests that never
 * became a run.
 *
 *   await standingAgent({
 *     agent, sessions, host,
 *     identity: { verify },
 *     admission: turnsPerHour({ limit: 60 }),
 *     onIngressDecision: (record) => myAuditSink.write(record),
 *   });
 *
 * ── The gap this closes, named exactly ───────────────────────────────────────
 * `auditExport()` is a record of RUNS. A 401 out of `identity.verify` and a 429
 * out of `admission.decide` both happen before a run exists — no agent has been
 * built, no observer is attached, no typed event is emitted — so neither is in
 * the bundle. Two independent review rounds wrote that down as the same finding,
 * and the honest consequence is the sharp one: **an empty bundle is not evidence
 * that nobody was turned away.** It is evidence that nobody ran.
 *
 * This is the seam where the turned-away go. One record per request the composer
 * decided, handed to a sink you own, at the moment the reply reaches its
 * terminal.
 *
 * ── What it is NOT, said before anything else ────────────────────────────────
 * **It does not join the audit hash chain.** Nothing here is hashed, chained,
 * sequenced against `auditExport()`'s records, or verifiable by
 * `verifyAuditBundle`. It is a STREAM you chain into your own sink. Saying
 * otherwise would make this fix the exact failure it exists to close — a
 * mechanism that looks like evidence and is not. If you need ingress decisions
 * inside a tamper-evident chain, write them into the same store your audit
 * bundle lands in and chain them there, where the sequence is yours to define.
 *
 * ── Secrets never travel ─────────────────────────────────────────────────────
 * A record carries the CLASS of what happened and the identifiers the caller
 * already knew. Never the bearer token, never a header, never a claim set,
 * never an error's message — the `sdkFailure` law, applied to the front door.
 * `errorName` and `errorCode` are this package's own vocabulary; a message may
 * carry an SDK's text, an operator's sentence or a store's detail, so no message
 * is copied. The one identity field is `userId`, and it is the id the token
 * PROVED — never one a request merely claimed.
 *
 * ── What the composer can decide, and what it never sees ─────────────────────
 * Every ingress exit of `standingAgent` funnels through one reply terminal, so
 * all of these land here — including the ones a consumer's own `verify` and
 * `decide` never observe:
 *
 *   - a request with no `Authorization: Bearer …` at all (`verify` is never
 *     called, so nothing you wrote could have logged it);
 *   - a verifier that could not answer (503) as distinct from a bad credential;
 *   - an admission refusal, and also an admission ALLOW — the census is what
 *     makes an absence readable;
 *   - a turn or a transcript naming somebody else's session (the 404 that is
 *     deliberately indistinguishable from "no such session");
 *   - a session op at a door with no verifier, a store with no owner index, a
 *     concurrent-run refusal, an artifact ref that did not resolve;
 *   - and a request that was SERVED.
 *
 * What it does not carry, stated rather than implied: a body the TRANSPORT
 * refused before the composer ever saw it — unparseable JSON, or an `op` this
 * host's wire grammar does not speak (`InvalidWireOpError`, answered 400 by
 * `httpHost` inside its own request reader). That is a malformed request rather
 * than a decision about a caller, and the composer does not claim it. Your HTTP
 * access log has it.
 *
 * Pattern: Observer at a composition boundary. Zero-cost when unset — with no
 * sink configured nothing is built, nothing is wrapped, and the reply object the
 * handler uses is the host's own, to the byte.
 */

import { bearerToken, type VerifiedIdentity } from './identityVerification.js';
import {
  AdmissionRefusedError,
  IdentityNotVerifiedError,
  SessionNotFoundError,
  VerifierUnavailableError,
  type IdentityFailureClass,
} from './errors.js';
import { ARTIFACT_GET_OP, ARTIFACT_HEAD_OP } from './artifactWire.js';
import { SESSION_LIST_OP, SESSION_TRANSCRIPT_OP } from './sessionWire.js';
import type { HostReply, HostRequest } from './types.js';

/** Which of the composer's three doors this request knocked at. */
export type IngressDoor = 'turn' | 'session-op' | 'artifact';

/**
 * How the door answered — coarse on purpose, because this is the field a
 * dashboard groups by. `errorCode` carries the precision beside it.
 *
 *  - `'served'` — the reply reached a DELIVERING terminal: an answer, a
 *    question a person must answer, a transcript, a listing, an artifact.
 *
 *    Read it as **delivered**, not as *admitted*. The record is filed at the
 *    terminal the reply actually reached, and a failure is not a delivery — so
 *    a request the door admitted whose RUN, store or provider then broke ends
 *    at `reply.fail` and is filed `'failed'` (or `'refused'`, when the error
 *    names itself with an `ERR_…` code), carrying that error's class. It is
 *    NOT `'served'`. To count what the door let through, count everything that
 *    is not one of the door's own refusals — `'identity-refused'`,
 *    `'verifier-unavailable'`, `'admission-refused'`, `'session-refused'` — or
 *    read `admission`, which is the verdict a policy actually returned and is
 *    present on a refused record and a broken one alike.
 *  - `'identity-refused'` — 401. The credential did not identify anybody, or
 *    none arrived at a door that insists.
 *  - `'verifier-unavailable'` — 503. The verifier could not do its job; the
 *    caller's token was never judged and this is not their fault.
 *  - `'admission-refused'` — 429. A policy said no before any work started.
 *  - `'session-refused'` — the one indistinguishable not-found: a session that
 *    does not exist, belongs to somebody else, or names no owner.
 *  - `'refused'` — every other refusal the door made by name (a session op with
 *    no verifier configured, a store with no owner index, a concurrent run, an
 *    artifact ref that did not resolve, a pause the wire could not carry).
 *  - `'failed'` — the request ended in an error that is not one of the door's
 *    own refusals. Usually the run, the store or the provider — which is why
 *    an admitted request that then broke lands HERE and not in `'served'`.
 */
export type IngressOutcome =
  | 'served'
  | 'identity-refused'
  | 'verifier-unavailable'
  | 'admission-refused'
  | 'session-refused'
  | 'refused'
  | 'failed';

/** What an admission policy answered, when one was consulted. */
export type IngressAdmissionVerdict = 'allow' | 'queue' | 'refuse';

/**
 * One decision the door made, as plain data.
 *
 * Every field is either a class of what happened or an identifier the caller
 * already had. Nothing here is a secret, and nothing here is a message.
 */
export interface IngressRecord {
  /** When the request left the door, `Date.now()`. */
  readonly at: number;
  /** Which door it knocked at. */
  readonly door: IngressDoor;
  /** The wire op it named, in the spelling a body uses. Absent for a turn. */
  readonly op?: string;
  /** How the door answered. */
  readonly outcome: IngressOutcome;
  /** The refusal's own `code` (`'ERR_IDENTITY_NOT_VERIFIED'`, …). Never a message. */
  readonly errorCode?: string;
  /** The error's class name, for a failure this package did not author. */
  readonly errorName?: string;
  /** WHICH token check failed — the whole vocabulary a refusal may say about a
   *  credential, and never one character of the credential. */
  readonly identityFailure?: IdentityFailureClass;
  /** `true` when the refused request also NAMED a user it could not prove —
   *  the impersonation shape, kept separate so a sink can count it. */
  readonly claimedUser?: boolean;
  /** The id the token PROVED, when one was proven. Never a claimed one. */
  readonly userId?: string;
  /** The conversation this request named, when it named one. */
  readonly sessionId?: string;
  /** Whether a bearer credential was PRESENT. Never its value. */
  readonly bearerPresent: boolean;
  /** What the admission policy answered, when one was consulted. */
  readonly admission?: IngressAdmissionVerdict;
}

/**
 * Where records go — {@link StandingAgentBaseOptions.onIngressDecision}.
 *
 * Called once per request, synchronously, at the moment the reply reaches its
 * terminal. A sink that throws is contained (a broken log must not turn a served
 * request into a failed one) and reported once on `console.warn`, because a
 * silently-dropped security record is the failure this whole seam exists to
 * close. Do the slow part yourself: buffer, batch, and never `await` the network
 * inside it.
 */
export type IngressSink = (record: IngressRecord) => void;

/**
 * Classify one refusal into the record's vocabulary.
 *
 * The order is deliberate: the classes this package authored are matched by
 * `instanceof` first, so a door refusal never reads as a generic failure, and
 * anything else keeps only its class NAME. No message is read, from any error,
 * ever.
 */
function classify(err: unknown): {
  outcome: IngressOutcome;
  errorCode?: string;
  errorName?: string;
  identityFailure?: IdentityFailureClass;
  claimedUser?: boolean;
} {
  if (err instanceof IdentityNotVerifiedError) {
    return {
      outcome: 'identity-refused',
      errorCode: err.code,
      errorName: err.name,
      identityFailure: err.failure,
      claimedUser: err.claimedUser,
    };
  }
  if (err instanceof VerifierUnavailableError) {
    return { outcome: 'verifier-unavailable', errorCode: err.code, errorName: err.name };
  }
  if (err instanceof AdmissionRefusedError) {
    return { outcome: 'admission-refused', errorCode: err.code, errorName: err.name };
  }
  if (err instanceof SessionNotFoundError) {
    return { outcome: 'session-refused', errorCode: err.code, errorName: err.name };
  }
  const code = (err as { code?: unknown } | undefined)?.code;
  const name = (err as { name?: unknown } | undefined)?.name;
  // A hosting refusal names itself with an `ERR_…` code. Anything else is a
  // failure rather than a decision — and either way only the class travels.
  const hasHostingCode = typeof code === 'string' && code.startsWith('ERR_');
  return {
    outcome: hasHostingCode ? 'refused' : 'failed',
    ...(typeof code === 'string' && { errorCode: code }),
    ...(typeof name === 'string' && { errorName: name }),
  };
}

/**
 * The per-request bookkeeping: the facts known at the door, the facts learned
 * on the way in, and the ONE record that leaves.
 *
 * Built only when a sink is configured. `settle` is idempotent — the first
 * terminal wins, and a reply that somehow reaches two of them (a host that
 * completes and then fails) still produces exactly one record, because two
 * records for one request would be a census that over-counts.
 */
export interface IngressNote {
  /** Wrap the host's reply so its first terminal files the record. */
  watch(reply: HostReply): HostReply;
  /** The verifier proved somebody — record the proven id, never a claimed one. */
  identified(verified: VerifiedIdentity | undefined): void;
  /** An admission policy answered. */
  admitted(verdict: IngressAdmissionVerdict): void;
  /** File the record for a request that left without any terminal at all. */
  settle(): void;
}

/** Which op name a request named, in the spelling a body uses. */
function opOf(request: HostRequest): string | undefined {
  if (request.session !== undefined) {
    return request.session.op === 'list' ? SESSION_LIST_OP : SESSION_TRANSCRIPT_OP;
  }
  if (request.artifact !== undefined) {
    return request.artifact.op === 'head' ? ARTIFACT_HEAD_OP : ARTIFACT_GET_OP;
  }
  return undefined;
}

/** Which door a request knocked at — the same discriminants the handler uses. */
function doorOf(request: HostRequest): IngressDoor {
  if (request.session !== undefined) return 'session-op';
  if (request.artifact !== undefined) return 'artifact';
  return 'turn';
}

/**
 * Which conversation this request named. A `session-transcript` names it inside
 * the op rather than beside it, and a record that missed that would be blind to
 * exactly the refusal the ownership rule produces.
 */
function sessionOf(request: HostRequest): string | undefined {
  if (request.session !== undefined && request.session.op === 'transcript') {
    return request.session.sessionId;
  }
  return request.sessionId;
}

let warnedOnce = false;

/** Report a throwing sink once. A broken record is a fault worth naming; a
 *  fault reported on every request is a second outage. */
function warnSink(err: unknown): void {
  if (warnedOnce) return;
  warnedOnce = true;
  // eslint-disable-next-line no-console
  console.warn(
    `[hosting] the onIngressDecision sink threw and the record was dropped. The request was ` +
      `unaffected — a broken log must not turn a served request into a failed one — but this ` +
      `door's ingress decisions are not being recorded. Reported once per process. Cause: ` +
      `${(err as { name?: string } | undefined)?.name ?? 'unknown'}`,
  );
}

/**
 * Begin one request's ingress record.
 *
 * @internal — the option is public, this bookkeeping is not.
 */
export function beginIngress(request: HostRequest, sink: IngressSink): IngressNote {
  const door = doorOf(request);
  const op = opOf(request);
  const sessionId = sessionOf(request);
  // Presence, never the value: the whole point of the class vocabulary above is
  // that an operator can act without a single character of the credential.
  const bearerPresent = bearerToken(request.headers) !== undefined;
  let userId: string | undefined;
  let admission: IngressAdmissionVerdict | undefined;
  let filed = false;

  function file(outcome: IngressOutcome, err?: unknown): void {
    if (filed) return;
    filed = true;
    const detail = err === undefined ? undefined : classify(err);
    const record: IngressRecord = {
      at: Date.now(),
      door,
      ...(op !== undefined && { op }),
      outcome: detail?.outcome ?? outcome,
      ...(detail?.errorCode !== undefined && { errorCode: detail.errorCode }),
      ...(detail?.errorName !== undefined && { errorName: detail.errorName }),
      ...(detail?.identityFailure !== undefined && { identityFailure: detail.identityFailure }),
      ...(detail?.claimedUser !== undefined && { claimedUser: detail.claimedUser }),
      ...(userId !== undefined && { userId }),
      ...(sessionId !== undefined && { sessionId }),
      bearerPresent,
      ...(admission !== undefined && { admission }),
    };
    try {
      sink(record);
    } catch (sinkErr) {
      warnSink(sinkErr);
    }
  }

  return {
    watch(reply: HostReply): HostReply {
      // Every optional terminal is forwarded ONLY when the host has it: the
      // composer feature-detects `awaiting`/`artifact`/`sessions`, so a wrapper
      // that defined them unconditionally would tell it the host can describe a
      // pause it cannot, and the named refusal for that case would never fire.
      return {
        complete(output: string): void {
          file('served');
          reply.complete(output);
        },
        fail(error: Error): void {
          file('failed', error);
          reply.fail(error);
        },
        ...(reply.awaiting && {
          awaiting: (pending) => {
            file('served');
            reply.awaiting?.(pending);
          },
        }),
        ...(reply.artifact && {
          artifact: (result) => {
            file('served');
            reply.artifact?.(result);
          },
        }),
        ...(reply.sessions && {
          sessions: (result) => {
            file('served');
            reply.sessions?.(result);
          },
        }),
        // Not a terminal: a chunk is part of an answer still being written.
        ...(reply.emit && { emit: (chunk: string) => reply.emit?.(chunk) }),
      };
    },
    identified(verified: VerifiedIdentity | undefined): void {
      if (verified !== undefined) userId = verified.userId;
    },
    admitted(verdict: IngressAdmissionVerdict): void {
      admission = verdict;
    },
    settle(): void {
      // Only reachable if a request left the door without ending its reply,
      // which the composer never does. Recorded as a failure rather than
      // silently dropped: a census with holes is the thing this replaces.
      file('failed');
    },
  };
}

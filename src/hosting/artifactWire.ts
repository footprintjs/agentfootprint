/**
 * hosting/artifactWire — the wire grammar for redeeming claim tickets, owned
 * once.
 *
 * The artifacts layer (9.21–9.22) taught tools and the model to route refs
 * instead of hauling data; `present({ ref, as })` hands one to the screen.
 * This module is the screen's half of that handshake: the two WIRE OPERATIONS
 * a hosting door answers so a frontend can redeem the ticket —
 *
 *   `{ op: 'artifact-head', ref }` → the ticket's metadata (the render
 *                                    decision: pick a component from `kind`
 *                                    and `bytes` without paying for bytes)
 *   `{ op: 'artifact-get',  ref }` → metadata + the payload (render it)
 *
 * Read-only on purpose. The wire deliberately carries NO put/delete/list:
 * a screen redeems tickets, it does not mint or sweep, and `list` over a wire
 * would let a caller ENUMERATE a scope — possession of a ref is the whole
 * entitlement this door honours, and even that only under the requesting
 * session's identity-composed scope (`standingAgent` composes it; the store
 * enforces it).
 *
 * ── Why ONE owner ────────────────────────────────────────────────────────────
 * Two shipped dialects speak these ops (`jsonWire`, and the managed-runtime
 * wire in `adapters/hosting/`) and any custom `HttpWire` may join them. An op
 * grammar re-derived per dialect is how one of them ends up accepting
 * `'artifact-head'` and another `'artifactHead'` — so the reader, the op names
 * and the standard reply body live here and every dialect calls them (the
 * `headerValue` precedent).
 *
 * ── The refusal law ──────────────────────────────────────────────────────────
 * A body that NAMES an `op` never falls through to a model turn. A caller who
 * typo'd `'artifact-head'` and silently got a conversation turn (with the ref
 * as garbage input) would be the accepted-and-silently-wrong failure, so an
 * unknown op — and a known op missing its `ref`, or naming one that is not a ref
 * (`isArtifactRef`) — throws {@link InvalidWireOpError}, which `httpHost`
 * answers as that request's 400.
 */

import { isArtifactRef } from '../artifacts/naming.js';
import type { ArtifactMeta } from '../artifacts/types.js';
import type { AnswerAccount, AnswerAccountShownLeaf } from '../lib/answer-account/types.js';
import { InvalidWireOpError } from './errors.js';
import { isWireOp, refuseUnknownWireOp, WIRE_OPS } from './wireOps.js';

/**
 * The refusal for a `ref` that is not a claim ticket — one sentence, shared by
 * the wire readers and the composer's own check, and never echoing the text.
 *
 * @internal
 */
export const NOT_A_REF =
  `was given a 'ref' that is not a claim ticket. Refs are minted as art_ followed by 22 ` +
  `letters and digits; take them verbatim from a tool result, an artifacts.minted event ` +
  `or a present(...) result.`;

/** The wire spelling of `head` — metadata only, the render-by-ref decision. */
export const ARTIFACT_HEAD_OP = WIRE_OPS.artifactHead;
/** The wire spelling of `get` — metadata + payload. */
export const ARTIFACT_GET_OP = WIRE_OPS.artifactGet;
/**
 * The wire spelling of `account` — one answer's plain-words account, computed
 * on the server from the recording the ref names (explain-answer).
 *
 * @internal Read through `WIRE_OPS.answerAccount` from the barrel.
 */
export const ANSWER_ACCOUNT_OP = WIRE_OPS.answerAccount;

/**
 * The body keys an `answer-account` request may carry: the op, the ticket, and
 * the session (which rides the body as it does on every other request). Any
 * other key is refused by name — most of all `declarations`, which are the
 * HOST's, validated at boot, and never a request's to choose.
 */
const ANSWER_ACCOUNT_KEYS: ReadonlySet<string> = new Set(['op', 'ref', 'sessionId']);

/** The wire spelling of a port-side verb — what every refusal names. */
export function artifactOpWireName(op: ArtifactWireRequest['op']): string {
  return op === 'head' ? ARTIFACT_HEAD_OP : op === 'get' ? ARTIFACT_GET_OP : ANSWER_ACCOUNT_OP;
}

/**
 * One artifact operation, as a request carries it — the port-side shape
 * behind the wire's `{ op, ref }`.
 *
 * `op` is the store's own verb vocabulary (`head` | `get`), not the wire
 * spelling: the wire says `'artifact-head'` because a body field named `op`
 * has to say which domain it belongs to; the port already knows.
 */
export interface ArtifactWireRequest {
  /**
   * Which read to run: `head`, `get`, or `account` — the answer account of the
   * recording the ref names (wire spelling `'answer-account'`).
   */
  readonly op: 'head' | 'get' | 'account';
  /** The claim ticket to redeem (`art_…`). */
  readonly ref: string;
}

/**
 * What a resolved artifact operation hands the reply — everything a wire
 * needs to compose its body.
 */
export interface ArtifactWireResult {
  /** The verb that ran. `data` is present iff it was `get`; `answer` iff `account`. */
  readonly op: 'head' | 'get' | 'account';
  /** The ref as requested. */
  readonly ref: string;
  /**
   * The claim ticket — what `head` returns and what `get` returns beside the
   * payload. For `account` it is the recording's ticket, which the reply body
   * does NOT carry (the body is the account and its show-me leaves, nothing
   * else).
   */
  readonly meta: ArtifactMeta;
  /** The payload. Present iff `op` is `get`. */
  readonly data?: unknown;
  /** The answer account and its show-me leaves. Present iff `op` is `account`. */
  readonly answer?: AnswerAccountWireBody;
}

/**
 * What an `answer-account` request answers with: the account, and the leaf
 * values its "show me" pointers name that pass the allow-list — keyed by
 * `answerAccountPointerKey(pointer)` (`agentfootprint/observe`). Nothing else
 * from the recording leaves the server.
 *
 * Bounded: the account is at most 128 KB serialized and `shown` at most 64 KB,
 * so a whole reply is at most 192 KB.
 */
export interface AnswerAccountWireBody {
  readonly account: AnswerAccount;
  readonly shown: Readonly<Record<string, AnswerAccountShownLeaf>>;
}

/**
 * Read an artifact operation out of a request body, if the body names one.
 *
 * Returns `undefined` for a body with no `op` field — an ordinary invoke,
 * untouched — and for an op that belongs to ANOTHER domain's reader (the
 * session-history ops, 9.26.0): declining is not the same as refusing, and a
 * reader that claimed a neighbour's op would be the fork this grammar has one
 * owner to prevent. Throws {@link InvalidWireOpError} for an `op` nobody
 * speaks, and for a known op whose `ref` is missing or blank: a request that
 * NAMED an operation must never quietly become something else.
 *
 * Exported for custom {@link import('./httpHost.js').HttpWire} dialects, so a
 * third dialect reads the ops exactly as the two shipped ones do.
 */
export function readArtifactWireOp(
  body: Readonly<Record<string, unknown>>,
): ArtifactWireRequest | undefined {
  const op = body.op;
  if (op === undefined) return undefined;
  if (op !== ARTIFACT_HEAD_OP && op !== ARTIFACT_GET_OP && op !== ANSWER_ACCOUNT_OP) {
    // Somebody else's op — theirs to read. Nobody's — one shared refusal,
    // listing every operation this package speaks.
    if (isWireOp(op)) return undefined;
    refuseUnknownWireOp(op);
  }
  const ref = body.ref;
  if (typeof ref !== 'string' || ref.trim().length === 0) {
    throw new InvalidWireOpError(
      `'${String(op)}' needs 'ref' — the art_… claim ticket to redeem. The refs a run ` +
        `minted travel in its tool results and artifacts.minted events; a present(...) ` +
        `result carries the ref beside its description snapshot.`,
    );
  }
  // A ref is a MINTED token (`art_` + 22), and the one a request names travels
  // onto the record (`artifacts.refused { ref }`) — so text that is not a ref
  // is refused HERE, by shape, before any of it can reach a recording someone
  // else will read. The refusal never echoes the text.
  if (!isArtifactRef(ref)) {
    throw new InvalidWireOpError(`'${String(op)}' ${NOT_A_REF}`);
  }
  if (op === ANSWER_ACCOUNT_OP) {
    refuseForeignAccountKeys(body);
    return { op: 'account', ref };
  }
  return { op: op === ARTIFACT_HEAD_OP ? 'head' : 'get', ref };
}

/**
 * An `answer-account` body names the ticket and nothing else. A key a caller
 * believed would shape the account (`declarations`, a run id, a template
 * version) is refused BY NAME rather than ignored: ignoring it would answer an
 * account the caller did not ask for, and let them believe they had. The name
 * is echoed only when it is a plain identifier; anything else is "a key".
 */
function refuseForeignAccountKeys(body: Readonly<Record<string, unknown>>): void {
  const foreign = Object.keys(body).find((key) => !ANSWER_ACCOUNT_KEYS.has(key));
  if (foreign === undefined) return;
  const named = /^[A-Za-z_][A-Za-z0-9_-]{0,40}$/.test(foreign) ? `'${foreign}'` : 'a key';
  throw new InvalidWireOpError(
    `'${ANSWER_ACCOUNT_OP}' was given ${named} it does not read. It takes { op, ref } (and ` +
      `the session, which rides the body, header or cookie as on any request); the ` +
      `declarations and everything else that shapes the account are the host's, set once ` +
      `with standingAgent({ answerAccounts }).`,
  );
}

/**
 * The standard reply body for a resolved artifact operation:
 * `{ artifact: { ref, meta } }` for `head`, `{ artifact: { ref, meta, data } }`
 * for `get`, and `{ account, shown }` for `answer-account`.
 *
 * Authored once so the two shipped dialects (and any custom one that wants
 * interop with the lens family's resolver) answer byte-compatibly; a dialect
 * that must add its own envelope fields spreads this and adds them beside
 * `artifact` (the managed-runtime wire adds its own `status`).
 */
export function artifactWireBody(
  result: ArtifactWireResult,
): { readonly artifact: Readonly<Record<string, unknown>> } | AnswerAccountWireBody {
  // An `answer-account` result answers `{ account, shown }` — composed HERE so
  // every dialect that already answers through this function (both shipped
  // ones, and any custom one) serves it without a line of its own. A separate
  // body function would let a dialect that never heard of it answer
  // `{ artifact: { ref, meta } }` to an account request: accepted and silently
  // wrong.
  if (result.op === 'account' && result.answer !== undefined) {
    return { account: result.answer.account, shown: result.answer.shown };
  }
  return {
    artifact: {
      ref: result.ref,
      meta: result.meta,
      ...(result.op === 'get' && { data: result.data }),
    },
  };
}

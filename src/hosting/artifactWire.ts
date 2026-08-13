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
 * unknown op — and a known op missing its `ref` — throws
 * {@link InvalidWireOpError}, which `httpHost` answers as that request's 400.
 */

import type { ArtifactMeta } from '../artifacts/types.js';
import { InvalidWireOpError } from './errors.js';
import { isWireOp, refuseUnknownWireOp, WIRE_OPS } from './wireOps.js';

/** The wire spelling of `head` — metadata only, the render-by-ref decision. */
export const ARTIFACT_HEAD_OP = WIRE_OPS.artifactHead;
/** The wire spelling of `get` — metadata + payload. */
export const ARTIFACT_GET_OP = WIRE_OPS.artifactGet;

/**
 * One artifact operation, as a request carries it — the port-side shape
 * behind the wire's `{ op, ref }`.
 *
 * `op` is the store's own verb vocabulary (`head` | `get`), not the wire
 * spelling: the wire says `'artifact-head'` because a body field named `op`
 * has to say which domain it belongs to; the port already knows.
 */
export interface ArtifactWireRequest {
  /** Which of the two read verbs to run. */
  readonly op: 'head' | 'get';
  /** The claim ticket to redeem (`art_…`). */
  readonly ref: string;
}

/**
 * What a resolved artifact operation hands the reply — everything a wire
 * needs to compose its body.
 */
export interface ArtifactWireResult {
  /** The verb that ran. `data` is present iff it was `get`. */
  readonly op: 'head' | 'get';
  /** The ref as requested. */
  readonly ref: string;
  /** The claim ticket — what `head` returns and what `get` returns beside the payload. */
  readonly meta: ArtifactMeta;
  /** The payload. Present iff `op` is `get`. */
  readonly data?: unknown;
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
  if (op !== ARTIFACT_HEAD_OP && op !== ARTIFACT_GET_OP) {
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
  return { op: op === ARTIFACT_HEAD_OP ? 'head' : 'get', ref };
}

/**
 * The standard reply body for a resolved artifact operation:
 * `{ artifact: { ref, meta } }` for `head`, `{ artifact: { ref, meta, data } }`
 * for `get`.
 *
 * Authored once so the two shipped dialects (and any custom one that wants
 * interop with the lens family's resolver) answer byte-compatibly; a dialect
 * that must add its own envelope fields spreads this and adds them beside
 * `artifact` (the managed-runtime wire adds its own `status`).
 */
export function artifactWireBody(result: ArtifactWireResult): {
  readonly artifact: Readonly<Record<string, unknown>>;
} {
  return {
    artifact: {
      ref: result.ref,
      meta: result.meta,
      ...(result.op === 'get' && { data: result.data }),
    },
  };
}

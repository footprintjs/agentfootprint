/**
 * hosting/wireOps — the ONE list of operations a request body's `op` may name.
 *
 * A hosting request is ordinarily a MESSAGE. Some are not: since 9.23 a body
 * carrying `{ op: 'artifact-head' | 'artifact-get', ref }` redeems a claim
 * ticket, and since 9.26 one carrying `{ op: 'session-list' }` or
 * `{ op: 'session-transcript', sessionId }` asks the verified caller's own
 * conversation history. Two DOMAINS now share one field.
 *
 * That is exactly the shape where a grammar quietly forks. Each domain has its
 * own reader (`readArtifactWireOp`, `readSessionWireOp`), each reader must
 * decline the other domain's ops without claiming them — and somebody has to
 * own "this is not an op anybody speaks", which is the refusal that keeps a
 * typo from becoming a conversation turn with a ref as its input.
 *
 * So the names live here, once, and both readers ask this module the two
 * questions they cannot answer alone: *is this somebody's op?* and *what do we
 * say when it is nobody's?* Either reader produces the same refusal, listing
 * the same operations, in the same words — so the answer never depends on which
 * dialect happened to call which reader first.
 */

import { InvalidWireOpError } from './errors.js';

/**
 * Every operation this package's wire grammar knows, keyed by the name the code
 * uses for it. The VALUES are the wire spelling — a body says `op:
 * 'artifact-head'`, because a field named `op` has to say which domain it
 * belongs to.
 */
export const WIRE_OPS = {
  /** The claim ticket's metadata — the render-by-ref decision (9.23.0). */
  artifactHead: 'artifact-head',
  /** Metadata + the payload (9.23.0). */
  artifactGet: 'artifact-get',
  /** The verified caller's own sessions (9.26.0). */
  sessionList: 'session-list',
  /** One owned session's message history (9.26.0). */
  sessionTranscript: 'session-transcript',
} as const;

/** One wire operation name, as a body spells it. */
export type WireOpName = (typeof WIRE_OPS)[keyof typeof WIRE_OPS];

/** Every op name, in the order a refusal lists them. */
export const ALL_WIRE_OPS: readonly WireOpName[] = Object.values(WIRE_OPS);

/** Is this string an operation some reader in this package owns? */
export function isWireOp(candidate: unknown): candidate is WireOpName {
  return typeof candidate === 'string' && (ALL_WIRE_OPS as readonly string[]).includes(candidate);
}

/**
 * The ONE refusal for a body that named an operation nobody speaks.
 *
 * A caller who typo'd `'artifact-hed'` and silently got a conversation turn
 * (with the ref as garbage input) is the accepted-and-silently-wrong failure
 * this exists to prevent: a body that NAMES an op never falls through to a
 * model turn. `httpHost` answers it as that request's 400.
 */
export function refuseUnknownWireOp(op: unknown): never {
  throw new InvalidWireOpError(
    `the wire operation '${String(op)}' is not one this host speaks. Known operations: ` +
      `'${WIRE_OPS.artifactHead}' (a claim ticket's metadata) and '${WIRE_OPS.artifactGet}' ` +
      `(metadata + payload), each taking { ref }; '${WIRE_OPS.sessionList}' (the verified ` +
      `caller's own sessions) and '${WIRE_OPS.sessionTranscript}' (one owned session's ` +
      `messages, taking { sessionId }). A request without 'op' is an ordinary invoke.`,
  );
}

/** Per-response HTTP framing; protocols supply their own encoder without a second host. */
import type { AgentfootprintEvent } from '../events/registry.js';
import type { SseFramePosition } from './stream.js';
import type { PendingAsk } from './types.js';
import type { ArtifactWireResult } from './artifactWire.js';
import type { SessionWireResult } from './sessionWire.js';
import type { RunSettlement } from './protocolAdapter.js';

/**
 * Where a failure came from.
 *
 * `'refused'` is the handler CHOOSING to fail with words it picked for the
 * caller. `'threw'` is an exception this host caught — the message is the
 * author's note to their own logs, and may name a query, a path or a token.
 *
 * The distinction exists because a dialect that sanitises has to sanitise the
 * right one: replacing both silences deliberate refusals, and replacing
 * neither publishes stack-trace prose to whoever is on the other end.
 */
export type FailureOrigin = 'refused' | 'threw';

export interface StreamFrame {
  readonly event: string;
  readonly data: unknown;
}

/**
 * The frames ONE streaming response is made of.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * A wire's body methods answer "what do the fields say". This answers a
 * different question: "what SHAPE is a stream". This host's own dialect frames
 * one homogeneous `chunk` per piece and one terminal frame, and that is a real
 * shape — but it is not the only one. Several protocols in wide use frame a
 * stream as a LIFECYCLE instead: named events that open a response, announce
 * that output is beginning, carry deltas, close each part, and close the
 * response — every event referring to one response object by id, often
 * numbered.
 *
 * Those cannot be expressed as "a body shape per chunk", because one host
 * lifecycle point becomes SEVERAL frames, and because the frames share state
 * (an id minted once, a counter that only goes up). So a dialect that frames
 * this way supplies one of these PER RESPONSE and keeps that state in it.
 *
 * ── The default is one of these ──────────────────────────────────────────────
 * A wire that supplies none gets framing built from its own body methods —
 * `chunk`/`complete`/`error`, exactly as before. The incumbent shape is an
 * INSTANCE of this seam rather than a special case beside it, which is the
 * reason to believe the seam is in the right place.
 */
export interface StreamFraming {
  /** Protocol bytes from the protocol's own framing strategy; absent retains named SSE frames. */
  encode?(frame: StreamFrame, position: SseFramePosition): string;
  /** Served events bound by the host to one admitted native invocation. */
  event?(event: AgentfootprintEvent): readonly StreamFrame[];
  /** Explicit application reply delivery, through the protocol's allow-list. */
  custom?(name: string, payload: Readonly<Record<string, unknown>>): readonly StreamFrame[];
  /**
   * Frames to write the moment the stream opens, before the handler runs.
   * Absent or empty means the stream announces itself with nothing, which is
   * this host's own behaviour.
   */
  open?(): readonly StreamFrame[];
  /** Frames for one piece of streamed output. */
  chunk(text: string): readonly StreamFrame[];
  /** Frames that close a response that completed. */
  complete(output: string): readonly StreamFrame[];
  /** Frames that close a failed response; settlement carries only class-derived refusal evidence. */
  failure(
    message: string,
    code?: string,
    origin?: FailureOrigin,
    settlement?: Extract<RunSettlement, { kind: 'failed' }>,
  ): readonly StreamFrame[];
  /**
   * Frames that close a response ending in one of the other terminals. Absent
   * means the single-frame default, so a framing written for text alone keeps
   * working when an artifact or a paused run comes back through it.
   */
  awaiting?(pending: PendingAsk): readonly StreamFrame[];
  artifact?(result: ArtifactWireResult): readonly StreamFrame[];
  sessions?(result: SessionWireResult): readonly StreamFrame[];
}

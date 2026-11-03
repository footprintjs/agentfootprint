import type {
  ArtifactOp,
  ArtifactOrigin,
  ArtifactRefusalReason,
  ArtifactSweepReason,
  DatasetTimeAxis,
} from './dependencyTypes.js';

// artifacts.* (4) — the claim-check lifecycle (9.21.0). Every hop of a ref —
// minted, resolved, swept, refused — lands on the record AS IT HAPPENS, which
// is what separates this store from "where are the bytes" systems: the trace
// answers which step produced an artifact, reading what, under which decision.
// LAW: these payloads carry META ONLY. Payload bytes never enter an event, a
// recorder, or an exporter — an id in a log is safe by construction because a
// ref alone opens nothing.

/** A payload was checked in and the store minted its claim ticket — by a
 *  tool (`tool` names it), or by no tool at all (see {@link tool}). */
export interface ArtifactMintedPayload {
  readonly ref: string;
  /** Consumer vocabulary: 'dataset/rows', 'chart/spec', … */
  readonly kind: string;
  readonly mediaType: string;
  readonly bytes: number;
  readonly label?: string;
  /** `sha-256:<hex>` when the put asked for one. Metadata, never the key. */
  readonly digest?: string;
  /** Unix ms when the ref stops resolving — stated at mint, never sprung. */
  readonly expiresAt?: number;
  /** The join to the trace: the run and tool call that minted it. */
  readonly origin?: ArtifactOrigin;
  /** Derivation facts — validated at mint, so they cannot dangle at birth. */
  readonly parentRefs?: readonly string[];
  /** The rows' declared time axis — validated at mint (see `ArtifactMeta.timeAxis`). */
  readonly timeAxis?: DatasetTimeAxis;
  /** The tool whose execute minted it. ABSENT when no tool did — the run's own
   *  recording (9.26.0, the `recordings` dial) or a host filing for its turn
   *  through `HostReply.turnArtifacts`; the event's `meta.sessionId` then names
   *  the session the host filed for. Typed as always-present until now, and
   *  already absent at run time since 9.26.0 — the 9.23.0 `resolved` /
   *  `refused` precedent. Naming a phantom tool would be an actor a dashboard
   *  groups by that does not exist. */
  readonly tool?: string;
}

/** A ref was redeemed — described (`head`) or read (`get`) — under scope. */
export interface ArtifactResolvedPayload {
  readonly ref: string;
  /** `head` is the render-by-ref decision; `get` pays for the payload. */
  readonly via: 'head' | 'get';
  readonly kind: string;
  readonly bytes: number;
  /** The tool that redeemed it. ABSENT when the redemption came through the
   *  hosting door instead of a tool (9.23.0) — a screen resolving
   *  `artifact-head` / `artifact-get` over the wire, under the requesting
   *  session's identity. Stamping a phantom tool name there would be a
   *  dashboard grouping by an actor that does not exist. */
  readonly tool?: string;
}

/** An artifact left the store without its owner asking — the calendar (ttl)
 *  or a budget (max-bytes / max-count). Reported by the put that swept it. */
export interface ArtifactExpiredPayload {
  readonly ref: string;
  /** One vocabulary, defined in `artifacts/` and imported here — the
   *  PermissionCapability lesson: two copies of one union can drift. */
  readonly reason: ArtifactSweepReason;
  readonly kind: string;
  readonly bytes: number;
  /** The tool whose put discovered/forced the sweep. ABSENT when the put was
   *  not a tool's — the run's own recording, or a host filing for its turn
   *  (the {@link ArtifactMintedPayload.tool} rule). */
  readonly tool?: string;
}

/** An artifact verb refused — or answered "no data" — and said why. `no-store`
 *  is the fail-closed capability teaching how to attach a store;
 *  `missing-or-expired` keeps the API's deliberate ambiguity while the record
 *  still shows a resolve that found nothing; `digest-mismatch` is integrity
 *  refusing to deliver corrupt bytes as whole. Since 9.22.0, `op: 'dispatch'`
 *  is the framework's own door: a tool's declared `wants` argument (or a
 *  `present` call) that could not be delivered — the tool did not run and the
 *  model read a teaching refusal listing what CAN resolve
 *  (`kind-mismatch` names a ref that resolved to the wrong kind). */
export interface ArtifactRefusedPayload {
  readonly op: ArtifactOp;
  readonly reason: ArtifactRefusalReason;
  readonly ref?: string;
  /** The refusal sentence, when one was thrown. */
  readonly detail?: string;
  /** The tool whose call was refused. ABSENT when the refusal answered the
   *  hosting door instead of a tool (9.23.0) — a wire resolution that found
   *  nothing (`missing-or-expired`: the one indistinguishable answer for
   *  missing, expired and another-session's alike) or reached an agent with
   *  no store (`no-store`). */
  readonly tool?: string;
}

/**
 * Why a turn's artifact hand-over (`HostReply.turnArtifacts`) did not go
 * cleanly — one vocabulary, shared by this event and the ingress record's
 * `turnArtifactsFailure`:
 *
 *  - `'hook'`      — the host's hook threw or rejected (and not merely by
 *                    re-throwing an operation's own failure, which is counted
 *                    once, as `'operation'`);
 *  - `'operation'` — a verb started through the hand-over failed, awaited or
 *                    not: a store refusal, an I/O error;
 *  - `'timeout'`   — the hook and the operations it started outran the ceiling
 *                    (`turnArtifactsTimeoutMs`); the binding was revoked and the
 *                    reply delivered, and what was in flight may still land;
 *  - `'abort'`     — the request's own signal fired (the caller hung up) before
 *                    they settled; the same consequences;
 *  - `'expired'`   — a verb was called after its turn ended and was refused.
 */
export type ArtifactHandOverFailureCause = 'hook' | 'operation' | 'timeout' | 'abort' | 'expired';

/**
 * A turn's artifact hand-over failed (the host's own filing — a story, the
 * person's clicks). The reply was delivered regardless: the hand-over never
 * decides it. Emitted on the serving agent for the session it was produced
 * for (`meta.sessionId`, and `meta.runId` = the turn's run when it had one).
 *
 * Class only, never the message: the error came from the host's own code or
 * its store, and either may carry anything — META ONLY, like every
 * `artifacts.*` payload. `errorClass` is routable without parsing prose (the
 * `tools.session_close_failed` precedent).
 */
export interface ArtifactHandOverFailedPayload {
  readonly cause: ArtifactHandOverFailureCause;
  /** The verb, for `'operation'` and `'expired'`. */
  readonly op?: ArtifactOp;
  /** Constructor name of what was thrown, when it was an `Error`. */
  readonly errorClass?: string;
  /** This package's (or the store's) own `code`, when the error carried one. */
  readonly errorCode?: string;
}

/** The model handed an artifact to the screen (9.22.0): `present({ ref, as,
 *  label? })` resolved under the run's scope. `snapshot` is the description
 *  the claim ticket carries at speak time — `{ kind, mediaType, bytes,
 *  label }` — the same snapshot stored INSIDE the tool result so a reloaded
 *  conversation can render an honest placeholder after the artifact expired.
 *  `as` is the model's consumer vocabulary ('bar-chart', 'table', …), stored
 *  as data — the component registry that would validate it is a later phase.
 *  Meta only, never the payload: the screen redeems the ref itself, under
 *  its own identity. */
export interface ArtifactPresentedPayload {
  readonly ref: string;
  readonly as: string;
  readonly snapshot: {
    readonly kind: string;
    readonly mediaType: string;
    readonly bytes: number;
    readonly label?: string;
  };
  /** The presenting call — the join to the trace. */
  readonly toolCallId: string;
  readonly iteration: number;
}

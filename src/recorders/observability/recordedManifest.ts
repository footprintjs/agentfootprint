/**
 * The run manifest, as a recording carries it — the event it rides on, its
 * shape, and the one reader that lifts it out of a run's captured events.
 *
 * `agentfootprint.agent.run_configured` (9.41.0) names the adapters and
 * strategies a run is about to use. Two readers consume it: the recording
 * envelope (`recordingEnvelope.ts`) archives it as the run's own
 * `configuration`, and context-bisect's strategy arms
 * (`context-bisect/arms/manifest.ts`) check a declared arm against it. The
 * vocabulary lives here, beside the recording that carries it, so the trace
 * channel never imports the analysis built on top of it.
 *
 * Imports nothing: every shape is structural.
 */

// ─── Captured events, structurally ───────────────────────────────────

/**
 * Minimal structural envelope for captured typed events — satisfied by
 * `AgentfootprintEvent` (collect with `agent.on('*', e => events.push(e))`).
 * Structural so a consumer can hand in any array shaped like this.
 */
export interface CapturedEventLike {
  readonly type: string;
  readonly payload: unknown;
  readonly meta: { readonly runtimeStageId: string };
}

// ─── The manifest, structurally ──────────────────────────────────────

/**
 * One mounted memory as the run manifest describes it — structurally satisfied
 * by `RunConfiguredMemoryPayload`.
 */
export interface ManifestMemoryLike {
  readonly id?: string;
  readonly type?: string;
  readonly strategy?: string;
  readonly retrieval?: string;
  readonly embedderId?: string;
  readonly flavor?: string;
}

/**
 * The run-configuration manifest, structurally — satisfied by
 * `AgentRunConfiguredPayload` (the payload of
 * `agentfootprint.agent.run_configured`, 9.41.0).
 *
 * Declared structurally, and every member optional, for the same reason
 * `CapturedEventLike` is: reading one payload must not need the event
 * registry, and a consumer replaying manifests out of a saved recording must
 * be able to hand in any bag shaped like this.
 */
export interface RunManifestLike {
  readonly agentId?: string;
  readonly llm?: { readonly provider?: string; readonly model?: string };
  readonly reactMode?: string;
  readonly memories?: readonly ManifestMemoryLike[];
  readonly window?: string;
  readonly skillGraph?: {
    readonly routing?: string;
    readonly continuity?: string;
    readonly scorer?: string;
  };
  readonly evidenceGate?: string;
}

// ─── Reading it ──────────────────────────────────────────────────────

/** The event type the run manifest rides on (9.41.0). */
export const RUN_CONFIGURED_EVENT = 'agentfootprint.agent.run_configured';

/**
 * Pull the run manifest out of a run's captured typed events — the same
 * `CapturedEventLike[]` bag `localizeContextBug` already accepts, so a consumer
 * who collected events with `agent.on('*', …)` needs no second capture.
 *
 * One manifest per run by design; the FIRST is returned. A bag holding events
 * from several runs is the caller's own mixing — filter by `meta.runId` first.
 */
export function manifestFromEvents(
  events: readonly CapturedEventLike[] | undefined,
): RunManifestLike | undefined {
  const event = events?.find((e) => e.type === RUN_CONFIGURED_EVENT);
  if (event === undefined) return undefined;
  const payload = event.payload;
  // Structural, not a cast-and-pray: a payload that is not an object at all is
  // no manifest, and reporting `undefined` keeps `checked: false` honest.
  return payload !== null && typeof payload === 'object' ? (payload as RunManifestLike) : undefined;
}

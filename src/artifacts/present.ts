/**
 * artifacts/present — the hand-to-the-screen verb (Phase 2, Leg 2).
 *
 * `present({ ref, as, label? })` is how the model finishes an analytics
 * answer WITHOUT serializing what the screen will show: it names the ticket
 * (`ref`), the consumer vocabulary for how to render it (`as: 'bar-chart'`,
 * `'table'`, …), and optionally the human title. The framework `head`s the
 * ref under the run's own scope and the RESULT carries a DESCRIPTION
 * SNAPSHOT — `{ kind, mediaType, bytes, label }` — so the claim ticket
 * describes the parcel: a conversation reloaded after the artifact expired
 * can still render an honest placeholder from history alone ("Chart —
 * 'Q3 sales by region' (bar-chart, 41 KB) — expired; re-run to regenerate"),
 * because the snapshot lives INSIDE the tool result, the one thing provider
 * message history keeps typed and durable. Never a blank pane.
 *
 * `as` is deliberately NOT validated against a component registry — that
 * registry is a later phase (the frontend leg); until then the value is
 * stored as data and travels on the `artifacts.presented` event exactly as
 * spoken.
 *
 * This module is the PURE half — the tool's name/schema constants, the
 * snapshot shape, and the resolution over the five-verb port. The tool SHELL
 * (a placeholder whose result the agent loop overwrites — the `skip_step`
 * pattern) lives in core, which is also where the typed
 * `agentfootprint.artifacts.presented` event is emitted. Core wires
 * artifacts; never the reverse.
 */

import type { ArtifactMeta, ArtifactRef, ArtifactScope, ArtifactStore } from './types.js';

/**
 * The reserved name of the auto-attached tool. Reserved ONLY when a store is
 * attached (the `read_skill` seam): a storeless agent may keep its own
 * `present`, because the framework attaches nothing there.
 */
export const PRESENT_TOOL_NAME = 'present';

/**
 * The description snapshot — what the `present` result carries about the
 * parcel at speak time, so an expired artifact can still render an honest
 * placeholder from history. Meta only, never the payload.
 */
export interface PresentSnapshot {
  /** The artifact's own consumer vocabulary (`meta.kind`). */
  readonly kind: string;
  readonly mediaType: string;
  readonly bytes: number;
  /** The human title — the call's `label` when given, else the mint's. */
  readonly label?: string;
}

/** The one result shape a successful `present` returns (stringified onto the
 *  `role: 'tool'` message — a reload walks history for exactly this). */
export interface PresentedResult {
  /** Always `true`. The field a transcript walker branches on. */
  readonly presented: true;
  readonly ref: ArtifactRef;
  /** The consumer vocabulary the model chose — stored as data (the component
   *  registry that would validate it is a later phase). */
  readonly as: string;
  readonly snapshot: PresentSnapshot;
}

/** What presenting resolved to. Exactly one arm. */
export type PresentOutcome =
  | { readonly ok: true; readonly result: PresentedResult }
  | {
      readonly ok: false;
      /** The teaching refusal the model reads, listing what CAN resolve. */
      readonly refusal: string;
      /** Present iff the miss was a ref that did not resolve — the caller
       *  (the stage) puts `artifacts.refused` on the record for it. Absent
       *  for malformed args, which never reached the store. */
      readonly missedRef?: ArtifactRef;
    };

/** How many live refs a miss refusal lists. A lesson, not a catalog. */
const PRESENT_LIST_LIMIT = 10;

/** `art_h7Kq… [chart/spec · 41210 bytes · 'Q3 sales']` — one listed ref. */
function describeRef(meta: ArtifactMeta): string {
  return `${meta.ref} [${meta.kind} · ${meta.bytes} bytes${
    meta.label !== undefined ? ` · '${meta.label}'` : ''
  }]`;
}

/**
 * Resolve one `present` call over the port — ONE law for every dispatch
 * door. `head`, never `get`: presenting is the render-by-ref decision, and
 * the screen pays for the bytes later, under its own identity.
 */
export async function presentArtifact(
  store: ArtifactStore,
  scope: ArtifactScope,
  args: Readonly<Record<string, unknown>>,
): Promise<PresentOutcome> {
  const ref = args.ref;
  const as = args.as;
  if (typeof ref !== 'string' || ref.trim().length === 0) {
    return {
      ok: false,
      refusal:
        `present needs \`ref\` — the art_… ticket of the artifact to hand to the screen. ` +
        `Store the data first (a tool that mints, or the placement threshold), then present ` +
        `its ref.`,
    };
  }
  if (typeof as !== 'string' || as.trim().length === 0) {
    return {
      ok: false,
      refusal:
        `present needs \`as\` — the consumer vocabulary for how the screen should render ` +
        `'${ref}' (e.g. 'bar-chart', 'table', 'image'). Say what it is; the screen picks ` +
        `the renderer.`,
    };
  }
  const meta = await store.head(scope, ref);
  if (meta === null) {
    const page = await store.list(scope, { limit: PRESENT_LIST_LIMIT });
    const listing =
      page.artifacts.length === 0
        ? `Nothing is live in this run's scope right now — store the data first, then present ` +
          `its ref.`
        : `Live refs in scope: ${page.artifacts.map(describeRef).join(', ')}.`;
    return {
      ok: false,
      missedRef: ref,
      refusal:
        `present('${ref}') found nothing under that ref in this run's scope — expired, ` +
        `swept, or never stored here. Nothing was presented. ${listing}`,
    };
  }
  const label =
    typeof args.label === 'string' && args.label.trim().length > 0 ? args.label : meta.label;
  return {
    ok: true,
    result: {
      presented: true,
      ref: meta.ref,
      as,
      snapshot: {
        kind: meta.kind,
        mediaType: meta.mediaType,
        bytes: meta.bytes,
        ...(label !== undefined && { label }),
      },
    },
  };
}

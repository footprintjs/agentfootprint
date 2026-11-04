import type { DomainEvent } from './domainEvents.js';

// ─── Lean projection ─────────────────────────────────────────────────

/**
 * The `DomainEvent` fields that carry captured run CONTENT — what the
 * agent read, produced, and handed across a boundary — as opposed to
 * run STRUCTURE (where a boundary was, when, of what kind). These are
 * the fields `snapshot: 'lean'` drops.
 *
 * They are also exactly the fields `buildStepGraphFromEvents` turns
 * into StepNode content (`entryPayload` / `exitPayload` /
 * `contentSummary` / `assistantText` / `toolArgs` / `toolResult`) —
 * which is why dropping them is opt-in rather than the default.
 *
 * When you add a field to a `Domain*Event`, decide:
 *   - Does it hold data the agent handled (unbounded, redaction-
 *     relevant)?                                        → add it HERE
 *   - Does it say where/when/what-kind the boundary was? → leave it out
 *
 * Forgetting to add one means a lean snapshot still ships that content
 * — silently, since nothing else references the field.
 *
 * Two free-text fields deliberately stay OUT of this set: `rationale`
 * on `decision.branch` and `reason` on `context.injected`. They are
 * short capture-time annotations saying WHY a boundary happened, and a
 * lean bundle loses most of its explanatory value without them — but a
 * decider that interpolates run values into its rationale does put that
 * text in a lean artifact. Lean means "no captured payloads", not "no
 * free text at all"; say so wherever lean is offered as a redaction
 * story.
 */
const CONTENT_FIELDS = ['payload', 'args', 'result', 'content', 'contentSummary'] as const;

type ContentField = (typeof CONTENT_FIELDS)[number];

const CONTENT_FIELD_SET: ReadonlySet<string> = new Set<string>(CONTENT_FIELDS);

/**
 * A `DomainEvent` with its content fields removed — the shape
 * `toSnapshot()` emits under `snapshot: 'lean'`.
 *
 * Distributive by construction (`T extends unknown ? … : never`) so the
 * union survives the `Omit` and `type` still narrows for consumers.
 */
type StripContent<T> = T extends unknown ? Omit<T, ContentField> : never;

export type LeanDomainEvent = StripContent<DomainEvent>;

// ── Internal helpers ─────────────────────────────────────────────────

/**
 * Copy an event without its `CONTENT_FIELDS`. Allow-list by omission
 * rather than a per-type rewrite so a newly added STRUCTURAL field
 * reaches lean consumers without a second edit here — the asymmetry is
 * deliberate, and the one direction it gets wrong (a new content field
 * silently surviving) is pinned by a test on `CONTENT_FIELDS`.
 *
 * Builds a new object; the stored event is never mutated, so a lean
 * `toSnapshot()` leaves the live stream from `getEvents()` untouched.
 */
function stripContent(event: DomainEvent): LeanDomainEvent {
  const lean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event)) {
    if (!CONTENT_FIELD_SET.has(key)) lean[key] = value;
  }
  return lean as LeanDomainEvent;
}

export { stripContent };

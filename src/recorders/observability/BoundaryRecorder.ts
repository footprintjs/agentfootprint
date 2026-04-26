/**
 * BoundaryRecorder — domain-tagged projection over footprintjs `InOutRecorder`.
 *
 * Pattern: Pure projection. Holds a reference to an `InOutRecorder`,
 *          maps each `InOutEntry` to a `BoundaryEntry` with three
 *          domain tags:
 *            • `slotKind`        — `'system-prompt' | 'messages' | 'tools'`
 *                                   for the 3 agent input slots; undefined otherwise.
 *            • `primitiveKind`   — `'Agent' | 'LLMCall' | 'Sequence' | …`
 *                                   parsed from the subflow root description prefix.
 *            • `isAgentInternal` — `true` for Agent state-machine routing
 *                                   subflows (`route`, `tool-calls`, `final`)
 *                                   that are pure plumbing — Lens hides them
 *                                   from the timeline.
 *
 *          The 3 fields are derived from data already on the `InOutEntry`
 *          (`subflowId`, `description`) — no second event subscription, no
 *          stateful accumulation. Called on every render in Lens; cost is
 *          one `Array.map` over the recorder's flat entries.
 *
 * Role:    Single source of truth for "every step in the run, tagged
 *          with its domain meaning". Lens reads this directly to
 *          dispatch render shape (slot row inside LLM card vs.
 *          arrow-in / body / arrow-out for primitives vs. user → run →
 *          user for the root). No more "merge topology + boundaries +
 *          state machine" ceremony in the consumer.
 *
 * Naming: the footprintjs primitive is `InOutRecorder` (domain-agnostic;
 * captures every chart's input/output uniformly). This one is
 * `BoundaryRecorder` (agent-domain-aware; tags entries so Lens can render
 * them by type). Two recorders, one ID space (`runtimeStageId`).
 *
 * @example
 * ```typescript
 * import { inOutRecorder } from 'footprintjs/trace';
 * import { boundaryRecorder } from 'agentfootprint';
 *
 * const inOut = inOutRecorder();
 * executor.attachCombinedRecorder(inOut);
 * await executor.run({ input });
 *
 * const boundaries = boundaryRecorder(inOut);
 * for (const step of boundaries.getSteps()) {
 *   if (step.isRoot) renderRoot(step);
 *   else if (step.slotKind) renderSlotRow(step);             // 3-slot pedagogy
 *   else if (step.primitiveKind) renderPrimitive(step);      // arrow-in / body / arrow-out
 * }
 * ```
 */

import { ROOT_RUNTIME_STAGE_ID, type InOutEntry, type InOutRecorder } from 'footprintjs/trace';
import { SUBFLOW_IDS, slotFromSubflowId } from '../../conventions.js';
import type { ContextSlot } from '../../events/types.js';

// ── Public types ─────────────────────────────────────────────────────

/**
 * One half of a chart execution boundary, with agent-domain tags layered on.
 *
 * Inherits all `InOutEntry` fields (runtimeStageId, subflowId,
 * subflowPath, depth, phase, payload, isRoot, …) and adds:
 */
export interface BoundaryEntry extends InOutEntry {
  /**
   * Which of the 3 context-engineering slots this boundary is, when
   * applicable. Set ONLY for `sf-system-prompt` / `sf-messages` /
   * `sf-tools` subflow boundaries (matched by `slotFromSubflowId`,
   * which handles path-prefixed nested IDs too).
   *
   * Lens renders these as `in / out` cells inside the LLM card —
   * the visible "context engineering" surface. Undefined for any
   * non-slot subflow and for the root.
   */
  readonly slotKind?: ContextSlot;
  /**
   * Primitive kind parsed from the subflow root description prefix
   * (`'Agent: ReAct loop'` → `'Agent'`, `'LLMCall: one-shot'` →
   * `'LLMCall'`, etc). Set when the subflow's description follows the
   * `'<Kind>: <detail>'` taxonomy convention; undefined otherwise.
   *
   * Lens dispatches render shape on this — `'Agent' | 'LLMCall'` →
   * the 3-slot LLM card; everything else → arrow-in / body / arrow-out.
   */
  readonly primitiveKind?: string;
  /**
   * `true` when this boundary belongs to an Agent state-machine routing
   * subflow (`sf-route` / `sf-tool-calls` / `sf-final`). These are pure
   * plumbing — Lens hides them from the timeline.
   *
   * Slot subflows are NOT marked internal — they're real
   * context-engineering moments that Lens displays.
   */
  readonly isAgentInternal: boolean;
}

// ── Internal: which subflow IDs are agent-internal routing ───────────

/** Routing / wrapper subflows that have no semantic meaning to a developer.
 *  The 3 slot subflows (`sf-system-prompt` / `sf-messages` / `sf-tools`)
 *  are NOT in this set — they ARE meaningful context-engineering steps. */
const AGENT_INTERNAL_LOCAL_IDS: ReadonlySet<string> = new Set([
  SUBFLOW_IDS.ROUTE,
  SUBFLOW_IDS.TOOL_CALLS,
  SUBFLOW_IDS.FINAL,
  SUBFLOW_IDS.MERGE,
]);

// ── BoundaryRecorder ─────────────────────────────────────────────────

export class BoundaryRecorder {
  /**
   * @param source the `InOutRecorder` already attached to the executor.
   * `BoundaryRecorder` does NOT subscribe to events itself — the source
   * captures everything; this class is a tag-only projection.
   */
  constructor(private readonly source: InOutRecorder) {}

  /** All boundaries (entry+exit interleaved) with domain tags. */
  getBoundaries(): BoundaryEntry[] {
    return this.source.getBoundaries().map(tagEntry);
  }

  /** Just the `entry`-phase boundaries — the timeline projection.
   *  Includes the root entry (depth 0, `isRoot: true`) followed by every
   *  subflow's entry in execution order. */
  getSteps(): BoundaryEntry[] {
    return this.source.getSteps().map(tagEntry);
  }

  /** Entry/exit pair for one chart execution.
   *  `exit` is `undefined` for in-progress / paused charts. */
  getBoundary(runtimeStageId: string): { entry?: BoundaryEntry; exit?: BoundaryEntry } {
    const pair = this.source.getBoundary(runtimeStageId);
    return {
      ...(pair.entry ? { entry: tagEntry(pair.entry) } : {}),
      ...(pair.exit ? { exit: tagEntry(pair.exit) } : {}),
    };
  }

  /** Convenience for the outermost run pair. */
  getRootBoundary(): { entry?: BoundaryEntry; exit?: BoundaryEntry } {
    return this.getBoundary(ROOT_RUNTIME_STAGE_ID);
  }

  /** Subset of `getSteps()` that excludes Agent-internal routing subflows.
   *  Lens uses this for the slider's scrub axis — clean timeline, no
   *  router/branch noise. */
  getVisibleSteps(): BoundaryEntry[] {
    return this.getSteps().filter((s) => !s.isAgentInternal);
  }

  /** All entries grouped by `slotKind` — convenience for slot-row rendering
   *  inside the LLM card. */
  getSlotBoundaries(): { systemPrompt: BoundaryEntry[]; messages: BoundaryEntry[]; tools: BoundaryEntry[] } {
    const systemPrompt: BoundaryEntry[] = [];
    const messages: BoundaryEntry[] = [];
    const tools: BoundaryEntry[] = [];
    for (const b of this.getBoundaries()) {
      if (b.slotKind === 'system-prompt') systemPrompt.push(b);
      else if (b.slotKind === 'messages') messages.push(b);
      else if (b.slotKind === 'tools') tools.push(b);
    }
    return { systemPrompt, messages, tools };
  }
}

/** Factory — matches the `inOutRecorder()` / `topologyRecorder()` style. */
export function boundaryRecorder(source: InOutRecorder): BoundaryRecorder {
  return new BoundaryRecorder(source);
}

// ── Internal helpers ─────────────────────────────────────────────────

function tagEntry(e: InOutEntry): BoundaryEntry {
  const slotKind = e.isRoot ? undefined : slotFromSubflowId(e.subflowId);
  const primitiveKind = e.description ? parsePrimitiveKindFromDescription(e.description) : undefined;
  const isAgentInternal = e.isRoot ? false : AGENT_INTERNAL_LOCAL_IDS.has(e.localSubflowId);
  return {
    ...e,
    ...(slotKind ? { slotKind } : {}),
    ...(primitiveKind ? { primitiveKind } : {}),
    isAgentInternal,
  };
}

/**
 * Parse the `'<Kind>:'` prefix from a subflow root's description.
 * Returns `undefined` when no colon-prefix is present (consumer-authored
 * subflow without taxonomy markers).
 */
function parsePrimitiveKindFromDescription(description: string): string | undefined {
  const colonIdx = description.indexOf(':');
  if (colonIdx <= 0) return undefined;
  const kind = description.slice(0, colonIdx).trim();
  return kind || undefined;
}

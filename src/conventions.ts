/**
 * conventions — subflow + stage ID constants (builder↔recorder protocol).
 *
 * Pattern: Single Source of Truth constants (Ward Cunningham's SSOT).
 * Role:    Contract between `core/` builders and `recorders/core/` observers.
 *          Builders mount subflows with these IDs; recorders pattern-match
 *          on the IDs to emit grouped domain events.
 * Emits:   N/A (constants only).
 *
 * Rename any ID here → both builders and recorders stay in sync.
 */

import { splitStageId } from 'footprintjs/trace';
import type { ContextSlot } from './events/types.js';

/** Subflow IDs — mounted by builders, observed by recorders. */
export const SUBFLOW_IDS = {
  /** Injection Engine subflow. Evaluates every Injection's trigger
   *  and writes activeInjections[] for the slot subflows to consume. */
  INJECTION_ENGINE: 'sf-injection-engine',
  /** Inner subflow inside LLMCall that wraps the invocation
   *  (seed + slots + call-llm + optional thinking + extract-final).
   *  Mounted by LLMCall's outer `client` chart. */
  LLM_CALL: 'sf-llm-call',
  /** System-prompt slot subflow. Observed by ContextRecorder. */
  SYSTEM_PROMPT: 'sf-system-prompt',
  /** Messages slot subflow. */
  MESSAGES: 'sf-messages',
  /** Tools slot subflow. */
  TOOLS: 'sf-tools',
  /** ReAct router subflow (inside Agent). */
  ROUTE: 'sf-route',
  /** Tool-call execution subflow (inside Agent loop). */
  TOOL_CALLS: 'sf-tool-calls',
  /** Merge step inside Parallel. */
  MERGE: 'sf-merge',
  /** Final-answer composition inside Agent. Mounted via
   *  `addSubFlowChartBranch('final', ...)` so the subflow id is the
   *  Route decider's branch key — `'final'`, no `sf-` prefix. The
   *  decider returns `'final'` as a routing value AND the same string
   *  becomes the subflow's id. */
  FINAL: 'final',
  /** Cache subflow (v2.14). Wraps the whole per-turn cache machinery —
   *  decide markers → CacheGate decider → apply/skip — as ONE collapsible
   *  boundary in the chart. Provider-independent decision layer; the
   *  attached provider's CacheStrategy turns markers into wire format.
   *  UpdateSkillHistory stays OUTSIDE (in the main loop) so the rolling
   *  skillHistory window persists across iterations without round-tripping
   *  through this subflow. */
  CACHE: 'sf-cache',
  /** Cache decision subflow (v2.6). Walks activeInjections, emits
   *  agnostic CacheMarker[]. Provider-independent. Standalone building
   *  block; the agent now uses the `decideCacheMarkers` stage inside
   *  `sf-cache` instead of mounting this directly. */
  CACHE_DECISION: 'sf-cache-decision',
  /** Thinking-normalization mount (v2.14). Wraps the consumer's
   *  ThinkingHandler.normalize() in a real footprintjs subflow so it
   *  has its own runtimeStageId for tracing. The result lands on the
   *  parent LLMCall's `thinkingBlocks` payload, so this subflow is
   *  pure plumbing from the agent step's POV — never a user-facing
   *  step in the StepGraph. */
  THINKING: 'sf-thinking',
} as const;

export type SubflowId = (typeof SUBFLOW_IDS)[keyof typeof SUBFLOW_IDS];

/** Stage IDs — plain function stages that builders mount. */
export const STAGE_IDS = {
  SEED: 'seed',
  /** Context-assembly selector stage. Runs AFTER InjectionEngine and
   *  fans the 3 slot subflows (system-prompt / messages / tools) out in
   *  PARALLEL (selector picks all 3 every iteration; failFast so a
   *  required slot's throw aborts the turn). They converge before
   *  CacheDecision. Shared by buildAgentChart + buildDynamicAgentChart;
   *  the flat viz proof chart uses the same id as its root selector. */
  CONTEXT: 'context',
  /** Outer "client" stage in LLMCall's wrapped chart. Receives args on
   *  the first visit, $break()s on the second (post-loop) visit with
   *  the LLM answer as TraversalResult. This is the lens-friendly
   *  affordance — the User pill maps to this stage. */
  CLIENT: 'client',
  CALL_LLM: 'call-llm',
  /** Final-response extraction stage that runs after CallLLM (and
   *  optional sf-thinking). For LLMCall this is mostly symmetric with
   *  Agent's `sf-final` branch — gives lens a "Final" node and a
   *  clear commit boundary marking "we have the answer." */
  EXTRACT_FINAL: 'extract-final',
  FINAL: 'final',
  FORMAT_MERGE: 'format-merge',
  MERGE_LLM: 'merge-llm',
  EXTRACT_MERGE: 'extract-merge',
  /** Updates the rolling skill-history window before CacheGate
   *  evaluates skill-churn (v2.6). */
  UPDATE_SKILL_HISTORY: 'update-skill-history',
  /** CacheGate decider stage — routes to apply-markers / no-markers
   *  based on kill switch / hit rate / skill churn (v2.6). */
  CACHE_GATE: 'cache-gate',
  /** CacheGate branch (routing key) when markers SHOULD be applied
   *  this iteration. Pass-through stage; markers stay in scope. (v2.6) */
  APPLY_MARKERS: 'apply-markers',
  /** CacheGate branch (routing key) when markers should be SKIPPED
   *  this iteration. Stage clears scope.cacheMarkers. (v2.6) */
  SKIP_CACHING: 'no-markers',
  /** BuildLLMRequest stage — calls strategy.prepareRequest to apply
   *  markers to the wire request (v2.6). */
  BUILD_LLM_REQUEST: 'build-llm-request',
} as const;

export type StageId = (typeof STAGE_IDS)[keyof typeof STAGE_IDS];

// ─── Type guards ─────────────────────────────────────────────────────

/** True when a subflow id corresponds to one of the 3 context slots. */
export function isSlotSubflow(
  id: string,
): id is typeof SUBFLOW_IDS.SYSTEM_PROMPT | typeof SUBFLOW_IDS.MESSAGES | typeof SUBFLOW_IDS.TOOLS {
  return (
    id === SUBFLOW_IDS.SYSTEM_PROMPT || id === SUBFLOW_IDS.MESSAGES || id === SUBFLOW_IDS.TOOLS
  );
}

/** Map a slot subflow id to its ContextSlot type. Undefined for non-slot ids. */
export function slotFromSubflowId(id: string): ContextSlot | undefined {
  // Footprintjs prefixes nested subflow IDs with the parent's path
  // (e.g., 'llm-call-internals/sf-system-prompt' when a slot subflow
  // is mounted inside a wrapper subflow). Match the LAST segment so
  // the convention works at any nesting depth.
  const { localStageId } = splitStageId(id);
  switch (localStageId) {
    case SUBFLOW_IDS.SYSTEM_PROMPT:
      return 'system-prompt';
    case SUBFLOW_IDS.MESSAGES:
      return 'messages';
    case SUBFLOW_IDS.TOOLS:
      return 'tools';
    default:
      return undefined;
  }
}

/**
 * Resolve the context slot a scope write belongs to FROM THE WRITE'S OWN
 * `runtimeStageId` — not from a "currently-open slot" stack.
 *
 * Why: once the 3 slot subflows run in PARALLEL (selector fan-out), their
 * entry/write/exit events INTERLEAVE — a stack top is unreliable, so a write
 * inside `sf-messages` could be attributed to (or dropped against)
 * `sf-tools`. The write's `runtimeStageId` (`[subflowPath/]stageId#index`)
 * always encodes which slot subflow enclosed it; we scan the path segments
 * innermost-first for a slot id. Matches the sequential result exactly
 * (the write is still inside its own slot), so it is behavior-preserving.
 */
export function slotFromRuntimeStageId(runtimeStageId: string): ContextSlot | undefined {
  // Strip the `#index` suffix, then walk `[subflowPath/]stageId` segments.
  const path = runtimeStageId.split('#', 1)[0];
  const segments = path.split('/');
  for (let i = segments.length - 1; i >= 0; i--) {
    const slot = slotFromSubflowId(segments[i]!);
    if (slot) return slot;
  }
  return undefined;
}

/** True when an id is any of the library's known subflow IDs. */
export function isKnownSubflow(id: string): id is SubflowId {
  return (Object.values(SUBFLOW_IDS) as string[]).includes(id);
}

/** True when an id is any of the library's known stage IDs. */
export function isKnownStage(id: string): id is StageId {
  return (Object.values(STAGE_IDS) as string[]).includes(id);
}

// ─── Stage role (visual emphasis hint) ───────────────────────────────

/**
 * Semantic role of a stage, used by renderers to decide visual emphasis.
 *
 * The agent's chart mixes a handful of stages users actually care about
 * (the HEROES — what context was built, what the model decided, what it did)
 * with mechanism stages (PLUMBING). This is the ONE place that says which is
 * which; renderers stay generic and style purely off this role (e.g. heroes
 * prominent, plumbing muted). Keeping it here — the semantic owner — avoids
 * the "name-based filter list duplicated across renderers" anti-pattern.
 *
 * - `hero-slot`   — a context slot (system-prompt / messages / tools)
 * - `hero-llm`    — the LLM invocation
 * - `hero-action` — tool execution (the agent's actions)
 * - `plumbing`    — mechanism (injection engine, cache, route, thinking, …)
 * - `boundary`    — neutral chart boundaries (Initialize root, Final) +
 *                   anything unrecognised (rendered normally, never muted)
 */
export type StageRole = 'hero-slot' | 'hero-llm' | 'hero-action' | 'plumbing' | 'boundary';

/** Mechanism stages — present so the run works, not what the user reads. */
const PLUMBING_LOCAL_IDS: ReadonlySet<string> = new Set([
  SUBFLOW_IDS.INJECTION_ENGINE,
  SUBFLOW_IDS.LLM_CALL, // wrapper; the hero is the `call-llm` stage INSIDE it
  SUBFLOW_IDS.ROUTE,
  SUBFLOW_IDS.MERGE,
  SUBFLOW_IDS.CACHE,
  SUBFLOW_IDS.CACHE_DECISION,
  SUBFLOW_IDS.THINKING,
  STAGE_IDS.CONTEXT, // the selector fan-out point; its 3 slot children are the heroes
  STAGE_IDS.CLIENT,
  STAGE_IDS.EXTRACT_FINAL,
  STAGE_IDS.FORMAT_MERGE,
  STAGE_IDS.EXTRACT_MERGE,
  STAGE_IDS.UPDATE_SKILL_HISTORY,
  STAGE_IDS.CACHE_GATE,
  STAGE_IDS.APPLY_MARKERS,
  STAGE_IDS.SKIP_CACHING,
  STAGE_IDS.BUILD_LLM_REQUEST,
]);

/** Neutral chart boundaries — entry/exit, rendered normally (not muted). */
const BOUNDARY_LOCAL_IDS: ReadonlySet<string> = new Set([
  STAGE_IDS.SEED, // 'Initialize' — chart root / Agent boundary
  STAGE_IDS.FINAL, // 'final' (=== SUBFLOW_IDS.FINAL)
]);

/**
 * Classify a stage id into its {@link StageRole}. Accepts a path-qualified id
 * (`sf-llm-call/call-llm`) — only the LOCAL segment matters, so it works at
 * any nesting depth. Built entirely from the id constants above, so adding a
 * stage to the chart only requires listing it here.
 */
export function stageRole(id: string): StageRole {
  const { localStageId } = splitStageId(id);
  if (isSlotSubflow(localStageId)) return 'hero-slot';
  if (localStageId === STAGE_IDS.CALL_LLM || localStageId === STAGE_IDS.MERGE_LLM) return 'hero-llm';
  // Tool execution mounts under the bare branch key 'tool-calls' in shipped
  // charts; SUBFLOW_IDS.TOOL_CALLS is the reserved prefixed form.
  if (localStageId === 'tool-calls' || localStageId === SUBFLOW_IDS.TOOL_CALLS) return 'hero-action';
  if (BOUNDARY_LOCAL_IDS.has(localStageId)) return 'boundary';
  if (PLUMBING_LOCAL_IDS.has(localStageId)) return 'plumbing';
  return 'boundary'; // unknown → neutral (never silently muted)
}

/**
 * A {@link Milestone}'s kind — the domain vocabulary for "meaningful step you'd
 * scrub to" in the agent's run.
 */
export type MilestoneKind = 'iteration' | 'slot' | 'llm-turn' | 'tool-call' | 'decision';

/**
 * A time-travel milestone: a domain-declared scrub stop. Conceptually each
 * milestone marks the boundary of a COLLECTION of commits (the commits that
 * belong to that step) — so the Lens slider can step stage-by-stage
 * (iteration → llm-turn → tool-call → …) instead of stopping only on
 * structural subflow boundaries. The renderer iterates whatever the domain
 * classifies; it never hardcodes agent vocabulary.
 */
export interface Milestone {
  readonly kind: MilestoneKind;
  /** Human-readable base label ("LLM turn"); the renderer may add an ordinal. */
  readonly label: string;
}

/**
 * Classify a stage id into a {@link Milestone}, or `null` when the stage is NOT
 * a milestone boundary (its commits fold into the surrounding milestone's
 * collection). This is the DOMAIN's declaration of which steps are scrub-worthy;
 * the Lens consumes it to build the time-travel slider (see
 * agentfootprint-lens `cursorPositionsAtDrill`).
 *
 * Mirrors {@link stageRole}: accepts a runtimeStageId (`call-llm#17`), a
 * path-qualified id (`sf-llm-call/call-llm`), or a bare local id — only the
 * LOCAL stage segment matters, so it works at any nesting depth and for both
 * commit ids and subflow-group ids.
 */
export function milestoneFor(id: string): Milestone | null {
  // Strip the `#executionIndex` suffix (runtimeStageId form) before decomposing
  // the path prefix — splitStageId expects the segment before `#`.
  const beforeHash = id.includes('#') ? id.slice(0, id.indexOf('#')) : id;
  const { localStageId } = splitStageId(beforeHash);
  switch (localStageId) {
    // Loop entry — one per ReAct iteration. INJECTION_ENGINE is the flat loop
    // target; LLM_CALL is the subflow-shape loop target.
    case SUBFLOW_IDS.INJECTION_ENGINE:
    case SUBFLOW_IDS.LLM_CALL:
      return { kind: 'iteration', label: 'Iteration' };
    // Context slots — one stop per slot that was engineered THIS iteration. In
    // dynamic mode all three appear every turn; in classic mode only the slot
    // that actually re-ran (Messages) appears after turn 1 — so scrubbing shows
    // exactly "which slot got updated."
    case SUBFLOW_IDS.SYSTEM_PROMPT:
      return { kind: 'slot', label: 'System prompt' };
    case SUBFLOW_IDS.MESSAGES:
      return { kind: 'slot', label: 'Messages' };
    case SUBFLOW_IDS.TOOLS:
      return { kind: 'slot', label: 'Tools' };
    case STAGE_IDS.CALL_LLM:
    case STAGE_IDS.MERGE_LLM:
      return { kind: 'llm-turn', label: 'LLM turn' };
    // Tool execution mounts under the bare branch key 'tool-calls'.
    case 'tool-calls':
    case SUBFLOW_IDS.TOOL_CALLS:
      return { kind: 'tool-call', label: 'Tool call' };
    case SUBFLOW_IDS.ROUTE:
      return { kind: 'decision', label: 'Route' };
    default:
      return null;
  }
}

/**
 * Scope-key convention for context injections.
 *
 * Each slot subflow writes its injections to a well-known scope key.
 * ContextRecorder observes writes to these keys to emit context.injected
 * events. Builders that mount slot subflows MUST write injections to the
 * corresponding key; this is the data-level contract between builder and
 * recorder.
 */
export const INJECTION_KEYS = {
  SYSTEM_PROMPT: 'systemPromptInjections',
  MESSAGES: 'messagesInjections',
  TOOLS: 'toolsInjections',
} as const;

export type InjectionKey = (typeof INJECTION_KEYS)[keyof typeof INJECTION_KEYS];

/** Map a slot to its injection scope key. */
export function injectionKeyForSlot(slot: 'system-prompt' | 'messages' | 'tools'): InjectionKey {
  switch (slot) {
    case 'system-prompt':
      return INJECTION_KEYS.SYSTEM_PROMPT;
    case 'messages':
      return INJECTION_KEYS.MESSAGES;
    case 'tools':
      return INJECTION_KEYS.TOOLS;
  }
}

/** True when a scope key is any of the known injection keys. */
export function isInjectionKey(key: string): key is InjectionKey {
  return (Object.values(INJECTION_KEYS) as string[]).includes(key);
}

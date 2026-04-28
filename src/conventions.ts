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

import type { ContextSlot } from './events/types.js';

/** Subflow IDs — mounted by builders, observed by recorders. */
export const SUBFLOW_IDS = {
  /** Injection Engine subflow. Evaluates every Injection's trigger
   *  and writes activeInjections[] for the slot subflows to consume. */
  INJECTION_ENGINE: 'sf-injection-engine',
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
  /** Final-answer composition inside Agent. */
  FINAL: 'sf-final',
} as const;

export type SubflowId = (typeof SUBFLOW_IDS)[keyof typeof SUBFLOW_IDS];

/** Stage IDs — plain function stages that builders mount. */
export const STAGE_IDS = {
  SEED: 'seed',
  CALL_LLM: 'call-llm',
  FINAL: 'final',
  FORMAT_MERGE: 'format-merge',
  MERGE_LLM: 'merge-llm',
  EXTRACT_MERGE: 'extract-merge',
} as const;

export type StageId = (typeof STAGE_IDS)[keyof typeof STAGE_IDS];

// ─── Type guards ─────────────────────────────────────────────────────

/** True when a subflow id corresponds to one of the 3 context slots. */
export function isSlotSubflow(
  id: string,
): id is typeof SUBFLOW_IDS.SYSTEM_PROMPT | typeof SUBFLOW_IDS.MESSAGES | typeof SUBFLOW_IDS.TOOLS {
  return (
    id === SUBFLOW_IDS.SYSTEM_PROMPT ||
    id === SUBFLOW_IDS.MESSAGES ||
    id === SUBFLOW_IDS.TOOLS
  );
}

/** Map a slot subflow id to its ContextSlot type. Undefined for non-slot ids. */
export function slotFromSubflowId(id: string): ContextSlot | undefined {
  // Footprintjs prefixes nested subflow IDs with the parent's path
  // (e.g., 'llm-call-internals/sf-system-prompt' when a slot subflow
  // is mounted inside a wrapper subflow). Match the LAST segment so
  // the convention works at any nesting depth.
  const lastSegment = id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id;
  switch (lastSegment) {
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

/** True when an id is any of the library's known subflow IDs. */
export function isKnownSubflow(id: string): id is SubflowId {
  return (Object.values(SUBFLOW_IDS) as string[]).includes(id);
}

/** True when an id is any of the library's known stage IDs. */
export function isKnownStage(id: string): id is StageId {
  return (Object.values(STAGE_IDS) as string[]).includes(id);
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
export function injectionKeyForSlot(
  slot: 'system-prompt' | 'messages' | 'tools',
): InjectionKey {
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


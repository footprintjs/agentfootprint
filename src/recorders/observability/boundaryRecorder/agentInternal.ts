import { SUBFLOW_IDS, STAGE_IDS } from '../../../lib/conventions.js';

/** Closed set of routing/wrapper subflow IDs that are pure plumbing.
 *  Slot subflows (`sf-system-prompt` / `sf-messages` / `sf-tools`) are
 *  NOT in this set — they're real context-engineering moments.
 *
 *  When you add a new subflow to the Agent's internal flowchart, decide:
 *    - Is it a context-engineering moment the user should see?  → leave OUT
 *    - Is it pure routing / dispatch / cache plumbing?           → add HERE
 *
 *  Forgetting to add it leaks every iteration of that subflow into the
 *  StepGraph as a fake "step" the user has to scrub past. */
const AGENT_INTERNAL_LOCAL_IDS: ReadonlySet<string> = new Set<string>([
  // Subflow ids (`sf-*`)
  SUBFLOW_IDS.INJECTION_ENGINE, // collects activeInjections; pure plumbing
  SUBFLOW_IDS.LLM_CALL, // LLMCall's inner invocation wrapper — the meaningful step is the call-llm stage INSIDE; the wrapper itself is a chart-shape container
  SUBFLOW_IDS.ROUTE,
  SUBFLOW_IDS.TOOL_CALLS,
  SUBFLOW_IDS.FINAL,
  SUBFLOW_IDS.MERGE,
  SUBFLOW_IDS.CACHE, // v2.14 — per-turn cache decision wrapper; pure plumbing
  SUBFLOW_IDS.CACHE_DECISION, // v2.6 — emits cacheMarkers; not a user step
  SUBFLOW_IDS.THINKING, // v2.14 — normalize result lands on parent LLM step
  SUBFLOW_IDS.INPUTS, // the inputs layer — its verdicts ride the ledger rows and their event
  SUBFLOW_IDS.RESULTS, // the results layer (step 7b) — its verdicts ride the ledger's period rows and their event
  // Decider stage ids (the same set is used to filter `decision.branch`
  // events whose deciding stage is plumbing rather than user-facing).
  STAGE_IDS.CACHE_GATE, // v2.6 — apply-markers / no-markers routing; plumbing
  // LLMCall outer wrapper stage + post-invocation marker — pure chart
  // shape, not user-meaningful steps.
  STAGE_IDS.CLIENT,
  STAGE_IDS.EXTRACT_FINAL,
] as readonly string[]);

// Constructed as a set on a separate line so we can extend with the
// thinking-handler inner-subflow ids below without the literal set
// initializer needing every value at compile time.
const _AGENT_INTERNAL_PREFIXES = ['thinking-'] as const;

/**
 * True when a local stage/subflow id should be hidden from the user-
 * facing StepGraph. Either an exact match against `AGENT_INTERNAL_LOCAL_IDS`
 * OR a prefix match against `_AGENT_INTERNAL_PREFIXES`.
 *
 * The prefix path catches the inner subflow that
 * `buildThinkingSubflow` creates with stageId `thinking-{handlerId}`
 * (e.g. `thinking-anthropic`, `thinking-openai`) — its results are
 * already folded into the wrapping LLMCall step's payload, so the
 * inner subflow is pure plumbing too.
 */
function isAgentInternalId(localId: string): boolean {
  if (AGENT_INTERNAL_LOCAL_IDS.has(localId)) return true;
  for (const p of _AGENT_INTERNAL_PREFIXES) {
    if (localId.startsWith(p)) return true;
  }
  return false;
}

export { isAgentInternalId };

/**
 * toolChoice/types — a classifier's reading of WHICH TOOL, beside the model's call.
 *
 * Pattern: plain row types over ONE flat append-only key
 *          (`AgentState.toolChoices`) — the `findings/types.ts` shape.
 * Role:    core/ layer leaf. Nothing here imports; `record.ts` is the one
 *          writer, `pick.ts` the one asker, `slots/buildToolsSlot.ts` the one
 *          place the narrowed list is built and committed.
 *
 * THE SECOND-SOURCE LAW. The model's tool call is the emission — it is what
 * runs, what `history` holds, what the receipt hashes. The classifier's pick
 * is a SECOND READING of the same step, marked `source: 'classifier'`, never
 * substituted for the call and never merged with it: a `pick` row before the
 * model call, an `outcome` row after it, and the comparison (`firstAgrees`,
 * `miss`) computed from the two rows at the one moment both exist. A
 * disagreement is a fact of the record, resolved by nobody.
 *
 * A SCORE IS DATA ONLY WHEN THE PROVIDER PRODUCED IT. `ranked` is the
 * provider's distribution over the offered names — a name the provider did
 * not score is ABSENT, never 0 — `chosen` is the provider's own pick (absent
 * when it named something outside the offer), `confidence` is as sent. A
 * failed call is a `pick-error` row with the provider's status, and the
 * FULL set is served (fail open, never fail narrow).
 */

/** The question id every pick is asked under — fixed, so a record reader can find it. */
export const TOOL_CHOICE_QUESTION = 'tool' as const;

/**
 * The framework's own doors, never narrowed away: the skill menu
 * (`read_skill`, `list_skills` — `core/agent/buildToolRegistry.ts`), the
 * procedure escape (`skip_step` — `lib/injection-engine/skillSteps.ts ·
 * SKIP_STEP_TOOL_NAME`) and the hand-to-the-screen tool (`present` —
 * `artifacts/present.ts · PRESENT_TOOL_NAME`). Literals here so this file
 * stays a leaf; `test/core/agent/toolChoice/narrow.test.ts` pins them to
 * the owners' constants. The `'tool-forced'` schema tool never enters the
 * slot (it is appended at request assembly), so it needs no entry.
 */
export const ALWAYS_SERVED_TOOLS: readonly string[] = Object.freeze([
  'read_skill',
  'list_skills',
  'skip_step',
  'present',
]);

/** Why a call that could have narrowed served the full set instead. */
export type NarrowSkipReason = 'unavailable' | 'too-few' | 'after-miss' | 'wrap-up';

/** One offered name with the probability the provider gave it. */
export interface ToolChoiceScore {
  readonly name: string;
  readonly score: number;
}

/**
 * The classifier's pick for one model call, filed BEFORE the call from the
 * tools slot (`buildToolsSlot · composeStage`), so the record holds what was
 * offered, what the classifier ranked and what was actually served — in
 * that order, on one row.
 */
export interface ToolChoiceRow {
  readonly kind: 'pick';
  readonly iteration: number;
  readonly source: 'classifier';
  /** The port name and the provider's resolved model string. */
  readonly classifier: { readonly name: string; readonly model: string };
  /** The candidates the classifier was asked about: the merged wire MINUS the always-served doors, in offered order. */
  readonly offered: readonly string[];
  /** The provider's distribution, highest first (ties keep offered order); an unscored name is absent. */
  readonly ranked: readonly ToolChoiceScore[];
  /** The provider's own pick; absent when it named nothing offered. */
  readonly chosen?: string;
  readonly confidence: number;
  readonly usage?: { readonly inputTokens: number; readonly outputTokens: number };
  /** Wall-clock milliseconds around the classifier call. */
  readonly latencyMs: number;
  /** The names the slot COMMITTED for this call — the list the receipt hashes and `servedView` rebuilds. */
  readonly served: readonly string[];
  /** Whether `served` is the top-N plus the doors (true) or the full merged wire (false). */
  readonly narrowed: boolean;
  /** Present exactly when a `serve: { top }` agent served the full set anyway, and why. */
  readonly narrowedSkipped?: NarrowSkipReason;
}

/**
 * The classifier was asked and produced no answer: the provider's status
 * and error text (the PROVIDER's words — allowed on the record) and the
 * latency spent. The full merged wire was served — an error row is never a
 * narrowing.
 */
export interface ToolChoiceErrorRow {
  readonly kind: 'pick-error';
  readonly iteration: number;
  readonly source: 'classifier';
  readonly classifier: { readonly name: string };
  readonly status?: number;
  readonly message: string;
  readonly latencyMs: number;
  /** The names the slot committed — the full merged wire, by the fail-open law. */
  readonly served: readonly string[];
  /**
   * Present exactly when the run was configured with `serve: { top }` — the
   * reason narrowing did not happen, same vocabulary and law as
   * `ToolChoiceRow.narrowedSkipped`. Absent under `serve: 'all'`, where
   * nothing was ever going to narrow.
   */
  readonly narrowedSkipped?: NarrowSkipReason;
}

/**
 * What the model DID, filed after its reply by `callLLM` — the same stage
 * that assembled the request the pick was made for — so pick → served →
 * called is one triple per call.
 */
export interface ToolChoiceOutcomeRow {
  readonly kind: 'outcome';
  readonly iteration: number;
  /** The model's tool calls this turn, in order; empty on an answer. */
  readonly called: readonly string[];
  /** `chosen === called[0]`; absent when either side is absent. */
  readonly firstAgrees?: boolean;
  /** Present when the call was NARROWED and the model named a tool outside `served`. */
  readonly miss?: { readonly wanted: readonly string[] };
}

export type ToolChoiceEntry = ToolChoiceRow | ToolChoiceErrorRow | ToolChoiceOutcomeRow;

/** The committed key: flat, append-only, a fresh array on every write. */
export type ToolChoiceLedger = readonly ToolChoiceEntry[];

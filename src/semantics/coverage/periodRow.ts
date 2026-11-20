import type { CallOccurrenceKey } from '../../lib/callOccurrence.js';
import type { PeriodDiffers } from '../../time/checkRecord.js';

/**
 * How far a result's READ covered what it asked for — one pure rule over the
 * instants the tool declared (bounds are inclusive):
 *
 * - `covered` — the store holds every instant the read asked for;
 * - `partly-held` — it holds some of them;
 * - `not-held` — it holds none of them;
 * - `unknown` — the tool said it cannot vouch for what the store holds.
 *
 * @inline
 */
export type PeriodVerdict = 'covered' | 'partly-held' | 'not-held' | 'unknown';

/**
 * The results layer's verdict on ONE call's period — a row on the one honesty
 * ledger (`AgentState.findingsLedger`, `kind: 'period'`), filed by the results
 * subflow at the loop head (`../../core/agent/results/subflow.ts`), never by the model.
 *
 * - `verdict` — `period.ts` · `periodVerdict` over the period the call's result
 *   declared (the least held, when it declared more than one), or
 *   `'undeclared'`: the tool declares a `ToolPeriod` and this result said
 *   nothing about what its read covered — declared silence, recorded as
 *   silence.
 * - `argument` — the argument the tool's `ToolPeriod` names: the join key to
 *   the inputs layer's `argument` row for the same call (`period: true`), which
 *   says WHO chose the period, while this row says WHAT the read covered.
 *
 * The row references the call's coverage row by `toolCallId` and never copies
 * the instants: the declaration stays in its own key (`coverageDeclared`).
 * Readers that switch over every row kind must skip one they do not know.
 */
export interface PeriodRow {
  readonly callOccurrenceKey?: CallOccurrenceKey;
  /** Legacy draft proof that a native result was served, before the settlement ledger. */
  readonly nativePeriodServed?: true;
  readonly kind: 'period';
  /** `AgentState.turnNumber` when the row was filed — the conversation turn. */
  readonly turn: number;
  readonly toolCallId: string;
  readonly toolName: string;
  /** The iteration of the batch the call ran in. */
  readonly iteration: number;
  readonly verdict: PeriodVerdict | 'undeclared';
  /** The argument the tool's `ToolPeriod` names — present only when it declares one. */
  readonly argument?: string;
  // ── The time layer's result checks (step T8 — `time/check.ts` ·
  //    `periodTimeCheck`), filed only under `.time()` and only when they hold;
  //    an unarmed run's rows never carry them (byte-identical). ──
  /** `period-differs-from-asked { missing, extra }` — the read differs from the asked range (or, for a window the model chose, from the person's). */
  readonly differs?: PeriodDiffers;
  /** `period-shifted` — the call's look-back ran as sent, `byMs` after the turn's `now`. */
  readonly shifted?: { readonly byMs: number };
  /** `period-beyond-retention` — refused as, or read as, wholly older than the tool's source keeps. */
  readonly beyondRetention?: true;
  /** `partly-beyond-retention` — the read crosses the edge of what the source keeps; `verdict` decides. */
  readonly partlyBeyondRetention?: true;
  /**
   * The time the source holds, when it holds none or only part of what the
   * call asked about (`verdict` `not-held` / `partly-held`) — the `queried` and
   * `held` spans of the declared period that verdict came from, as the tool
   * declared them. Filed only under `.time()`, where the served time line
   * hands the model this conclusion in the person's zone (`timeLimits.ts` ·
   * `heldLine`) and the evidence gate spells it (`time/forms.ts` ·
   * `timeFormsOf`, its `held` source): the model never converts a source's
   * UTC instants itself.
   */
  readonly held?: {
    readonly queried: { readonly from: string; readonly to: string };
    readonly held: { readonly from: string; readonly to: string };
  };
}

/** A source's held span beside what the call asked about — {@link PeriodRow}'s `held`. */
export type HeldSpan = NonNullable<PeriodRow['held']>;

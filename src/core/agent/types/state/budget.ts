export interface BudgetState {
  // ── The out-of-budget wrap-up (`wrapUpAtMaxIterations`, 9.56.0) ─────────
  /**
   * The turn's action budget ran out and the ONE wrap-up call has been asked
   * for. Written by the WrapUp branch, read by two places and no others:
   *
   *   • `callLLM`, at request assembly — this is what withholds the tools, so
   *     the last call cannot ask for an action the budget already refused;
   *   • the Route decider, on the pass after — the latch that stops a second
   *     wrap-up and the signal to settle `stoppedEarly` against the answer
   *     that actually came back.
   *
   * **Deliberately NOT seeded.** The key is written only on the turn that runs
   * out, so an agent that finishes inside its budget commits exactly the keys
   * it always did — the whole feature is invisible in its commit log, its
   * snapshot and its recordings (`stepNudgeSpent`'s gate, taken one step
   * further because this behaviour is on by default rather than opted into).
   */
  wrapUpAsked?: boolean;
  // Cost accounting (only used when pricingTable is set).
  cumTokensInput: number;
  cumTokensOutput: number;
  cumEstimatedUsd: number;
  costBudgetHit: boolean;
  /** Resolved from `costBudget`. `'halt'` makes the Route decider stop the
   *  loop at the next boundary once `costBudgetHit` is set. */
  costBudgetOnExceed?: 'warn' | 'halt';
}

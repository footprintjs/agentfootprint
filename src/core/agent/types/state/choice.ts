import type { ToolChoiceLedger } from '../../toolChoice/types.js';

export interface ChoiceState {
  // ── Tool choice by classifier (`.toolChoice()`) ───────────────
  /**
   * A classifier's reading of WHICH TOOL answers each step, beside the
   * model's own call (9.105.0) — one flat append-only list: a `pick` row
   * (or a `pick-error` row) filed by the tools slot before every model call
   * with the provider's ranking, its pick, its cost and the names actually
   * served, and an `outcome` row filed by `callLLM` after the reply with the
   * tools the model called, `firstAgrees` and any `miss`. Written ONLY by
   * `recordToolChoice`, and only under `.toolChoice()` — ABSENT otherwise, so
   * every other agent commits exactly the keys it always did. Plain records
   * and arrays only; every write assigns a FRESH array. The model's call is
   * the emission; a row here is a second reading, never a substitute.
   */
  toolChoices?: ToolChoiceLedger;

  /**
   * The time layer's late line (step T6b, `.time({ reader })` only): the one
   * served time line the tools slot composed (`agent/arguments/serve/windows.ts` ·
   * `timeWindowsLine`) and the iteration that composed it; `text` is `''` when
   * there was nothing to say. `callLLM` appends a non-empty line LAST to the
   * request of that same iteration — request-only, never history — and
   * `servedView` rebuilds it from this key. ABSENT on every other agent.
   */
  timeLine?: { readonly iteration: number; readonly text: string };
}

/**
 * UnsupportedValuesError — typed error thrown by `Agent.run()` under
 * `.namesAndNumbersFromEvidence({ posture: 'rails' })` when the final answer
 * still states values that appear in no tool result (9.35.0).
 *
 * Pattern: Typed Error (the `MessageDeniedError` shape, for the same reason).
 * Role:    Surface layer for the evidence boundary. The Route decider writes
 *          the verdict to scope; `Agent.finalizeResult` translates it here, so
 *          a caller can `instanceof` it and read `.values`.
 * Emits:   N/A — `agentfootprint.agent.evidence_checked` fires from the
 *          decider at the moment the verdict is decided.
 *
 * ## Why a refusal is not returned as an answer
 *
 * `rails` exists to make sure an answer carrying invented identifiers never
 * reaches whoever asked. Returning the string with a flag attached would leave
 * the caller free to ignore the flag, which is the failure mode the posture
 * was chosen to remove — the same reasoning that makes a denied message raise.
 *
 * ## What it carries, and why that is safe
 *
 * The unsupported values, by name. They are the MODEL's own words, from an
 * answer the caller was about to be handed in full, so naming them leaks
 * nothing new — and a refusal that will not say what was wrong teaches
 * nobody. Each value is normalized and truncated; the answer itself is not
 * carried, and stays where the run put it: the commit log, under whatever
 * redaction the run configured.
 *
 * @example
 *   try {
 *     await agent.run({ message: 'which port is down?' });
 *   } catch (e) {
 *     if (e instanceof UnsupportedValuesError) {
 *       console.log(e.values.map((v) => v.value)); // ['0xef0101', …]
 *     } else throw e;
 *   }
 */

import type { UnsupportedValue } from './types.js';

export interface UnsupportedValuesContext {
  /** The flagged values, normalized and truncated. */
  readonly values: readonly UnsupportedValue[];
  /** How many distinct values the answer had to ground in total. */
  readonly candidates: number;
  /** True when a revision was asked for and the values survived it. */
  readonly revised: boolean;
  /** The full teaching sentence, including what would satisfy the check. */
  readonly message: string;
}

export class UnsupportedValuesError extends Error {
  readonly code = 'ERR_UNSUPPORTED_VALUES' as const;
  readonly values: readonly UnsupportedValue[];
  readonly candidates: number;
  readonly revised: boolean;

  constructor(ctx: UnsupportedValuesContext) {
    super(ctx.message);
    this.name = 'UnsupportedValuesError';
    this.values = ctx.values;
    this.candidates = ctx.candidates;
    this.revised = ctx.revised;
  }
}

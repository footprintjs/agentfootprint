/**
 * honesty/armed — which honesty layers a run has armed: the ONE run constant.
 *
 * Pattern: a run constant, seeded once by `stages/seed.ts` (the
 *          `findingsServe` precedent) and never written again during the run.
 * Role:    core/ layer leaf. A reader of the RECORD — the standing fold, a
 *          lens, a bench — tells "this layer was armed and filed nothing" from
 *          "this layer was never armed" by this key alone, never by guessing
 *          from the rows.
 * Emits:   N/A.
 *
 * Absent on a run with no layer armed, so an agent that armed nothing commits
 * exactly the keys it always did.
 */

/** The armed layers, by name. Grows one key per layer that ships. */
export interface HonestyLayers {
  /** The inputs layer (honesty layer 2) — `sf-inputs` is mounted. */
  readonly inputs?: true;
  /**
   * The answer layer (honesty layer 4) — its stages head the final branch,
   * and the Route decider files the answer's witness rows
   * (`assessment/witness.ts`).
   */
  readonly answer?: true;
}

/**
 * The run constant for an agent's armed layers, or `undefined` when none is
 * armed (then seed writes nothing). A layer that is not armed is absent from
 * the object — never `false` — so the bytes of a run that armed only the
 * inputs layer are the bytes that layer has always committed.
 *
 * @example
 * ```ts
 * honestyLayersOf({ inputs: true, answer: false }); // { inputs: true }
 * honestyLayersOf({ inputs: false, answer: false }); // undefined
 * ```
 */
export function honestyLayersOf(armed: {
  readonly inputs: boolean;
  readonly answer: boolean;
}): HonestyLayers | undefined {
  if (!armed.inputs && !armed.answer) return undefined;
  return {
    ...(armed.inputs && { inputs: true as const }),
    ...(armed.answer && { answer: true as const }),
  };
}

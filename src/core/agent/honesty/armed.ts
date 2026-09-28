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
  /** The results layer (honesty layer 3, step 7b) — `sf-results` is mounted at the loop head. */
  readonly results?: true;
}

/**
 * The run constant for an agent with any layer mounted, or `undefined` when
 * none is (then seed writes nothing). An agent with only the inputs layer
 * records `{ inputs: true }`, exactly as before the results layer existed.
 */
export function honestyLayersOf(
  inputsLayer: boolean,
  resultsLayer = false,
): HonestyLayers | undefined {
  if (!inputsLayer && !resultsLayer) return undefined;
  return { ...(inputsLayer && { inputs: true }), ...(resultsLayer && { results: true }) };
}

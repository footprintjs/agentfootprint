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
   * The inputs layer's declared sources (`.findings({ argumentSources: true
   * })`) — ruled tools carry `_findings.from`, and the layer checks it.
   */
  readonly argumentSources?: true;
}

/**
 * The run constant for an agent whose inputs layer is mounted, or `undefined`
 * when it is not (then seed writes nothing). `argumentSources` only beside it.
 */
export function honestyLayersOf(
  inputsLayer: boolean,
  argumentSources = false,
): HonestyLayers | undefined {
  if (!inputsLayer) return undefined;
  return argumentSources ? { inputs: true, argumentSources: true } : { inputs: true };
}

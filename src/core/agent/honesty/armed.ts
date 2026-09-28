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
   * })` or `.inputsLayer({ argumentSources: true })`) — ruled tools carry
   * `_findings.from`, and the layer checks it. Which door armed it is on the
   * record too: the findings ledger's run constant `findingsServe` exists
   * exactly when `.findings()` did.
   */
  readonly argumentSources?: true;
  /** The results layer (honesty layer 3, step 7b) — `sf-results` is mounted at the loop head. */
  readonly results?: true;
  /**
   * The answer layer (honesty layer 4) — its stages head the final branch,
   * and the Route decider files the answer's witness rows
   * (`assessment/witness.ts`).
   */
  readonly answer?: true;
}

/**
 * The object form of `AgentOptions.inputsLayer` — `AgentBuilder.inputsLayer(options)`.
 * Written inline on the public option (no new export, no new API page); this
 * is the reader's name for it.
 */
export interface InputsLayerOptions {
  /**
   * DECLARED SOURCES without the findings ledger: each ruled tool's served
   * schema carries the reserved `_findings` argument with `from` alone, and
   * the layer checks every claim before the batch runs. Default off.
   */
  readonly argumentSources?: boolean;
}

/**
 * `AgentOptions.inputsLayer` as the agent reads it — `undefined` when the
 * layer is not asked for (`undefined` or `false`), the options otherwise
 * (`true` reads as `{}`). Anything else is REFUSED, naming the value: a door
 * that silently ignored `{ argumentSources: 'yes' }` would look configured and
 * do nothing.
 */
export function readInputsLayerOption(value: unknown): InputsLayerOptions | undefined {
  if (value === undefined || value === false) return undefined;
  if (value === true) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(
      `Agent: inputsLayer must be true, false or { argumentSources?: boolean }, got ` +
        `${JSON.stringify(value)}.`,
    );
  }
  const unknown = Object.keys(value).filter((k) => k !== 'argumentSources');
  if (unknown.length > 0) {
    throw new Error(
      `Agent: inputsLayer takes { argumentSources?: boolean } only — unknown key ` +
        `${unknown.map((k) => `'${k}'`).join(', ')}.`,
    );
  }
  const sources = (value as { readonly argumentSources?: unknown }).argumentSources;
  if (sources !== undefined && typeof sources !== 'boolean') {
    throw new Error(
      `Agent: inputsLayer.argumentSources must be true or false, got ${JSON.stringify(sources)}.`,
    );
  }
  return sources === true ? { argumentSources: true } : {};
}

/**
 * The run constant for an agent's armed layers, or `undefined` when none is
 * armed (then seed writes nothing). A layer that is not armed is absent from
 * the object — never `false` — so the bytes of a run that armed only the
 * inputs layer are the bytes that layer has always committed.
 * `argumentSources` only beside `inputs`.
 *
 * @example
 * ```ts
 * honestyLayersOf({ inputs: true, answer: false }); // { inputs: true }
 * honestyLayersOf({ inputs: true, argumentSources: true, answer: false }); // { inputs: true, argumentSources: true }
 * honestyLayersOf({ inputs: false, results: true, answer: false }); // { results: true }
 * honestyLayersOf({ inputs: false, answer: false }); // undefined
 * ```
 */
export function honestyLayersOf(armed: {
  readonly inputs: boolean;
  readonly argumentSources?: boolean;
  readonly results?: boolean;
  readonly answer: boolean;
}): HonestyLayers | undefined {
  if (!armed.inputs && armed.results !== true && !armed.answer) return undefined;
  return {
    ...(armed.inputs && { inputs: true as const }),
    ...(armed.inputs && armed.argumentSources === true && { argumentSources: true as const }),
    ...(armed.results === true && { results: true as const }),
    ...(armed.answer && { answer: true as const }),
  };
}

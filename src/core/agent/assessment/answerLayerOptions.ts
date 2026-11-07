import type { StandingLineWhen } from './compose.js';

/**
 * The line's modes, as the option doors check them — keyed by the type the
 * layer's composer decides with (`assessment/compose.ts` · `StandingLineWhen`),
 * so a mode added there does not compile until it is listed here. A type-only
 * import: the composer stays off a plain agent's module graph.
 */
const STANDING_LINE_MODES: { readonly [W in StandingLineWhen]: true } = Object.freeze({
  always: true,
  'unless-consistent': true,
  'not-sure-or-ask': true,
});

/**
 * THE ANSWER LAYER'S ARM (honesty layer 4), checked by ONE rule for both of
 * its doors — `.answerLayer(options)` and `AgentOptions.answerLayer` — so a
 * value one door refuses, the other refuses too: an unknown key, a
 * `standingLine` that is neither a boolean nor `{ when }`, or a `when` outside
 * the three modes, is refused by name. Returns the arm normalised — the line's
 * mode (`true` → `'always'`), or `{}` for no line.
 */
export function answerLayerArm(
  options: Readonly<Record<string, unknown>>,
  door: string,
): { readonly standingLine?: StandingLineWhen } {
  const unknown = Object.keys(options).filter((k) => k !== 'standingLine');
  if (unknown.length > 0) {
    throw new Error(
      `${door}: unknown option(s) ${unknown.map((k) => `'${k}'`).join(', ')}. ` +
        "The one option is standingLine (boolean, or { when: 'always' | 'unless-consistent' | " +
        "'not-sure-or-ask' }).",
    );
  }
  const line = options.standingLine;
  if (line === undefined || line === false) return {};
  if (line === true) return { standingLine: 'always' };
  const modes = Object.keys(STANDING_LINE_MODES)
    .map((w) => `'${w}'`)
    .join(', ');
  if (typeof line !== 'object' || line === null || Array.isArray(line)) {
    throw new Error(
      `${door}: standingLine must be a boolean or { when } — when is one of ${modes}.`,
    );
  }
  const extra = Object.keys(line).filter((k) => k !== 'when');
  if (extra.length > 0) {
    throw new Error(
      `${door}: standingLine has unknown option(s) ${extra.map((k) => `'${k}'`).join(', ')}. ` +
        `The one option is when: ${modes}.`,
    );
  }
  const when = (line as { readonly when?: unknown }).when;
  if (
    typeof when !== 'string' ||
    !Object.prototype.hasOwnProperty.call(STANDING_LINE_MODES, when)
  ) {
    throw new Error(
      `${door}: standingLine.when must be one of ${modes} (got ${
        JSON.stringify(when) ?? 'nothing'
      }).`,
    );
  }
  return { standingLine: when as StandingLineWhen };
}

/**
 * `AgentOptions.answerLayer` as the arm `build()` resolves: `undefined` when
 * it is absent or `false`, `{}` for `true`, an object through
 * `answerLayerArm` — so the options door meets every refusal the builder's
 * door does. Anything else is refused by name.
 */
export function answerLayerFromOptions(
  value: unknown,
): { readonly standingLine?: StandingLineWhen } | undefined {
  if (value === undefined || value === false) return undefined;
  if (value === true) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(
      'AgentOptions.answerLayer must be a boolean or an object — ' +
        "{ standingLine?: boolean | { when: 'always' | 'unless-consistent' | 'not-sure-or-ask' } }.",
    );
  }
  return answerLayerArm(value as Readonly<Record<string, unknown>>, 'AgentOptions.answerLayer');
}

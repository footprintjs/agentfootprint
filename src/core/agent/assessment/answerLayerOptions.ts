import type { StandingLineWhen } from './compose.js';
import { REASONS } from './reasons.js';
import type { AssessmentReason } from './types.js';

export interface AnswerLayerArm {
  /** `standingLine: true` resolves to `'always'`. Absent leaves the line off. */
  readonly standingLine?: StandingLineWhen;
  readonly standingLineRaiseOn?: readonly AssessmentReason[];
}
export type AnswerLayerOptions =
  | boolean
  | {
      readonly standingLine?:
        | boolean
        | {
            readonly when: StandingLineWhen;
            /** Which recorded reasons can trigger a not-sure line. A match shows the full line. */
            readonly raiseOn?: readonly AssessmentReason[];
          };
    };

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

const REASON_IDS: ReadonlySet<string> = new Set(REASONS.map(({ reason }) => reason));

function raiseOnReasons(value: unknown, door: string): readonly AssessmentReason[] {
  if (!Array.isArray(value)) {
    throw new Error(`${door}: standingLine.raiseOn must be an array of known assessment reasons.`);
  }
  const length = value.length;
  if (!Number.isSafeInteger(length) || length < 0 || length > REASON_IDS.size) {
    throw new Error(`${door}: standingLine.raiseOn exceeds the bounds of the reason table.`);
  }
  const reasons: AssessmentReason[] = [];
  for (let index = 0; index < length; index++) {
    const reason: unknown = value[index];
    if (typeof reason !== 'string' || !REASON_IDS.has(reason)) {
      throw new Error(
        `${door}: standingLine.raiseOn[${index}] must name a known assessment reason.`,
      );
    }
    reasons.push(reason as AssessmentReason);
  }
  return Object.freeze(reasons);
}

/**
 * THE ANSWER LAYER'S ARM (honesty layer 4), checked by ONE rule for both of
 * its doors — `.answerLayer(options)` and `AgentOptions.answerLayer` — so a
 * value one door refuses, the other refuses too: an unknown key, a
 * `standingLine` that is neither a boolean nor `{ when, raiseOn? }`, or a `when` outside
 * the three modes, is refused by name. Returns the arm normalised — the line's
 * mode (`true` → `'always'`), or `{}` for no line.
 */
export function answerLayerArm(
  options: Readonly<Record<string, unknown>>,
  door: string,
): AnswerLayerArm {
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
  const extra = Object.keys(line).filter((k) => k !== 'when' && k !== 'raiseOn');
  if (extra.length > 0) {
    throw new Error(
      `${door}: standingLine has unknown option(s) ${extra.map((k) => `'${k}'`).join(', ')}. ` +
        `The options are when: ${modes} and optional raiseOn.`,
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
  const raiseOn = (line as { readonly raiseOn?: unknown }).raiseOn;
  return {
    standingLine: when as StandingLineWhen,
    ...(raiseOn !== undefined && { standingLineRaiseOn: raiseOnReasons(raiseOn, door) }),
  };
}

/**
 * `AgentOptions.answerLayer` as the arm `build()` resolves: `undefined` when
 * it is absent, `false` to turn the layer off, `{}` for `true`, an object through
 * `answerLayerArm` — so the options door meets every refusal the builder's
 * door does. Anything else is refused by name.
 */
export function answerLayerFromOptions(value: unknown): AnswerLayerArm | false | undefined {
  if (value === undefined || value === false) return value;
  if (value === true) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(
      'AgentOptions.answerLayer must be a boolean or an object — ' +
        "{ standingLine?: boolean | { when: 'always' | 'unless-consistent' | 'not-sure-or-ask' } }.",
    );
  }
  return answerLayerArm(value as Readonly<Record<string, unknown>>, 'AgentOptions.answerLayer');
}
